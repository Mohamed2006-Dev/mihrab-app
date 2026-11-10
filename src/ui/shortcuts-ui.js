'use strict';

const desktopShortcuts = [
  ['settings', 'فتح أو إغلاق الإعدادات', 'Escape', () => {
    if (document.getElementById('tab-settings').classList.contains('active')) return navigateShortcutHistory(-1);
    activateTabById('tab-settings');
  }],
  ['back', 'الرجوع للصفحة السابقة', 'Alt+ArrowLeft', () => navigateShortcutHistory(-1)],
  ['forward', 'الانتقال للصفحة التالية', 'Alt+ArrowRight', () => navigateShortcutHistory(1)],
  ['prayers', 'مواقيت الصلاة', 'Alt+1', () => activateTabById('tab-prayers')],
  ['hadith', 'الأحاديث', 'Alt+2', () => activateTabById('tab-hadith')],
  ['quran', 'ورد القرآن', 'Alt+3', () => activateTabById('tab-quran')],
  ['lessons', 'الدروس والقنوات', 'Alt+4', () => activateTabById('tab-youtube')],
  ['adhkar', 'الأذكار', 'Alt+5', () => activateTabById('tab-adhkar')],
  ['sidebar', 'إظهار أو إخفاء القائمة الجانبية', 'B', () => {
    document.getElementById('btn-navigation-mode').click();
  }],
  ['refresh', 'تحديث خلاصات الدروس', 'Alt+R', () => {
    activateTabById('tab-youtube');
    if (document.getElementById('tab-youtube').classList.contains('active')) document.getElementById('btn-refresh-yt').click();
  }],
];
const shortcutStorageKey = 'mihrab.shortcuts';
const shortcutHistory = [];
let shortcutHistoryIndex = -1;
let shortcutHistoryTarget = null;
let shortcutBindings = {};

function recordShortcutTab(tab) {
  if (shortcutHistoryTarget !== null && shortcutHistory[shortcutHistoryTarget] === tab) {
    shortcutHistoryIndex = shortcutHistoryTarget;
    shortcutHistoryTarget = null;
    return;
  }
  if (shortcutHistory[shortcutHistoryIndex] === tab) return;
  shortcutHistory.splice(shortcutHistoryIndex + 1);
  shortcutHistory.push(tab);
  shortcutHistoryIndex = shortcutHistory.length - 1;
}

function navigateShortcutHistory(direction) {
  const index = shortcutHistoryIndex + direction;
  if (!shortcutHistory[index]) return;
  shortcutHistoryTarget = index;
  activateTabById(shortcutHistory[index]);
  shortcutHistoryTarget = null;
}

function shortcutChord(event) {
  if (event.isComposing || ['Alt', 'Control', 'Shift', 'Meta', 'Unidentified'].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) :
    /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key;
  if (!event.altKey && !event.ctrlKey && !event.metaKey && key !== 'Escape' && !/^Key[A-Z]$/.test(event.code)) return null;
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+');
}

function bindDesktopShortcuts() {
  const panel = document.getElementById('data-settings-section-panel-shortcuts');
  const host = document.getElementById('shortcut-rows');
  const status = document.getElementById('shortcut-status');
  try { shortcutBindings = JSON.parse(localStorage.getItem(shortcutStorageKey) || '{}') || {}; }
  catch { shortcutBindings = {}; }
  let editing = null;
  const binding = ([id, , fallback]) => shortcutBindings[id] || fallback;
  function render() {
    host.replaceChildren();
    for (const action of desktopShortcuts) {
      const row = document.createElement('div');
      row.className = 'directory-row';
      const label = document.createElement('span');
      label.textContent = action[1];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary';
      button.dir = 'ltr';
      button.dataset.shortcutAction = action[0];
      button.setAttribute('aria-label', action[1] + ' — ' + binding(action));
      button.textContent = binding(action);
      button.addEventListener('click', () => {
        editing = action[0];
        status.textContent = 'اضغط الاختصار الجديد مع Alt أو Ctrl، أو اختر Esc.';
      });
      row.append(label, button);
      host.append(row);
    }
  }
  recordShortcutTab(document.querySelector('.tab-section.active')?.id || 'tab-prayers');
  render();
  document.getElementById('shortcut-reset').addEventListener('click', () => {
    shortcutBindings = {};
    localStorage.removeItem(shortcutStorageKey);
    status.textContent = 'تمت استعادة الاختصارات الأصلية.';
    editing = null;
    render();
  });
  function cancelEditing() {
    editing = null;
    status.textContent = '';
  }
  const observer = new MutationObserver(() => {
    if (panel.hidden || !panel.closest('.tab-section').classList.contains('active')) cancelEditing();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(panel.closest('.tab-section'), { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', event => {
    const chord = shortcutChord(event);
    if (!chord || event.repeat) return;
    if (editing && !panel.hidden && panel.closest('.tab-section').classList.contains('active')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (desktopShortcuts.some(action => action[0] !== editing && binding(action) === chord)) {
        status.textContent = 'هذا الاختصار مستخدم بالفعل.';
        return;
      }
      const actionId = editing;
      shortcutBindings[actionId] = chord;
      localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcutBindings));
      status.textContent = 'تم حفظ الاختصار.';
      editing = null;
      render();
      host.querySelector('[data-shortcut-action="' + actionId + '"]')?.focus();
      return;
    }
    if (event.defaultPrevented || event.target.closest?.('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('dialog[open], .modal-overlay.open')) return;
    const action = desktopShortcuts.find(item => binding(item) === chord);
    if (action) {
      event.preventDefault();
      action[3]();
    }
  }, true);
}
