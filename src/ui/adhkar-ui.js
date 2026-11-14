'use strict';

const adhkarIcons = {
  sunset: '<path d="M2 14h20M7 14a5 5 0 0 1 10 0M12 3v3M4 7l2 2m14-2-2 2M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0l2 1M2 22c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  bed: '<path d="M4 12V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M3 17v3m18-3v3M3 17h18v-3a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><rect x="6" y="8" width="5" height="4" rx="1"/><rect x="13" y="8" width="5" height="4" rx="1"/>',
  food: '<path d="M3 20v-6a3 3 0 0 1 .5-5.8 6 6 0 0 1 8 0A3 3 0 0 1 12 14v6zM6 12l2-2m0 5 2-2M15 5h7l-1.3 15h-4.4zM16 12c1-.7 2-.7 3 0s2 .7 2.4.2"/>',
  clothing: '<path d="M8 4 3 7l2 5 3-1v9h8v-9l3 1 2-5-5-3M8 4a4 4 0 0 0 8 0M8 18h8"/>',
  handshake: '<path d="m11 17 2 2a1.4 1.4 0 0 0 2-2m-1-2 2.5 2.5a1.4 1.4 0 0 0 2-2l-4.4-4.4a3 3 0 0 0-4.2 0l-1 1a1.4 1.4 0 0 1-2-2l3.2-3.2a4.4 4.4 0 0 1 5.4-.7l1.5.9 2-.7m0 8.8 2.5-1.5M5 13.5l5.1 5.1a1.4 1.4 0 0 0 2-2M5 13.5l-3-1.4L4.5 6l3.1 1.2m12-1.2 2.4 6-2.4 1.5"/>',
  mosque: '<path d="M2 21h20M3 21V9h3v12M3 9V6l1.5-2L6 6v3M8 21V13c0-3 2-4 4-6 2 2 4 3 4 6v8M11 21v-4h2v4M18 21V9h3v12M18 9V6l1.5-2L21 6v3M8 13h8"/>',
  rug: '<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M7 2v2m5-2v2m5-2v2M7 20v2m5-2v2m5-2v2M8 17v-5l4-4 4 4v5Z"/>',
  kaaba: '<path d="M3 7l9-4 9 4v12l-9 3-9-3V7Zm0 0 9 3 9-3m-9 3v12m-9-11 9 3 9-3m-5 9v-4l2-.7v4"/>',
  morning: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  evening: '<path d="M20 16A9 9 0 0 1 8 4a9 9 0 1 0 12 12Z"/><path d="M16 3v6m-3-3h6"/>',
  daily: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  worship: '<path d="M4 22V11c0-5 5-6 8-10 3 4 8 5 8 10v11M2 22h20M8 22V12c0-3 2-4 4-6 2 2 4 3 4 6v10"/>',
  dua: '<path d="M10 21H7l-4-5-1-6a1.1 1.1 0 0 1 2-.7l2 5 2 1.5-1.2-2a1.1 1.1 0 0 1 1.8-1.2l1.4 2 1 2.4v4Zm4 0h3l4-5 1-6a1.1 1.1 0 0 0-2-.7l-2 5-2 1.5 1.2-2a1.1 1.1 0 0 0-1.8-1.2l-1.4 2-1 2.4v4ZM12 3v3M8 5l1 2m7-2-1 2"/>',
  worry: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-5l2-4 2 2-1 3 4 2 4-2-1-3 2-2 2 4v5M4 4l2 2m14-2-2 2M12 1v2"/>',
  repent: '<circle cx="13" cy="9" r="3"/><path d="m10 11-3 3v6h10m-5-5 2 2 5-5m-3-8 2-2 2 2m-2-2v5"/>',
  prayFor: '<circle cx="7" cy="12" r="2.5"/><path d="M2 22v-3a4 4 0 0 1 4-4m2 6 4-3-1-2m4-1h.1m-2-2h.1"/><rect x="12" y="2" width="10" height="10" rx="3"/><circle cx="17" cy="5.5" r="1.1"/><path d="M15 9a2 2 0 0 1 4 0"/>',
  patient: '<circle cx="6" cy="13" r="2"/><path d="M2 10v11m20-6v6M2 18h20v-2a3 3 0 0 0-3-3h-8a2 2 0 0 0-2 2v3m7-15v6m-3-3h6"/>',
  wedding: '<circle cx="6" cy="8" r="3"/><path d="M1 21v-3c0-3 2-5 5-5s5 2 5 5v3m3 0h9v-4l-2-4c0-5-1-8-4-8s-4 3-4 8l-1 2m3-6a2 2 0 0 0 4 0m-4 5 4 3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6"/><path d="M14 9h-2a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 1 0 3h-2m2-7v8"/>',
  camel: '<circle cx="3" cy="7" r="1.4"/><path d="M1 21l2-6v-4l3 3 3-3M3 15l3 6m1-8 3-5h2l1 5c1 0 1-4 3-4 1 0 2 2 3 3 3 0 3 2 3 4l-2 1v4m-2-4h-5l-1 4m-1-4c-2 0-2-3-1-5"/>',
  rain: '<path d="M5 14h14a3 3 0 0 0 0-6 5 5 0 0 0-9-2 4 4 0 1 0-5 8Zm2 3-2 3m7-3-2 4m7-4-2 3"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6M4 5h16v14H4z"/>',
  cross: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8m-4-4h8"/>',
  speech: '<path d="M3 4h18v12H9l-5 4v-4H3zM7 9h10m-10 3h6"/>',
  alert: '<path d="M12 3 2 21h20zM12 9v5m0 3h.01"/>',
  closedEye: '<path d="M3 10c5 7 13 7 18 0M5 12l-2 3m9 0v4m7-7 2 3"/>',
  bier: '<path d="M2 19h20M4 19v3m16-3v3M4 16l4-4h8l4 4v3H4zM12 2v6m-3-3h6"/>',
  cradle: '<path d="M3 14h18a9 9 0 0 1-18 0Zm3-1V9a5 5 0 0 1 5-5h2v9m-6 8-2 2m12-2 2 2"/>',
  comfort: '<path d="M2 17h4l3-2h4a2 2 0 0 0 0-4h-3l2-2m-6 8 4 4 8-4 4-5a1.5 1.5 0 0 0-2-2l-5 4m-12 3v-6h3v6"/>',
  grave: '<path d="M2 21h20M7 21V9a5 5 0 0 1 10 0v12m-7-8h4m-4 3h4"/>',
  shovel: '<path d="m8 16 9-9m-1-4 5 5m-2-2 2-2-3-3-2 2M9 15l-4-1-3 7 7-3z"/>',
  graves: '<path d="M2 21h20M3 21v-8a3 3 0 0 1 6 0v8m4 0V9a4 4 0 0 1 8 0v12m-6-8h4"/>',
  shield: '<path d="M12 2 4 6v6c0 4 3 7 8 10 5-3 8-6 8-10V6zM9 12l2 2 4-4"/>',
  baby: '<circle cx="12" cy="7" r="3"/><path d="M7 10c-4 3-2 9 5 12 7-3 9-9 5-12m-9 3 8 6m0-6-8 6"/>',
  rings: '<circle cx="9" cy="13" r="6"/><path d="M13 8a6 6 0 1 1 1 9m1-12 2-3 3 3-3 3z"/>',
  home: '<path d="M2 12 12 3l10 9M5 10v11h14V10m-9 11v-6h4v6"/>',
  receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8m-8 4h8m-8 4h4"/>',
  wallet: '<path d="M3 6h16v3m-16-3v13h18V9H3m18 3h-7v4h7m-4-2h.1"/>',
  exchange: '<path d="M3 8h17l-4-4M21 16H4l4 4m12-12-4 4M4 16l4-4"/>',
  shop: '<path d="M3 8l2-5h14l2 5v3H3zm2 3v10h14V11m-9 10v-6h4v6m-5-7V8m6 3V8"/>',
  saddle: '<path d="M3 12h4l2 3h7l3-5h2l-2 8H5zM7 18l-2 3m12-3 2 3M7 8h7l2 3"/>',
  case: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M7 10v8m10-8v8"/>',
  village: '<path d="M2 12 7 7l5 5m-8-2v10h6V10m1 2 5-8 6 8m-8-2v10h6V10m-4 10v-4h2v4"/>',
  stumble: '<path d="m2 17 5-4 3 3 4-2 4 4h4m-12-7 3-3 4 1m-4-1 1-4m-2 6 3 3"/><circle cx="15" cy="3" r="1.5"/>',
  wave: '<circle cx="8" cy="6" r="2"/><path d="M4 21v-5a4 4 0 0 1 8 0v5m0-8 4-2 2-4m-2-3 2-2m2 5 2-1"/>',
  hills: '<path d="M2 20 9 7l5 9 3-5 5 9zM7 11l2 1 2-1M17 3v5m-2-3h4"/>',
  dawn: '<path d="M2 17h20M7 17a5 5 0 0 1 10 0M12 6v3m-7 2 2 2m12-2-2 2M4 21h16"/>',
  shelter: '<path d="M2 12 12 3l10 9M5 10v11h14V10m-10 6 3 3 3-3m-3 3v-6"/>',
  returnHome: '<path d="M10 5l5-3 7 7m-2-2v14h-9v-4M3 13h12m-8-4-4 4 4 4"/>',
  wind: '<path d="M2 8h13a3 3 0 1 0-3-3M2 12h17a2.5 2.5 0 1 1 0 5M3 16h7a3 3 0 1 1-3 3"/>',
  thunder: '<path d="M6 13H5a4 4 0 0 1 0-8 5 5 0 0 1 9-1 4.5 4.5 0 0 1 4 9h-2m-4-3-4 7h4l-1 5 6-8h-5z"/>',
  drop: '<path d="M12 3c-2 4-6 7-6 12a6 6 0 0 0 12 0c0-5-4-8-6-12Zm-3 12a3 3 0 0 0 2 3"/>',
  puddle: '<path d="M12 2c-1 2-3 4-3 6a3 3 0 0 0 6 0c0-2-2-4-3-6ZM8 13c-4 .5-6 2-6 4 0 3 5 5 10 5s10-2 10-5c0-2-2-3.5-6-4m-8 4c2 1 6 1 8 0"/>',
  clearing: '<path d="M3 19h15a3 3 0 0 0 0-6 5 5 0 0 0-8-2 4 4 0 0 0-7 3 3 3 0 0 0 0 5Zm10-11a4 4 0 0 1 6 3m-3-9v2m5 1-1 1m3 4h-2"/>',
  scales: '<path d="M12 3v18m-5 0h10M4 7h16M5 7l-3 7h6zm14 0-3 7h6z"/>',
  barrier: '<path d="M3 5h18v14H3zM3 12h18M9 5v7m6 0v7"/>',
  group: '<circle cx="12" cy="8" r="3"/><path d="M7 21v-3a5 5 0 0 1 10 0v3M4 8a2 2 0 0 0 0 4m16-4a2 2 0 0 1 0 4M2 20v-2a4 4 0 0 1 3-4m17 6v-2a4 4 0 0 0-3-4"/>',
  flame: '<path d="M12 2c2 5-2 6 3 9 1-2 3-3 3-3s3 4 3 7a9 9 0 1 1-18 0c0-4 4-6 5-10 1 2 1 4 1 4s3-3 3-7Z"/>',
  spark: '<path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',
  beads: '<circle cx="12" cy="10" r="7" stroke-dasharray="1 2.1" stroke-width="2.8"/><path d="M12 18v4m-2 0h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01"/>',
  bird: '<path d="M2 13c5 0 8-2 10-6 2 4 5 6 10 6-3 2-7 2-10 4-3-2-7-2-10-4Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  other: '<path d="M3 6h7l2 3h9v11H3zM3 6V4h8l2 2h8v3"/>',
};


// Chapter IDs are shared with the local Hisn al-Muslim dataset.
const adhkarCategoryIcons = {
  34: 'worry', 129: 'repent', 86: 'prayFor',
  49: 'patient', 47: 'wedding', 41: 'coin', 95: 'camel', 61: 'rain',
};
const adhkarChapterIcons = {
  0: 'dawn', 28: 'bed', 29: 'evening', 30: 'worry',
  69: 'food', 70: 'food', 71: 'comfort', 72: 'drop', 76: 'spark',
  1: 'clothing', 2: 'clothing', 3: 'clothing', 4: 'clothing',
  5: 'shelter', 6: 'returnHome', 9: 'returnHome', 10: 'home',
  77: 'speech', 78: 'speech', 84: 'group', 85: 'repent', 109: 'handshake',
  7: 'drop', 8: 'drop', 11: 'mosque', 12: 'mosque', 13: 'mosque', 14: 'speech',
  15: 'rug', 16: 'rug', 17: 'rug', 18: 'rug', 19: 'rug', 20: 'rug',
  21: 'rug', 22: 'dua', 23: 'dua', 24: 'beads', 25: 'dua', 32: 'dua', 33: 'beads', 42: 'shield',
  67: 'evening', 68: 'food', 73: 'home', 75: 'speech',
  115: 'kaaba', 117: 'kaaba', 118: 'hills', 119: 'dua', 127: 'camel',
  34: 'worry', 35: 'pulse', 40: 'help', 43: 'barrier', 46: 'alert', 92: 'shield',
  94: 'bird', 126: 'worry', 128: 'shield', 129: 'repent', 130: 'beads',
  86: 'repent', 87: 'comfort', 89: 'handshake', 93: 'spark',
  112: 'prayFor', 113: 'speech', 114: 'scales',
  49: 'patient', 51: 'pulse', 52: 'speech', 53: 'alert', 54: 'closedEye',
  55: 'bier', 56: 'cradle', 57: 'comfort', 58: 'grave', 59: 'shovel',
  60: 'graves', 83: 'shield', 124: 'cross',
  47: 'baby', 48: 'shield', 79: 'rings', 80: 'wedding', 81: 'home',
  41: 'receipt', 90: 'wallet', 91: 'exchange', 98: 'shop',
  95: 'saddle', 96: 'case', 97: 'village', 99: 'stumble', 100: 'wave',
  101: 'prayFor', 102: 'hills', 103: 'dawn', 104: 'shelter', 105: 'returnHome',
  61: 'wind', 62: 'thunder', 63: 'drop', 64: 'rain', 65: 'puddle', 66: 'clearing',
  36: 'scales', 37: 'shield', 38: 'target', 39: 'group', 82: 'flame', 106: 'exchange', 122: 'spark',
};


// The same RTL navigation gesture is used by both readers.
function bindReadingSwipe(surface, navigate) {
  let start;
  let suppressClick = false;
  surface.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.pointerType !== 'touch' || !event.isPrimary ||
        event.target.closest('button, a, input, select, textarea, [contenteditable]')) {
      start = null;
      return;
    }
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  surface.addEventListener('pointercancel', () => { start = null; });
  surface.addEventListener('pointerup', event => {
    const origin = start;
    start = null;
    if (!origin || event.pointerId !== origin.id || window.getSelection()?.type === 'Range') return;
    const x = event.clientX - origin.x;
    const y = event.clientY - origin.y;
    if (Math.abs(x) < 45 || Math.abs(x) < Math.abs(y) * 1.5) return;
    suppressClick = true;
    navigate(x < 0 ? 1 : -1);
  });
  surface.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

let checkAdhkarCycle = () => {};

function renderAdhkarText(value) {
  const text = document.createElement('div');
  text.className = 'adhkar-text';
  const marked = value.replace(/\((قُلْ أَعُوذُ بِرَبِّ النَّاسِ[^()]*\*[^()]*)\)/gu, '{$1}');
  const passages = marked.split(/\{([^{}]+)\}/u);
  for (const [i, passage] of passages.entries()) {
    const content = passage.trim();
    if (!content) continue;
    const line = document.createElement(i % 2 ? 'div' : 'p');
    if (i % 2) {
      line.className = 'adhkar-quran';
      const verses = content.split(/\s*\*\s*/u);
      for (const [n, verse] of verses.entries()) {
        if (n) {
          const separator = document.createElement('span');
          separator.className = 'adhkar-verse-divider';
          separator.setAttribute('aria-hidden', 'true');
          separator.textContent = '۞';
          line.append(separator);
        }
        line.append(verse);
      }
    } else {
      line.textContent = content;
    }
    text.append(line);
  }
  return text;
}

function bindAdhkar() {
  const economy = () => document.documentElement.dataset.performance === 'eco';
  const host = document.getElementById('adhkar-content');
  const back = document.getElementById('adhkar-back');
  const title = document.getElementById('adhkar-title');
  const sourceDialog = document.getElementById('adhkar-source-dialog');
  const sourceText = document.getElementById('adhkar-source-text');
  const resetDialog = document.getElementById('adhkar-reset-dialog');
  const resetTitle = document.getElementById('adhkar-reset-title');
  const resetMessage = document.getElementById('adhkar-reset-message');
  let pendingReset = null;
  let advanceTimer;
  resetDialog.addEventListener('close', () => {
    const reset = pendingReset;
    pendingReset = null;
    if (resetDialog.returnValue === 'reset') reset?.();
  });
  let group = null;
  let category = null;
  let chapter = null;
  let index = 0;
  let counts = [];
  const storageKey = 'mihrab.adhkar-progress.v2';
  let progress = { chapters: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.chapters && typeof saved.chapters === 'object') progress = saved;
  } catch (error) {
    console.warn('Could not read adhkar progress:', error);
  }

  const dailyPrayer = () => group?.icon === 'daily'
    ? ({ 'الصباح': 'fajr', 'المساء': 'asr' })[category?.title] : null;
  function cycle(now = new Date()) {
    const prayer = dailyPrayer();
    if (!prayer || typeof state === 'undefined') return null;
    const data = state.prayerData;
    const at = Math.floor(+new Date(data?.prayers?.find(item => item.id === prayer)?.time) / 60000) * 60000;
    if (!Number.isFinite(at)) return null;
    const zone = data.location?.effectiveTimeZone || data.location?.timeZone;
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = Object.fromEntries(format.formatToParts(new Date(at)).map(part => [part.type, part.value]));
    const day = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    return new Date(day - (+now < at ? 86400000 : 0)).toISOString().slice(0, 10);
  }
  let activeCycle = null;
  function saveProgress() {
    progress.chapterId = dailyPrayer() ? chapter?.id ?? null : null;
    if (chapter && dailyPrayer()) progress.chapters[chapter.id] = { index, counts, cycle: activeCycle };
    try {
      localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch (error) {
      console.warn('Could not save adhkar progress:', error);
    }
  }

  function openChapter(id) {
    chapter = { ...window.mihrabAdhkar.chapters[id], id };
    activeCycle = cycle();
    const record = dailyPrayer() ? progress.chapters[id] : null;
    const saved = record && (!activeCycle || record.cycle === activeCycle) ? record : null;
    index = Number.isInteger(saved?.index) && saved.index >= 0 && saved.index < chapter.entries.length
      ? saved.index : 0;
    counts = chapter.entries.map((entry, i) => {
      const remaining = saved?.counts?.[i];
      return Number.isInteger(remaining) && remaining >= 0 && remaining <= entry.Count
        ? remaining : entry.Count;
    });
  }

  function button(label, action, cls = 'btn btn-secondary') {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = cls;
    node.textContent = label;
    node.addEventListener('click', action);
    return node;
  }
  function cards(rows, select, root = false) {
    const grid = document.createElement('div');
    grid.className = root ? 'adhkar-grid adhkar-grid--root' : 'adhkar-grid';
    for (const row of rows) {
      const card = button(row.title, () => select(row), 'adhkar-category');
      card.dataset.weight = row.weight || 'regular';
      if (!economy()) {
  const key = adhkarChapterIcons[row.id] || adhkarCategoryIcons[row.chapters?.[0]] || row.icon;
        const icon = adhkarIcons[key] || adhkarIcons.other;
        card.insertAdjacentHTML('afterbegin', '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>');
      }
      grid.append(card);
    }
    host.append(grid);
  }
  function goBack() {
    clearTimeout(advanceTimer);
    if (chapter) {
      chapter = null;
      if (category.chapters.length === 1) category = null;
    }
    else if (category) category = null;
    else if (group) group = null;
    else return;
    saveProgress();
    render();
    if (typeof animatePanel === 'function' && host.firstElementChild) animatePanel(host.firstElementChild);
  }

  function move(delta, focusCounter = false) {
    const destination = index + delta;
    if (!chapter || destination < 0 || destination >= chapter.entries.length || resetDialog.open) return;
    clearTimeout(advanceTimer);
    const outgoing = host.querySelector('.adhkar-reading-card:not(.adhkar-reading-card--outgoing)');
    index = destination;
    saveProgress();
    render();
    const incoming = host.querySelector('.adhkar-reading-card');
    const focus = focusCounter ? incoming.querySelector('.adhkar-counter:not(:disabled)') : null;
    (focus || incoming).focus({ preventScroll: true });
    if (incoming.getBoundingClientRect().top < 0) incoming.scrollIntoView({ block: 'start' });
    if (economy() || !outgoing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    outgoing.inert = true;
    outgoing.setAttribute('aria-hidden', 'true');
    outgoing.classList.add('adhkar-reading-card--outgoing');
    host.prepend(outgoing);
    const sign = (delta > 0 ? 1 : -1) * (document.documentElement.dir === 'ltr' ? -1 : 1);
    const timing = { duration: 460, easing: 'cubic-bezier(.22,.72,.26,1)' };
    outgoing.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'translate(' + (sign * 12) + '%, 16px) rotate(' + (sign * 7) + 'deg)', opacity: 0 },
    ], timing).finished.then(() => outgoing.remove(), () => outgoing.remove());
    incoming.animate([
      { transform: 'translate(' + (-sign * 12) + '%, 18px) rotate(' + (-sign * 8) + 'deg)', opacity: 0.25 },
      { transform: 'none', opacity: 1 },
    ], timing);
  }

  function confirmReset(entireChapter) {
    clearTimeout(advanceTimer);
    const targetChapter = chapter;
    const targetIndex = index;
    const targetCycle = activeCycle;
    resetTitle.textContent = entireChapter ? 'إعادة ضبط تقدم الباب' : 'إعادة ضبط الذكر الحالي';
    resetMessage.textContent = entireChapter
      ? 'سيُمسح تقدم جميع أذكار هذا الباب وستعود إلى الذكر الأول.'
      : 'سيعود عدّاد الذكر الحالي إلى عدد تكراراته الأصلي.';
    pendingReset = () => {
      if (chapter !== targetChapter || index !== targetIndex || activeCycle !== targetCycle) return;
      if (entireChapter) {
        index = 0;
        counts = chapter.entries.map(item => item.Count);
      } else {
        counts[index] = chapter.entries[index].Count;
      }
      saveProgress();
      render();
      host.querySelector('.adhkar-counter')?.focus({ preventScroll: true });
    };
    resetDialog.returnValue = '';
    resetDialog.showModal();
  }


  const crumbList = document.createElement('ol');
  title.append(crumbList);
  const overflow = document.createElement('details');
  overflow.className = 'adhkar-crumb-overflow';
  const more = document.createElement('summary');
  more.textContent = '…';
  more.setAttribute('aria-label', 'المستويات السابقة');
  const menu = document.createElement('div');
  menu.className = 'adhkar-crumb-menu';
  overflow.append(more, menu);
  let ancestors = [];

  function fitBreadcrumb() {
    if (!title.clientWidth) return;
    const available = title.clientWidth;
    const current = crumbList.lastElementChild;
    if (!current) return;
    const widths = ancestors.map(({ item }) => {
      item.hidden = false;
      return item.getBoundingClientRect().width;
    });
    overflow.parentElement.hidden = true;
    const currentWidth = current.scrollWidth;
    let total = widths.reduce((sum, width) => sum + width, currentWidth);
    const previous = menu.children.length;
    let omitted = 0;
    if (total > available && ancestors.length) {
      overflow.parentElement.hidden = false;
      total += overflow.parentElement.getBoundingClientRect().width;
      while (omitted < ancestors.length && total > available) {
        total -= widths[omitted];
        ancestors[omitted++].item.hidden = true;
      }
    }
    if (previous === omitted) return;
    overflow.open = false;
    menu.replaceChildren(...ancestors.slice(0, omitted).map(({ label, action }) =>
      button(label, action, 'adhkar-crumb-link')));
  }

  function renderBreadcrumb() {
    const levels = [['الأذكار', () => { group = category = chapter = null; }]];
    if (group) levels.push([group.title, () => { category = chapter = null; }]);
    if (category && (!chapter || category.chapters.length > 1))
      levels.push([category.title, () => { chapter = null; }]);
    if (chapter) levels.push([chapter.title]);
    ancestors = [];
    overflow.open = false;
    menu.replaceChildren();
    const extra = document.createElement('li');
    extra.hidden = true;
    extra.append(overflow);
    crumbList.replaceChildren(extra);
    levels.forEach(([label, navigate], index) => {
      const item = document.createElement('li');
      if (index === levels.length - 1) {
        item.className = 'adhkar-crumb-current';
        item.setAttribute('aria-current', 'page');
        item.tabIndex = -1;
        item.textContent = label;
        item.title = label;
      } else {
        const action = () => {
          clearTimeout(advanceTimer);
          navigate();
          render();
          crumbList.lastElementChild.focus({ preventScroll: true });
        };
        item.append(button(label, action, 'adhkar-crumb-link'));
        ancestors.push({ item, label, action });
      }
      crumbList.append(item);
    });
    fitBreadcrumb();
  }
  new ResizeObserver(fitBreadcrumb).observe(title);
  document.fonts.ready.then(fitBreadcrumb);

  function render() {
    host.replaceChildren();
    renderBreadcrumb();
    back.hidden = !group;
    if (!group) {
      cards(window.mihrabAdhkar.groups, row => { group = row; render(); }, true);
      return;
    }
    if (!category) {
      cards(group.categories, row => {
        category = row;
        if (row.chapters.length === 1) {
          openChapter(row.chapters[0]);
          saveProgress();
        }
        render();
      });
      return;
    }
    if (!chapter) {
      cards(category.chapters.map(id => ({ ...window.mihrabAdhkar.chapters[id], id, icon: category.icon })), row => {
        openChapter(row.id);
        saveProgress();
        render();
      });
      return;
    }
    const entry = chapter.entries[index];
    const position = document.createElement('p');
    position.className = 'meta-pill';
    position.textContent = `الذكر ${index + 1} من ${chapter.entries.length}`;
    const text = renderAdhkarText(entry.Text);
    const reference = document.createElement('a');
    reference.className = 'adhkar-source-link';
    reference.href = '#adhkar-source-dialog';
    reference.textContent = 'عرض المصدر';
    reference.addEventListener('click', event => {
      event.preventDefault();
      sourceText.textContent = entry.Reference || 'حصن المسلم';
      sourceDialog.showModal();
    });
    const controls = document.createElement('div');
    controls.className = 'adhkar-actions';
    const resetIcon = '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 1 1 2 7m-2-7V4m0 7h7"/></svg>';
    const counter = button('', () => {
      if (!counts[index]) return;
      counts[index]--;
      saveProgress();
      updateControls();
      if (!counts[index] && index < chapter.entries.length - 1) {
        const activeChapter = chapter;
        const activeIndex = index;
        advanceTimer = setTimeout(() => {
          if (chapter === activeChapter && index === activeIndex && !counts[index]) move(1, true);
        }, 220);
      }
    }, 'btn btn-primary adhkar-counter');
    counter.setAttribute('aria-live', 'polite');

    const resetCurrent = button('', () => confirmReset(false), 'btn btn-secondary adhkar-reset-current');
    resetCurrent.setAttribute('aria-label', 'إعادة ضبط هذا الذكر');
    resetCurrent.title = 'إعادة ضبط هذا الذكر';
    if (economy()) resetCurrent.textContent = '↺';
    else resetCurrent.insertAdjacentHTML('afterbegin', resetIcon);
    const resetChapter = button('إعادة ضبط التقدم', () => confirmReset(true), 'btn btn-secondary adhkar-reset-chapter');
    if (!economy()) resetChapter.insertAdjacentHTML('afterbegin', resetIcon);
    const counterRow = document.createElement('div');
    counterRow.className = 'adhkar-counter-row';
    counterRow.append(counter, resetCurrent);

    function updateControls() {
      const remaining = counts[index];
      const done = entry.Count - remaining;
      counter.textContent = remaining === 0 ? 'اكتمل الذكر' :
        remaining === 1 ? 'متبقي تكرار واحد' :
        remaining === 2 ? 'متبقي تكراران' :
        remaining <= 10 ? `متبقي ${remaining} تكرارات` : `متبقي ${remaining} تكرارًا`;
      counter.disabled = remaining === 0;
      counter.style.setProperty('--adhkar-progress', (entry.Count ? done / entry.Count : 0) * 100 + '%');
      counter.setAttribute('aria-label', `التكرارات المكتملة ${done} من ${entry.Count}`);
      resetCurrent.hidden = done === 0;
      resetChapter.hidden = !chapter.entries.some((item, i) => counts[i] < item.Count);
    }

    const touch = navigator.maxTouchPoints > 0;
    if (!touch && index > 0) controls.append(button('السابق', () => move(-1)));
    controls.append(counterRow);
    if (!touch && index < chapter.entries.length - 1) controls.append(button('التالي', () => move(1)));

    const sourceLine = document.createElement('p');
    sourceLine.className = 'adhkar-source-line';
    sourceLine.append(resetChapter, reference);
    const card = document.createElement('article');
    card.className = 'adhkar-reading-card';
    card.tabIndex = -1;
    card.setAttribute('aria-label', position.textContent);
    if (touch && chapter.entries.length > 1) {
      const hint = document.createElement('span');
      hint.className = 'adhkar-swipe-hint';
      hint.textContent = 'اسحب أفقيًا للتنقل بين الأذكار';
      card.append(position, hint, text, controls, sourceLine);
    } else {
      card.append(position, text, controls, sourceLine);
    }
    updateControls();
    host.append(card);
  }
  bindReadingSwipe(host, direction => {
    if (chapter && !sourceDialog.open) move(direction);
  });
  back.addEventListener('click', goBack);
  const chapterId = progress.chapterId;
  for (const candidate of window.mihrabAdhkar.groups) {
    const parent = candidate.categories.find(item => item.chapters.includes(chapterId));
    if (parent) {
      group = candidate;
      category = parent;
      openChapter(chapterId);
      break;
    }
  }
  let checkedMinute = -1;
  checkAdhkarCycle = now => {
    if (!chapter || !dailyPrayer()) return;
    const minute = Math.floor(+now / 60000);
    if (checkedMinute === minute) return;
    checkedMinute = minute;
    const current = cycle(now);
    if (!current || current === activeCycle) return;
    if (!activeCycle && !progress.chapters[chapter.id]?.cycle) {
      activeCycle = current;
    } else {
      openChapter(chapter.id);
    }
    saveProgress();
    render();
  };
  window.addEventListener('mihrab:performance-profile', () => {
    for (const animation of host.getAnimations({ subtree: true })) animation.cancel();
    render();
  });
  render();
}
