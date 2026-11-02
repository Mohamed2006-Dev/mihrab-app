const fs = require('node:fs');
const path = require('node:path');

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const detail = (value) =>
  value && !/^(?:-|غير مسجل[ة]?)$/.test(String(value).trim())
    ? String(value)
    : 'غير مذكور في المصدر';

function buildHadithImageHtml(hadith, baseDir) {
  if (!hadith?.text?.trim()) throw Error('لا يوجد متن حديث لإنشاء الصورة.');
  if (hadith.text.length > 18000) throw Error('نص الحديث أطول من سعة بطاقة الصورة.');
  const font = (weight) =>
    fs
      .readFileSync(
        path.join(baseDir, 'src/ui/assets/fonts', `amiri-arabic-${weight}-normal.woff2`),
      )
      .toString('base64');
  const ornament =
    '<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M50 4 63 24 86 14 76 37 96 50 76 63 86 86 63 76 50 96 37 76 14 86 24 63 4 50 24 37 14 14 37 24Z" stroke="currentColor" stroke-width="1.2"/><path d="M50 18 82 50 50 82 18 50Z" stroke="currentColor" stroke-width="1"/><circle cx="50" cy="50" r="12" stroke="currentColor"/></svg>';
  const field = (label, value) =>
    `<div class="detail"><dt>${label}</dt><dd>${escapeHtml(detail(value))}</dd></div>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:;"><style>
  @font-face{font-family:Amiri;src:url(data:font/woff2;base64,${font(400)}) format('woff2');font-weight:400}
  @font-face{font-family:Amiri;src:url(data:font/woff2;base64,${font(700)}) format('woff2');font-weight:700}
  *{box-sizing:border-box}html,body{margin:0;width:1200px;background:#103a30;font-family:Amiri,serif}body{overflow:hidden}
  .canvas{width:1200px;padding:58px;background:radial-gradient(ellipse at top,#245949,#103a30 65%);position:relative}
  .outer-line{position:absolute;inset:24px;border:1px solid #bba36c88;border-radius:42px;pointer-events:none}
  .frame{position:relative;background:#f8f4e9;border:2px solid #c3aa73;border-radius:32px;padding:50px 58px 38px;color:#183e33;overflow:hidden}
  .frame:before{content:'';position:absolute;inset:13px;border:1px solid #c3aa7355;border-radius:22px;pointer-events:none}
  .corner{position:absolute;width:108px;height:108px;color:#bfa268;opacity:.38;top:23px}.corner.right{right:22px}.corner.left{left:22px}
  header{text-align:center;position:relative;padding-bottom:23px}.mihrab{width:48px;height:59px;margin:0 auto 8px;color:#aa8a4c}
  .brand{font-size:27px;letter-spacing:1px;color:#406758}.eyebrow{font-size:23px;color:#8b7446;margin:4px 0 0}
  .divider{width:180px;height:1px;background:#bba36c88;margin:18px auto 0;position:relative}.divider:after{content:'';position:absolute;width:8px;height:8px;background:#b49a62;transform:rotate(45deg);left:86px;top:-4px}
  .quote{font-size:${hadith.text.length > 1000 ? 40 : 48}px;line-height:1.95;text-align:center;margin:17px 0 29px;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:400}
  .grade{border:1px solid #bca36799;border-radius:17px;padding:15px 24px;text-align:center;background:#eae7d7;margin:0 0 23px;break-inside:avoid}
  .grade dt{font-size:22px;color:#5d7159}.grade dd{margin:1px 0 0;font-weight:700;font-size:29px;line-height:1.7;color:#244b39;overflow-wrap:anywhere}
  .grade-source{font-family:'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#66735e;margin-top:5px}
  dl{margin:0}.details{display:grid;grid-template-columns:1fr 1fr;gap:12px}.detail{padding:15px 19px;border:1px solid #bba36c55;border-radius:14px;background:#fffdf655;min-width:0}
  .detail:last-child:nth-child(odd){grid-column:1/-1}dt{font-size:21px;color:#85764f}dd{margin:4px 0 0;font-size:25px;line-height:1.65;overflow-wrap:anywhere}
  .reference{margin-top:14px;font-size:19px;color:#65705b;text-align:center;line-height:1.8;overflow-wrap:anywhere}
  footer{display:flex;align-items:center;justify-content:center;gap:15px;border-top:1px solid #bba36c66;padding-top:21px;margin-top:25px;color:#7f775f;font-size:20px}
  footer svg{width:25px;height:25px;color:#aa8a4c}.mark{color:#a18750}
  </style></head><body><main class="canvas"><div class="outer-line"></div><article class="frame"><div class="corner right">${ornament}</div><div class="corner left">${ornament}</div>
  <header><svg class="mihrab" viewBox="0 0 48 60" fill="none"><path d="M6 57V28c0-12 12-15 18-24 6 9 18 12 18 24v29M2 57h44M15 57V30c0-6 6-9 9-13 3 4 9 7 9 13v27" stroke="currentColor" stroke-width="1.6"/></svg><div class="brand">مِحْراب</div><p class="eyebrow">حديث وتذكرة</p><div class="divider"></div></header>
  <div class="quote">${escapeHtml(hadith.text)}</div>
  <dl class="grade"><dt>درجة الحديث</dt><dd>${escapeHtml(detail(hadith.grade))}</dd></dl>
  <dl class="details">${field('الراوي', hadith.rawi)}${field('المحدّث', hadith.mohdith)}${field('التخريج', hadith.book)}${hadith.pageNumber ? field('الصفحة أو الرقم', hadith.pageNumber) : ''}</dl>
  <div class="reference">الناشر والمصدر: موسوعة الأحاديث النبوية — HadeethEnc.com</div>
  <footer><span>مِحْراب</span><span class="mark">•</span><span>تذكير يطمئنّ به القلب</span></footer>
  </article></main></body></html>`;
}

async function renderHadithImage({ BrowserWindow, hadith, baseDir }) {
  const window = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  try {
    await window.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(buildHadithImageHtml(hadith, baseDir)),
    );
    await window.webContents.executeJavaScript('document.fonts.ready');
    const height = await window.webContents.executeJavaScript(
      "Math.ceil(document.querySelector('.canvas').getBoundingClientRect().height)",
    );
    if (height > 16000) throw Error('النص طويل جداً لصورة واحدة؛ لم يُقص أي جزء منه.');
    window.setContentSize(1200, height);
    await window.webContents.executeJavaScript(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1200, height });
    if (image.isEmpty() || image.getSize().height !== height)
      throw Error('تعذر التقاط بطاقة الحديث كاملة.');
    return image.toPNG();
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

module.exports = { buildHadithImageHtml, renderHadithImage };
