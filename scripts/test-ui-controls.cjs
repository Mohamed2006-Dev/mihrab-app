// Real Chromium regression checks with synthetic data and no application services.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const base = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-ui-controls-'));
app.setPath('userData', path.join(temporary, 'profile'));
app.disableHardwareAcceleration();
let win,
  checks = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = async (source) => {
  try {
    return await win.webContents.executeJavaScript(source);
  } catch (error) {
    throw new Error(source + '\n' + errors.join('\n'), { cause: error });
  }
};
const errors = [];
const check = (value, message) => {
  assert(value, message);
  checks++;
};
const deadline = setTimeout(() => {
  console.error('UI regression timeout');
  app.exit(1);
}, 45000);

function fixture() {
  const ui = (name) => pathToFileURL(path.join(base, 'src/ui', name)).href;
  const options =
    '<option value="one">الخيار الأول</option><option value="two">الخيار الثاني</option><option value="three">الخيار الثالث</option>';
  return `<!doctype html><html dir="rtl" lang="ar" data-performance="full"><head><meta charset="utf-8">
    <link rel="stylesheet" href="${ui('styles/structural.css')}"><link rel="stylesheet" href="${ui('style.css')}">
    <style>body{display:block;padding:24px;overflow:auto;background:#101b18}#tab-settings{max-width:480px;margin:auto}label{display:block}#fixture-scroll{height:180px;overflow:auto;margin-top:16px}#fixture-scroll>div{padding:30px 12px 220px}#bottom-anchor{position:fixed;bottom:20px;right:24px;width:230px}#fixture-popover{inset:auto;left:20px;top:20px;width:300px;padding:20px}#fixture-details{padding:12px;border:1px solid;margin:12px}summary{cursor:pointer}#fixture-motion{height:50px}select{width:100%}</style>
    </head><body><section id="tab-settings"><div id="fixture-panel" class="settings-transition-panel">
    <label for="fixture-select">نظام الإشعارات</label><select id="fixture-select">${options}${Array.from({ length: 18 }, (_, i) => '<option value="extra' + i + '">عنصر ' + i + '</option>').join('')}</select>
    <div id="fixture-scroll"><div><label for="fixture-scroll-select">قائمة قابلة للتمرير</label><select id="fixture-scroll-select">${options}</select></div></div>
    <fieldset id="fixture-fieldset"><label for="fixture-disabled">إعداد تابع</label><select id="fixture-disabled">${options}</select></fieldset>
    <details id="fixture-details"><summary>إعدادات متقدمة</summary><div style="height:100px">تفاصيل</div></details><div id="fixture-motion">محتوى متحرك</div>
    </div></section><div style="max-width:720px;margin:30px auto"><div id="yt-channels-list"></div></div><div id="bottom-anchor"><select id="fixture-bottom">${options.repeat(10)}</select></div>
    <div id="fixture-popover" popover="auto"><select id="fixture-nested">${options}</select></div>
    <script src="${ui('final-polish.js')}"></script><script src="${ui('channel-marquee.js')}"></script></body></html>`;
}
async function geometry(id) {
  return js(
    `(()=>{const select=document.getElementById(${JSON.stringify(id)}),wrap=select.closest('.custom-select'),input=wrap.querySelector('input'),pop=wrap.querySelector('[popover]');const rect=node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,bottom:r.bottom,right:r.right,width:r.width,height:r.height}};return{input:rect(input),menu:rect(pop),open:pop.matches(':popover-open'),placement:pop.dataset.placement,viewport:{width:innerWidth,height:innerHeight}}})()`,
  );
}
async function aligned(id, label) {
  const r = await geometry(id);
  check(r.open, label + ': menu open');
  check(Math.abs(r.input.left - r.menu.left) < 1, label + ': horizontal anchor');
  check(Math.abs(r.input.width - r.menu.width) < 1, label + ': matching width');
  check(
    r.placement === 'above'
      ? Math.abs(r.input.top - r.menu.bottom - 5) < 2
      : Math.abs(r.menu.top - r.input.bottom - 5) < 2,
    label + ': vertical anchor',
  );
  check(
    r.menu.left >= 7 &&
      r.menu.right <= r.viewport.width - 7 &&
      r.menu.top >= 7 &&
      r.menu.bottom <= r.viewport.height - 7,
    label + ': viewport limits',
  );
}
async function click(id, target = 'input') {
  await js(
    `document.getElementById(${JSON.stringify(id)}).closest('.custom-select').querySelector(${JSON.stringify(target)}).click()`,
  );
}
async function closeMenus() {
  await js('openCustomSelect?.close()');
}

app.whenReady().then(async () => {
  try {
    const file = path.join(temporary, 'controls.html');
    fs.writeFileSync(file, fixture());
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    await win.loadFile(file);
    await js(
      'document.querySelectorAll("select").forEach(installCustomSelect);document.fonts.ready',
    );
    check(await js('customSelects.size===5'), 'Every select uses the shared control');
    for (const profile of ['full', 'balanced', 'eco']) {
      await js(
        `document.documentElement.dataset.performance=${JSON.stringify(profile)};document.getElementById('fixture-panel').hidden=true`,
      );
      await delay(25);
      await js("document.getElementById('fixture-panel').hidden=false");
      await click('fixture-select');
      await aligned('fixture-select', profile + ' first frame');
      for (const ms of [35, 100, 340]) {
        await delay(ms);
        await aligned('fixture-select', profile + ' entering panel');
      }
      const before = await geometry('fixture-select');
      const arrow = await js(
        "(()=>{const r=document.querySelector('#fixture-panel .custom-select-toggle').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(arrow.x),
        y: Math.round(arrow.y),
      });
      await delay(30);
      const after = await geometry('fixture-select');
      check(
        Math.abs(before.menu.left - after.menu.left) < 1 &&
          Math.abs(before.input.top - after.input.top) < 1,
        profile + ' arrow hover is stable',
      );
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: Math.round(arrow.x),
        y: Math.round(arrow.y),
        button: 'left',
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: Math.round(arrow.x),
        y: Math.round(arrow.y),
        button: 'left',
        clickCount: 1,
      });
      await delay(30);
      check(!(await geometry('fixture-select')).open, profile + ' physical arrow click closes');
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: Math.round(arrow.x),
        y: Math.round(arrow.y),
        button: 'left',
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: Math.round(arrow.x),
        y: Math.round(arrow.y),
        button: 'left',
        clickCount: 1,
      });
      await delay(30);
      await aligned('fixture-select', profile + ' physical arrow click opens');
      await js(
        "(()=>{window.fixtureChanges=0;document.getElementById('fixture-select').onchange=()=>window.fixtureChanges++;const i=document.getElementById('input-fixture-select');i.value='الثاني';i.dispatchEvent(new Event('input',{bubbles:true}))})()",
      );
      const caret = await js(
        "(()=>{const r=document.getElementById('input-fixture-select').getBoundingClientRect();return{x:r.right-20,y:r.y+r.height/2}})()",
      );
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: Math.round(caret.x),
        y: Math.round(caret.y),
        button: 'left',
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: Math.round(caret.x),
        y: Math.round(caret.y),
        button: 'left',
        clickCount: 1,
      });
      await delay(20);
      check(
        await js(
          "document.getElementById('input-fixture-select').value==='الثاني'&&document.querySelectorAll('#options-fixture-select button').length===1",
        ),
        profile + ' clicking the search field preserves its query',
      );
      await js(
        "(()=>{const i=document.getElementById('input-fixture-select');i.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()",
      );
      check(
        await js(
          "document.getElementById('fixture-select').value==='two'&&fixtureChanges===1&&document.getElementById('input-fixture-select').value==='الخيار الثاني'",
        ),
        profile + ' search selects native value once',
      );
      await js("document.getElementById('fixture-scroll').scrollTop=0");
      await delay(20);
      await click('fixture-scroll-select');
      await js("document.getElementById('fixture-scroll').scrollTop=20");
      await delay(40);
      await aligned('fixture-scroll-select', profile + ' container scroll');
      await js("document.getElementById('fixture-scroll').scrollTop=200");
      await delay(30);
      check(
        !(await geometry('fixture-scroll-select')).open,
        profile + ' scrolled-out anchor closes menu',
      );
      await closeMenus();
      await click('fixture-disabled');
      await js("document.getElementById('fixture-fieldset').disabled=true");
      await delay(20);
      check(
        await js(
          "!document.getElementById('options-fixture-disabled').matches(':popover-open')&&document.getElementById('input-fixture-disabled').disabled",
        ),
        profile + ' disabled ancestor closes menu',
      );
      await js("document.getElementById('fixture-fieldset').disabled=false");
      await delay(20);
      await click('fixture-bottom');
      await aligned('fixture-bottom', profile + ' bottom edge');
      check((await geometry('fixture-bottom')).placement === 'above', profile + ' opens upward');
      await closeMenus();
    }
    await js(
      "document.getElementById('fixture-popover').showPopover();window.escaped=0;window.addEventListener('keydown',e=>{if(e.key==='Escape')window.escaped++})",
    );
    await click('fixture-nested');
    await aligned('fixture-nested', 'nested popover');
    await js(
      "document.getElementById('input-fixture-nested').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
    );
    check(
      await js(
        "document.getElementById('fixture-popover').matches(':popover-open')&&!document.getElementById('options-fixture-nested').matches(':popover-open')&&escaped===0",
      ),
      'Escape closes just the nested menu',
    );
    await js("document.getElementById('fixture-popover').hidePopover()");
    for (const [width, height, zoom] of [
      [800, 650, 1],
      [1280, 900, 1.5],
      [420, 700, 1],
    ]) {
      win.setSize(width, height);
      win.webContents.setZoomFactor(zoom);
      await delay(80);
      await click('fixture-bottom');
      await aligned('fixture-bottom', `viewport ${width}/${zoom}`);
      await closeMenus();
    }
    win.setSize(1280, 900);
    win.webContents.setZoomFactor(1);
    await js(
      "document.documentElement.dataset.performance='full';setPanelOpen(document.getElementById('fixture-motion'),false)",
    );
    await delay(30);
    await js("setPanelOpen(document.getElementById('fixture-motion'),true)");
    await delay(350);
    check(
      await js(
        "!document.getElementById('fixture-motion').hidden&&getComputedStyle(document.getElementById('fixture-motion')).opacity==='1'&&panelMotions.size===0",
      ),
      'Interrupted close cannot hide reopened content',
    );
    await js(
      "installDetailsMotion(document.getElementById('fixture-details'));document.querySelector('#fixture-details summary').click()",
    );
    await delay(25);
    await js("document.querySelector('#fixture-details summary').click()");
    await delay(25);
    await js("document.querySelector('#fixture-details summary').click()");
    await delay(350);
    check(
      await js(
        "document.getElementById('fixture-details').open&&document.getElementById('fixture-details').style.overflow===''&&panelMotions.size===0",
      ),
      'Rapid details toggles settle open without leftover styles',
    );
    await js(
      "setPanelOpen(document.getElementById('fixture-motion'),false);document.documentElement.dataset.a11yMotion='reduce'",
    );
    await delay(25);
    check(
      await js("document.getElementById('fixture-motion').hidden&&panelMotions.size===0"),
      'Reduced motion finishes the intended state',
    );
    check(
      await js("getComputedStyle(document.getElementById('fixture-panel')).animationName==='none'"),
      'Reduced motion disables settings entry',
    );
    await js(
      "document.documentElement.dataset.a11yMotion='system';document.documentElement.dataset.performance='full';var fixtureMarquee=new ChannelMarquee(document.getElementById('yt-channels-list'));document.getElementById('yt-channels-list').scrollIntoView({block:'center',behavior:'instant'})",
    );
    await delay(100);
    for (const profile of ['full', 'balanced'])
      for (const count of [1, 3, 8]) {
        await js(
          `(()=>{document.documentElement.dataset.performance=${JSON.stringify(profile)};fixtureMarquee.release();const container=document.getElementById('yt-channels-list');container.replaceChildren(...Array.from({length:${count}},(_,index)=>{const row=document.createElement('div');row.className='channel-row';row.innerHTML='<span>قناة اختبار '+index+'</span><button type="button">حذف</button>';return row}));container.scrollIntoView({block:'center',behavior:'instant'});fixtureMarquee.schedule()})()`,
        );
        await delay(100);
        const strip = await js(
          `(()=>{const a=fixtureMarquee.animation;if(!a)return null;a.pause();a.currentTime=0;const c=document.getElementById('yt-channels-list'),s=getComputedStyle(c),r=c.getBoundingClientRect(),parent=c.parentElement.getBoundingClientRect(),rows=[...c.querySelectorAll('.channel-marquee-original .channel-row')],bounds=rows.map(row=>row.getBoundingClientRect()),gap=parseFloat(s.columnGap),available=c.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);const widths=bounds.map(b=>b.width);const duration=a.effect.getTiming().duration;a.currentTime=duration-1;const before=c.querySelector('.channel-marquee-copy .channel-row').getBoundingClientRect().left;a.currentTime=duration+1;const after=c.querySelector('.channel-marquee-original .channel-row').getBoundingClientRect().left;return{infinite:a.effect.getTiming().iterations===Infinity,widths,available,viewportWidth:r.width,parentWidth:parent.width,center:Math.abs((r.left+r.right-parent.left-parent.right)/2),total:widths.reduce((x,y)=>x+y,0)+gap*(rows.length-1),rightGap:Math.abs(bounds[0].right-r.right+parseFloat(s.paddingRight)),leftGap:Math.abs(bounds.at(-1).left-r.left-parseFloat(s.paddingLeft)),seam:Math.abs(after-before)}})()`,
        );
        check(strip?.infinite, `${profile}/${count}: short and overflowing strips both animate`);
        check(Math.min(...strip.widths) >= 169.5, `${profile}/${count}: cards never shrink`);
        check(
          Math.max(...strip.widths) <= 170.5,
          `${profile}/${count}: cards retain their natural size`,
        );
        check(
          Math.max(...strip.widths) - Math.min(...strip.widths) < 1,
          `${profile}/${count}: cards have equal widths`,
        );
        check(
          strip.total >= strip.available - 1 && strip.rightGap < 1,
          `${profile}/${count}: viewport is filled`,
        );
        if (count < 4) check(strip.leftGap < 1, `${profile}/${count}: no unused trailing space`);
        check(
          strip.center < 1 && strip.viewportWidth <= strip.parentWidth - 15,
          `${profile}/${count}: centered within its parent margin`,
        );
        if (count < 4)
          check(
            Math.abs(strip.viewportWidth - (count * 170 + (count - 1) * 10 + 4)) < 1,
            `${profile}/${count}: short viewport wraps its cards`,
          );
        check(strip.seam < 1, `${profile}/${count}: seamless loop`);
      }
    await js("document.getElementById('yt-channels-list').parentElement.style.maxWidth='900px'");
    await delay(100);
    check(
      await js("document.getElementById('yt-channels-list').getBoundingClientRect().width>800"),
      'The strip grows when its parent grows without a window resize',
    );
    await js("document.documentElement.dataset.performance='eco'");
    await delay(60);
    check(
      await js("!fixtureMarquee.animation&&!document.querySelector('.channel-marquee-copy')"),
      'Eco remains static without a duplicate',
    );
    assert.deepEqual(errors, []);
    console.log(
      `UI controls: ${checks} checks passed (Chromium, 3 profiles, resize, zoom, scrolling, keyboard, interrupted motion and short/overflowing channel loops).`,
    );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    win?.destroy();
    app.exit(process.exitCode || 0);
  }
});
