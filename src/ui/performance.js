window.mihrabPerformance = {
  selection: 'auto',
  recommended: 'full',
  hardware: null,
  profile: {
    id: 'full',
    title: 'كامل',
    batchSize: 8,
    images: true,
    paged: false,
    animations: true,
  },
};
let pendingPerformanceLevel = null,
  lastPerformanceDraft = 'auto';
function getPerformanceSelection() {
  return document.getElementById('performance-auto').checked
    ? 'auto'
    : document.querySelector('[name=performance-level]:checked')?.value || 'auto';
}
function setPerformanceChoice(level) {
  document.getElementById('performance-auto').checked = level === 'auto';
  for (const input of document.querySelectorAll('[name=performance-level]'))
    input.checked =
      input.value === (level === 'auto' ? window.mihrabPerformance.recommended : level);
}
function applyPerformanceProfile(value) {
  window.mihrabPerformance = value;
  const previous = document.documentElement.dataset.performance;
  document.documentElement.dataset.performance = value.profile.id;
  if (previous !== value.profile.id) window.dispatchEvent(new Event('mihrab:performance-profile'));
  lastPerformanceDraft = value.selection;
  setPerformanceChoice(value.selection);
  for (const badge of document.querySelectorAll('[data-performance-recommendation]'))
    badge.hidden = badge.dataset.performanceRecommendation !== value.recommended;
  renderPerformanceHardware(value.hardware);
  if (!value.profile.animations)
    document.querySelectorAll('.scroll-item').forEach((node) => node.classList.add('is-visible'));
}
async function refreshPerformanceView(result) {
  applyPerformanceProfile(result);
  if (lessonFeed) {
    lessonFeed.dispose();
    lessonFeed = null;
  }
  lessonSource = null;
  lessonFilterKey = null;
  try {
    renderYoutubeState(await window.mihrabApi.getYoutubeState());
  } catch (error) {
    document.getElementById('performance-status').textContent =
      'حُفظ المستوى، لكن تعذر تحديث الدروس: ' + error.message;
  }
}
function markPerformanceDraft() {
  const status = document.getElementById('settings-save-status');

  status.textContent = 'لديك تغييرات لم تُحفظ بعد.';
}
function initializePerformance(value) {
  applyPerformanceProfile(value || window.mihrabPerformance);
  monitorAutomaticPerformance();
  const rank = { eco: 0, balanced: 1, full: 2 },
    dialog = document.getElementById('performance-warning-dialog');
  const request = (level) => {
    setPerformanceChoice(level);
    const old =
      lastPerformanceDraft === 'auto' ? window.mihrabPerformance.recommended : lastPerformanceDraft;
    if (
      level !== 'auto' &&
      rank[level] > rank[window.mihrabPerformance.recommended] &&
      rank[level] > rank[old]
    ) {
      pendingPerformanceLevel = level;
      dialog.showModal();
    } else {
      lastPerformanceDraft = level;
      markPerformanceDraft();
    }
  };
  for (const input of document.querySelectorAll('[name=performance-level]'))
    input.addEventListener('change', () => request(input.value));
  document
    .getElementById('performance-auto')
    .addEventListener('change', (event) =>
      request(
        event.target.checked
          ? 'auto'
          : document.querySelector('[name=performance-level]:checked').value,
      ),
    );
  document.getElementById('btn-confirm-performance').addEventListener('click', () => {
    if (pendingPerformanceLevel) {
      lastPerformanceDraft = pendingPerformanceLevel;
      markPerformanceDraft();
    }
    pendingPerformanceLevel = null;
    dialog.close();
  });
  const cancel = () => {
    pendingPerformanceLevel = null;
    setPerformanceChoice(lastPerformanceDraft);
  };
  document.getElementById('btn-cancel-performance').addEventListener('click', () => {
    cancel();
    dialog.close();
  });
  dialog.addEventListener('cancel', cancel);
}

function renderPerformanceHardware(hardware) {
  const t = window.mihrabLocale.t;
  const unavailable = t('performance.unavailable');
  const number = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 2 });
  document.getElementById('performance-cpu').textContent =
    t('performance.processor', { value: hardware?.processor || unavailable });
  document.getElementById('performance-memory').textContent =
    t('performance.ram', { value: hardware?.memoryGB ? number.format(hardware.memoryGB) + ' GB' : unavailable });
  document.getElementById('performance-cores').textContent = t('performance.threads', {
    count: hardware?.logicalCores ? number.format(hardware.logicalCores) : unavailable,
    speed: hardware?.cpuMHz ? number.format(hardware.cpuMHz / 1000) + ' GHz' : unavailable,
  });
}
function refreshHardwareLanguage() {
  if (window.mihrabPerformance) renderPerformanceHardware(window.mihrabPerformance.hardware);
}
window.addEventListener('mihrab:interface-language-changed', refreshHardwareLanguage);
window.addEventListener('DOMContentLoaded', () => window.mihrabLocale.ready.then(refreshHardwareLanguage));

function monitorAutomaticPerformance() {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let battery;
  let framePacing;
  let graphics;
  let longTasks = [];
  let timer;
  let revision = 0;

  function update() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (document.hidden) return;
      const current = ++revision;
      try {
        const cutoff = performance.now() - 10000;
        longTasks = longTasks.filter(task => task.startTime > cutoff);
        const total = longTasks.reduce((sum, task) => sum + task.duration, 0);
        const pressure = total >= 700 ? 2 : longTasks.length >= 3 && total >= 300 ? 1 : 0;
        const value = await window.mihrabApi.updatePerformanceSignals({
          reducedMotion: motion.matches, graphics, framePacing, pressure,
          lowBattery: Boolean(battery && !battery.charging && battery.level <= .2),
        });
        if (current !== revision) return;
        const previous = window.mihrabPerformance;
        window.mihrabPerformance = value;
        document.documentElement.dataset.performance = value.profile.id;
        if (lastPerformanceDraft === 'auto') setPerformanceChoice('auto');
        for (const badge of document.querySelectorAll('[data-performance-recommendation]'))
          badge.hidden = badge.dataset.performanceRecommendation !== value.recommended;
        if (!value.profile.animations)
          document.querySelectorAll('.scroll-item').forEach(node => node.classList.add('is-visible'));
        if (previous.profile.id !== value.profile.id) {
          window.dispatchEvent(new Event('mihrab:performance-profile'));
          if (lessonFeed) lessonFeed.dispose();
          lessonFeed = lessonSource = lessonFilterKey = null;
          const feed = await window.mihrabApi.getYoutubeState();
          if (current === revision) renderYoutubeState(feed);
        }
      } catch (error) { console.warn('Automatic performance update failed', error); }
    }, 150);
  }

  function sampleFrames() {
    const gaps = [];
    let previous;
    function frame(now) {
      if (document.hidden) return;
      if (previous !== undefined) gaps.push(now - previous);
      previous = now;
      if (gaps.length < 90) { requestAnimationFrame(frame); return; }
      const sorted = [...gaps].sort((a, b) => a - b);
      const base = sorted[Math.floor(sorted.length * .2)];
      const missed = gaps.filter(gap => gap > Math.max(22, base * 1.65)).length / gaps.length;
      framePacing = base > 45 || missed >= .35 ? 'poor' : missed >= .15 ? 'mixed' : 'smooth';
      update();
    }
    requestAnimationFrame(frame);
  }

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true });
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
    graphics = gl ? (/swiftshader|llvmpipe|software|basic render/i.test(renderer || '') ? 'software' : 'available') : 'unavailable';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { graphics = 'unavailable'; }
  motion.addEventListener('change', update);
  navigator.getBattery?.().then(value => {
    battery = value;
    battery.addEventListener('chargingchange', update);
    battery.addEventListener('levelchange', update);
    update();
  }).catch(() => {});
  if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver(list => {
      if (document.hidden) return;
      const now = performance.now();
      longTasks = longTasks.filter(task => task.startTime > now - 10000);
      longTasks.push(...list.getEntries().filter(task => task.duration >= 80));
      update();
    }).observe({ entryTypes: ['longtask'] });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { if (!framePacing) sampleFrames(); update(); }
  });
  window.addEventListener('focus', update);
  if (!document.hidden) sampleFrames();
  setInterval(update, 30000);
  update();
}
