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
  dua: '<path d="M12 21S3 16 3 9a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 7-9 12-9 12Z"/>',
  other: '<path d="M3 6h7l2 3h9v11H3zM3 6V4h8l2 2h8v3"/>',
};

let checkAdhkarCycle = () => {};

function bindAdhkar() {
  const host = document.getElementById('adhkar-content');
  const back = document.getElementById('adhkar-back');
  const title = document.getElementById('adhkar-title');
  const sourceDialog = document.getElementById('adhkar-source-dialog');
  const sourceText = document.getElementById('adhkar-source-text');
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
      const icon = adhkarIcons[row.icon] || adhkarIcons.other;
      card.insertAdjacentHTML('afterbegin', '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>');
      grid.append(card);
    }
    host.append(grid);
  }
  function goBack() {
    if (chapter) {
      chapter = null;
      if (category.chapters.length === 1) category = null;
    }
    else if (category) category = null;
    else if (group) group = null;
    else return;
    saveProgress();
    render();
  }
  function render() {
    host.replaceChildren();
    title.textContent = chapter?.title || category?.title || group?.title || 'الأذكار';
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
    const text = document.createElement('p');
    text.className = 'adhkar-text';
    text.textContent = entry.Text;
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
    const move = (delta) => { index += delta; saveProgress(); render(); };
    const previous = button('السابق', () => move(-1));
    const next = button('التالي', () => move(1));
    previous.disabled = index === 0;
    next.disabled = index === chapter.entries.length - 1;
    const remaining = counts[index];
    const label = remaining === 1 ? 'متبقي تكرار واحد' :
      remaining === 2 ? 'متبقي تكراران' :
      remaining <= 10 ? `متبقي ${remaining} تكرارات` : `متبقي ${remaining} تكرارًا`;
    const counter = button(remaining ? label : 'اكتمل الذكر', () => {
      if (!counts[index]) return;
      counts[index]--;
      saveProgress();
      render();
      if (!counts[index] && index < chapter.entries.length - 1) {
        const activeChapter = chapter;
        const activeIndex = index;
        setTimeout(() => {
          if (chapter !== activeChapter || index !== activeIndex || counts[index]) return;
          move(1);
          host.querySelector('.adhkar-counter:not(:disabled)')?.focus({ preventScroll: true });
        }, 220);
      } else {
        host.querySelector('.adhkar-counter:not(:disabled)')?.focus({ preventScroll: true });
      }
    }, 'btn btn-primary adhkar-counter');
    counter.disabled = counts[index] === 0;
    counter.setAttribute('aria-live', 'polite');
    controls.append(previous, counter, next);
    const total = chapter.entries.reduce((sum, item) => sum + item.Count, 0);
    const completed = total - counts.reduce((sum, remaining) => sum + remaining, 0);
    const repetitionsDone = entry.Count - remaining;
    counter.style.setProperty('--adhkar-progress', (entry.Count ? repetitionsDone / entry.Count : 0) * 100 + '%');
    counter.setAttribute('aria-label', counter.textContent + '، التكرارات المكتملة ' + repetitionsDone + ' من ' + entry.Count);
    host.append(position, text, controls);
    if (completed > 0) {
      const restart = button('إعادة ضبط التقدّم', () => {
        index = 0;
        counts = chapter.entries.map(item => item.Count);
        saveProgress();
        render();
      });
      restart.insertAdjacentHTML('afterbegin', '<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 1 1 2 7m-2-7V4m0 7h7"/></svg>');
      host.append(restart);
    }
    const sourceLine = document.createElement('p');
    sourceLine.className = 'adhkar-source-line';
    sourceLine.append(reference);
    host.append(sourceLine);
  }
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
  render();
}
