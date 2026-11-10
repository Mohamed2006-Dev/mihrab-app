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

const shortcutModifiers = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' };
const shortcutEditor = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

function shortcutChord(event) {
  if (event.isComposing || ['Dead', 'Process'].includes(event.key)) return null;
  const { code } = event;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) :
    /^Digit[0-9]$/.test(code) ? code.slice(5) :
    code && code !== 'Unidentified' ? code : event.key;
  if (!key || key === 'Unidentified') return null;
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt',
    event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean);
  if (key.startsWith('Arrow') && !modifiers.length) return null;
  return [...modifiers, key].join('+');
}

function bindDesktopShortcuts() {
  const panel = document.getElementById('data-settings-section-panel-shortcuts');
  const host = document.getElementById('shortcut-rows');
  try { shortcutBindings = JSON.parse(localStorage.getItem(shortcutStorageKey) || '{}') || {}; }
  catch { shortcutBindings = {}; }
  let editing = null;
  let standaloneModifier = null;
  const binding = ([id, , fallback]) => (shortcutBindings[id] || fallback).replace(/(^|\+) $/, '$1Space');
  function updateButtons() {
    for (const action of desktopShortcuts) {
      const button = host.querySelector('[data-shortcut-action="' + action[0] + '"]');
      if (!button) continue;
      const listening = action[0] === editing;
      button.dir = listening ? 'rtl' : 'ltr';
      button.textContent = listening ? 'استماع…' : binding(action);
      button.setAttribute('aria-label', action[1] + ' — ' + button.textContent);
      button.setAttribute('aria-pressed', String(listening));
    }
  }
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
        editing = editing === action[0] ? null : action[0];
        standaloneModifier = null;
        updateButtons();
      });
      row.append(label, button);
      host.append(row);
    }
    updateButtons();
  }
  recordShortcutTab(document.querySelector('.tab-section.active')?.id || 'tab-prayers');
  render();
  document.getElementById('shortcut-reset').addEventListener('click', () => {
    shortcutBindings = {};
    localStorage.removeItem(shortcutStorageKey);
    showSuccessFeedback('تمت استعادة الاختصارات الأصلية.');
    editing = null;
    render();
  });
  function cancelEditing() {
    editing = null;
    standaloneModifier = null;
    updateButtons();
  }
  const observer = new MutationObserver(() => {
    if (panel.hidden || !panel.closest('.tab-section').classList.contains('active')) cancelEditing();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(panel.closest('.tab-section'), { attributes: true, attributeFilter: ['class'] });
  function handleShortcut(event, chord) {
    if (!chord || event.defaultPrevented || event.isComposing ||
        event.target.closest?.(shortcutEditor) || document.activeElement?.closest?.(shortcutEditor) ||
        document.querySelector('dialog[open], .modal-overlay.open')) return;
    if (editing && !panel.hidden && panel.closest('.tab-section').classList.contains('active')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (chord === 'Ctrl+Shift+Space' || desktopShortcuts.some(action => action[0] !== editing && binding(action) === chord)) {
        showSuccessFeedback('هذا الاختصار مستخدم بالفعل.');
        return;
      }
      shortcutBindings[editing] = chord;
      localStorage.setItem(shortcutStorageKey, JSON.stringify(shortcutBindings));
      cancelEditing();
      return;
    }
    const action = desktopShortcuts.find(item => binding(item) === chord);
    if (action) {
      event.preventDefault();
      action[3]();
    }
  }
  window.addEventListener('blur', cancelEditing);
  document.addEventListener('keydown', event => {
    if (event.repeat) return;
    const modifier = Object.hasOwn(shortcutModifiers, event.key) && shortcutModifiers[event.key];
    if (modifier) {
      const count = [event.ctrlKey, event.altKey, event.shiftKey, event.metaKey].filter(Boolean).length;
      standaloneModifier = count === 1 && !event.target.closest?.(shortcutEditor) ? modifier : null;
      return;
    }
    standaloneModifier = null;
    handleShortcut(event, shortcutChord(event));
  }, true);
  document.addEventListener('keyup', event => {
    if (!standaloneModifier || shortcutModifiers[event.key] !== standaloneModifier) return;
    const chord = standaloneModifier;
    standaloneModifier = null;
    handleShortcut(event, chord);
  }, true);
}
