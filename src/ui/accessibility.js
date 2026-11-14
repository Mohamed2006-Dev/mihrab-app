let accessibilityState = {
  zoom: 100,
  readingSize: 100,
  contrast: 'theme',
  clearFont: false,
  reduceMotion: false,
  buttonVisible: true,
  buttonPosition: 'bottom-left',
  pages: ['tab-prayers', 'tab-hadith', 'tab-youtube', 'tab-quran', 'tab-settings'],
};
let accessibilitySaved = { ...accessibilityState },
  accessibilitySaveQueue = Promise.resolve(),
  accessibilityRevision = 0;
function applyAccessibility(value) {
  accessibilityState = { ...accessibilityState, ...value };
  const p = accessibilityState,
    root = document.documentElement;
  root.dataset.a11yContrast = p.contrast;
  root.dataset.a11yFont = p.clearFont ? 'clear' : 'theme';
  root.dataset.a11yMotion = p.reduceMotion ? 'reduce' : 'system';
  root.style.setProperty('--a11y-reading-scale', p.readingSize / 100);
  window.mihrabApi.setInterfaceZoom(p.zoom / 100);
  for (const input of document.querySelectorAll('[data-a11y-key]')) {
    const key = input.dataset.a11yKey;
    if (input.type === 'checkbox') input.checked = Boolean(p[key]);
    else input.value = p[key];
  }
  for (const out of document.querySelectorAll('[data-a11y-output]'))
    out.textContent = p[out.dataset.a11yOutput] + '%';
  for (const input of document.querySelectorAll('[data-a11y-page]'))
    input.checked = p.pages.includes(input.dataset.a11yPage);
  for (const button of document.querySelectorAll('[data-a11y-step]')) {
    const [key, delta] = button.dataset.a11yStep.split(':');
    button.disabled =
      Number(delta) < 0
        ? p[key] <= (key === 'zoom' ? 80 : 100)
        : p[key] >= (key === 'zoom' ? 150 : 180);
  }
  if (p.reduceMotion)
    document.querySelectorAll('.scroll-item').forEach((node) => node.classList.add('is-visible'));
  updateAccessibilityButton();
  positionAccessibilityPanel();
}
function updateAccessibilityButton() {
  const button = document.getElementById('btn-accessibility');
  if (!button) return;
  const page = document.querySelector('.tab-section.active')?.id;
  button.hidden = !accessibilityState.buttonVisible || !accessibilityState.pages.includes(page);
  button.dataset.position = accessibilityState.buttonPosition;
  if (button.hidden) {
    const panel = document.getElementById('accessibility-popover');
    if (panel?.matches(':popover-open')) panel.hidePopover();
  }
}
function saveAccessibility(patch) {
  const revision = ++accessibilityRevision,
    next = { ...accessibilityState, ...patch };
  applyAccessibility(next);
  const job = accessibilitySaveQueue.then(async () => {
    try {
      const saved = await window.mihrabApi.saveAccessibility(next);
      accessibilitySaved = saved;
      if (revision === accessibilityRevision) applyAccessibility(saved);
      if (typeof state !== 'undefined' && state.config) state.config.accessibility = saved;
      const status = document.getElementById('accessibility-status');
      if (typeof briefInlineFeedback === 'function')
        briefInlineFeedback(status, 'تم حفظ خيارات الوصول.');
    } catch (error) {
      if (revision === accessibilityRevision) applyAccessibility(accessibilitySaved);
      document.getElementById('accessibility-status').textContent =
        'تعذر حفظ خيارات الوصول: ' + error.message;
    }
  });
  accessibilitySaveQueue = job;
  return job;
}
function positionAccessibilityPanel() {
  const panel = document.getElementById('accessibility-popover'),
    button = document.getElementById('btn-accessibility');
  if (!panel?.matches(':popover-open')) return;
  const r = button.getBoundingClientRect(),
    width = Math.min(350, innerWidth - 24),
    height = Math.min(540, innerHeight - 24);
  panel.style.width = width + 'px';
  panel.style.maxHeight = height + 'px';
  panel.style.left = Math.max(12, Math.min(innerWidth - width - 12, r.left)) + 'px';
  panel.style.top =
    Math.max(
      12,
      Math.min(
        innerHeight - panel.offsetHeight - 12,
        accessibilityState.buttonPosition.startsWith('bottom')
          ? r.top - panel.offsetHeight - 8
          : r.bottom + 8,
      ),
    ) + 'px';
}
function initializeAccessibility(initial) {
  accessibilitySaved = { ...accessibilityState, ...initial };
  applyAccessibility(accessibilitySaved);
  const button = document.getElementById('btn-accessibility'),
    panel = document.getElementById('accessibility-popover');
  button.addEventListener('click', () => {
    if (panel.matches(':popover-open')) panel.hidePopover();
    else {
      panel.showPopover();
      positionAccessibilityPanel();
    }
  });
  panel.addEventListener('toggle', (event) => {
    button.setAttribute('aria-expanded', String(event.newState === 'open'));
  });
  document.getElementById('btn-close-accessibility').addEventListener('click', () => {
    panel.hidePopover();
    button.focus();
  });
  for (const input of document.querySelectorAll('[data-a11y-key]'))
    input.addEventListener('change', () => {
      const key = input.dataset.a11yKey;
      saveAccessibility({
        [key]:
          input.type === 'checkbox'
            ? input.checked
            : input.type === 'range'
              ? Number(input.value)
              : input.value,
      });
    });
  for (const button of document.querySelectorAll('[data-a11y-step]'))
    button.addEventListener('click', () => {
      const [key, step] = button.dataset.a11yStep.split(':');
      saveAccessibility({
        [key]: Math.max(
          key === 'zoom' ? 80 : 100,
          Math.min(key === 'zoom' ? 150 : 180, accessibilityState[key] + Number(step)),
        ),
      });
    });
  for (const input of document.querySelectorAll('[data-a11y-page]'))
    input.addEventListener('change', () =>
      saveAccessibility({
        pages: [
          ...document.querySelectorAll('#accessibility-general-settings [data-a11y-page]:checked'),
        ].map((node) => node.dataset.a11yPage),
      }),
    );
  for (const button of document.querySelectorAll('[data-a11y-reset]'))
    button.addEventListener('click', () =>
      saveAccessibility({
        zoom: 100,
        readingSize: 100,
        contrast: 'theme',
        clearFont: false,
        reduceMotion: false,
        buttonVisible: true,
        buttonPosition: 'bottom-left',
        pages: ['tab-prayers', 'tab-hadith', 'tab-youtube', 'tab-quran', 'tab-settings'],
      }),
    );
  document.getElementById('btn-customize-accessibility').addEventListener('click', () => {
    panel.hidePopover();
    activateTabById('tab-settings');
    document.getElementById('data-settings-section-accessibility').click();
  });
  window.mihrabApi.onAccessibilityShortcut((action) =>
    saveAccessibility({
      zoom: action === 0 ? 100 : Math.max(80, Math.min(150, accessibilityState.zoom + action)),
    }),
  );
  let lastZoomWheel = 0;
  document.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (Date.now() - lastZoomWheel < 100) return;
      lastZoomWheel = Date.now();
      const zoom = Math.max(
        80,
        Math.min(150, accessibilityState.zoom + (event.deltaY < 0 ? 10 : -10)),
      );
      if (zoom !== accessibilityState.zoom) saveAccessibility({ zoom });
    },
    { passive: false },
  );
  window.addEventListener('resize', positionAccessibilityPanel);
  const activeObserver = new MutationObserver(updateAccessibilityButton);
  document
    .querySelectorAll('.tab-section')
    .forEach((node) =>
      activeObserver.observe(node, { attributes: true, attributeFilter: ['class'] }),
    );
}


function updateAccessibilityPositionLabels() {
  const labels = {
    'top-left': 'settings.topLeft', 'top-right': 'settings.topRight',
    'bottom-left': 'settings.bottomLeft', 'bottom-right': 'settings.bottomRight',
  };
  const mirrored = document.documentElement.dir === 'ltr';
  for (const option of document.querySelectorAll('#a11y-position option')) {
    const position = mirrored ? option.value.replace(/left|right$/, side => side === 'left' ? 'right' : 'left') : option.value;
    if (labels[position]) option.textContent = window.mihrabLocale.t(labels[position]);
  }
  positionAccessibilityPanel();
}
window.addEventListener('mihrab:interface-language-changed', updateAccessibilityPositionLabels);
window.addEventListener('DOMContentLoaded', () => {
  window.mihrabLocale.ready.then(updateAccessibilityPositionLabels);
});
