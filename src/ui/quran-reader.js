'use strict';

(() => {
  const scriptBase = new URL('./assets/quran-reader/', document.currentScript.src);
  const data = window.mihrabQuranReaderData = Object.create(null);
  const loads = new Map();
  const $ = id => document.getElementById('quran-reader-' + id);
  const reader = $('dialog');
  const confirmation = $('exit-confirmation');
  const book = $('book');
  const annotation = $('annotation');
  const layout = matchMedia('(min-width: 850px)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'mihrab.quran-reader.v1';
  const highlightPrefix = 'mihrab-tajweed-';
  const canHighlight = typeof Highlight === 'function' && Boolean(CSS.highlights);
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
  if (typeof preferences !== 'object' || Array.isArray(preferences)) preferences = {};
  let session;
  let loading = false;
  let measuredSize = '';
  let updating = false;
  let migration;

  function publish(status) {
    window.dispatchEvent(new CustomEvent('mihrab:quran-state', { detail: status }));
  }

  function removeMigratedBookmarks(status) {
    const bookmarks = { ...preferences.bookmarks };
    let changed = false;
    for (const slot of Object.keys(bookmarks)) {
      if (status.settings[slot.split(':')[0]]?.bookmark === undefined) continue;
      delete bookmarks[slot];
      changed = true;
    }
    if (changed) persist({ ...preferences, bookmarks });
  }

  window.migrateQuranBookmarks = function (status) {
    if (migration) return migration;
    if (!status?.settings || !preferences.bookmarks) return Promise.resolve(status);
    const pending = ['reading', 'hifz'].flatMap(kind => {
      if (status.settings[kind]?.bookmark !== undefined) return [];
      const mark = preferences.bookmarks[kind + ':' + status.riwaya]?.[0];
      return mark ? [[kind, mark]] : [];
    });
    if (!pending.length) {
      try { removeMigratedBookmarks(status); } catch {}
      return Promise.resolve(status);
    }
    migration = (async () => {
      let latest = status;
      for (const [kind, mark] of pending)
        latest = await window.mihrabApi.saveQuranBookmark(kind, { ...mark, riwaya: status.riwaya }, true);
      try { removeMigratedBookmarks(latest); } catch {}
      publish(latest);
      return latest;
    })().finally(() => { migration = null; });
    return migration;
  };

  const numeral = new Intl.NumberFormat('ar', { numberingSystem: 'arab', useGrouping: false });
  const n = value => numeral.format(value);

  function load(name) {
    if (data[name]) return Promise.resolve(data[name]);
    if (loads.has(name)) return loads.get(name);
    const file = name === 'tajweed' ? 'tajweed-hafs' : name;
    const job = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(file + '.js', scriptBase);
      script.onload = () => {
        script.remove();
        if (data[name]) resolve(data[name]);
        else reject(new Error('ملف القراءة غير مكتمل.'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('تعذر فتح ملف القراءة المحلي.'));
      };
      document.head.append(script);
    }).finally(() => loads.delete(name));
    loads.set(name, job);
    return job;
  }

  function persist(next) {
    localStorage.setItem(key, JSON.stringify(next));
    preferences = next;
  }

  function notify(message = '') {
    $('status').textContent = message;
  }

  const interfaceNumber = value => new Intl.NumberFormat(document.documentElement.lang || 'ar', { useGrouping: false }).format(value);

  function readerSurahName(surah) {
    return ui('surah.name.' + surah.number, surah.name);
  }

  function refText(index) {
    const surah = session.range.surahs.find(row => row.start <= index && index <= row.end);
    const ayah = index - surah.start + 1;
    const locale = window.mihrabLocale;
    return locale.has('reader.verseReference')
      ? locale.t('reader.verseReference', {
          surah: readerSurahName(surah),
          ayah: document.documentElement.lang === 'ar' ? n(ayah) : ayah,
        })
      : surah.name + '، الآية ' + n(ayah);
  }

  function refreshSelection() {
    const selected = session.selected;
    for (const verse of book.querySelectorAll('[data-verse]')) {
      verse.setAttribute('aria-pressed', String(Number(verse.dataset.verse) === selected));
    }
    $('bookmark').textContent = selected === null ? window.mihrabLocale.t('reader.selectVerse')
      : window.mihrabLocale.t(session.drafts.has(session.riwaya) ? 'reader.unsavedPosition' : 'reader.savedPosition',
        { verse: refText(selected) });
  }

  function clearHighlights() {
    if (!canHighlight) return;
    for (let i = 0; i < 7; i++) CSS.highlights.delete(highlightPrefix + i);
  }

  const daylightLabels = [
    '', 'الإدغام والإخفاء', 'النون والتنوين', 'الميم الساكنة',
    'المشددتان', 'المد المتصل والمنفصل واللازم', 'القلقلة',
  ];

  function daylightRule(topic, name) {
    if (topic === 0 || /^الإظهار|^إظهار/u.test(name)) return false;
    return topic !== 5 || /^المد (الواجب|الجائز|اللازم)/u.test(name);
  }

  function applyHighlights() {
    clearHighlights();
    if ($('legend').hidden) return;
    const tajweed = data.tajweed;
    const highlights = tajweed.topics.map(() => new Highlight());
    const daylight = reader.dataset.tajweedTone !== 'bright';
    for (const verse of book.querySelectorAll('[data-verse]')) {
      const text = verse.firstChild;
      const spans = tajweed.verses[Number(verse.dataset.verse)] || [];
      for (const [start, end, id] of spans) {
        const offset = Number(verse.dataset.textOffset || 0);
        const from = Math.max(0, start - offset);
        const to = Math.min(text.length, end - offset);
        if (from >= to) continue;
        const [topic, name] = tajweed.rules[id];
        if (daylight && !daylightRule(topic, name)) continue;
        const span = new Range();
        span.setStart(text, from);
        span.setEnd(text, to);
        highlights[topic].add(span);
      }
    }
    const priority = [0, 1, 4, 3, 5, 2, 6];
    for (const [topic, highlight] of highlights.entries()) {
      highlight.priority = priority[topic];
      CSS.highlights.set(highlightPrefix + topic, highlight);
    }
  }

  const brightRuleKeys = ['tafkheem', 'relations', 'noon', 'meem', 'mushaddadat', 'madd', 'qalqalah'];
  const daylightRuleKeys = ['', 'idgham', 'noon', 'meem', 'mushaddadat', 'maddTypes', 'qalqalah'];

  function syncLegend() {
    const visible = canHighlight && $('tajweed').checked && session?.riwaya === 'hafs' && data.tajweed;
    const legend = $('legend');
    const rules = $('legend-rules');
    legend.hidden = !visible;
    const tone = reader.dataset.tajweedTone;
    const lang = document.documentElement.lang;
    const signature = tone + ':' + lang;
    if (!visible || rules.dataset.tone === signature) return;
    rules.replaceChildren();
    rules.dataset.tone = signature;
    const labels = tone === 'bright' ? data.tajweed.topics : daylightLabels;
    for (const [topic, label] of labels.entries()) {
      if (!label) continue;
      const item = document.createElement('span');
      item.className = 'quran-reader-rule quran-reader-rule-color-' + topic;
      const key = 'tajweed.transliteration.' + (tone === 'bright' ? brightRuleKeys : daylightRuleKeys)[topic];
      item.setAttribute('data-no-ui-translation', '');
      item.dir = lang === 'ar' ? 'rtl' : 'ltr';
      item.textContent = window.mihrabLocale.has(key) ? window.mihrabLocale.t(key) : label;
      rules.append(item);
    }
  }

  window.addEventListener('mihrab:interface-language-changed', syncLegend);

  function renderPage(page, { corpus, range } = session) {
    const paper = document.createElement('section');
    paper.className = 'quran-reader-page';
    const original = corpus.units.page[page.number - 1];
    const opening = page.number <= 2 && page.start === original[0] && page.end === original[1];
    if (opening) paper.classList.add('quran-reader-opening');
    paper.setAttribute('aria-label', window.mihrabLocale.t('reader.mushafPage', { page: interfaceNumber(page.number) }));
    const body = document.createElement('div');
    body.className = 'quran-reader-page-body';
    paper.append(body);
    const flow = document.createElement('div');
    flow.className = 'quran-reader-page-flow';
    body.append(flow);
    const surahs = range.surahs.filter(surah => surah.start <= page.end && surah.end >= page.start);
    const corner = document.createElement('div');
    corner.className = 'quran-reader-running-title';
    corner.textContent = surahs[0].name;
    const content = opening ? document.createElement('div') : flow;
    if (opening) {
      body.append(corner);
      content.className = 'quran-reader-opening-content';
      flow.append(content);
    } else {
      body.insertBefore(corner, flow);
    }
    const text = document.createElement('div');
    text.className = 'quran-reader-verses';
    for (const surah of surahs) {
      const first = Math.max(surah.start, page.start);
      const last = Math.min(surah.end, page.end);
      if (first === surah.start && (first !== page.start || !page.startOffset)) {
        const title = document.createElement(first === page.start ? 'h3' : 'span');
        title.textContent = 'سورة ' + surah.name;
        if (first === page.start) content.append(title);
        else { title.className = 'quran-reader-inline-surah'; text.append(' ', title, ' '); }
        if (surah.basmala) {
          const basmala = document.createElement(first === page.start ? 'p' : 'span');
          basmala.className = 'quran-reader-basmala';
          basmala.textContent = surah.basmala;
          if (first === page.start) content.append(basmala);
          else text.append(basmala, ' ');
        }
      }
      for (let i = first; i <= last; i++) {
        const verse = document.createElement('span');
        verse.setAttribute('role', 'button');
        verse.tabIndex = 0;
        verse.className = 'quran-reader-verse';
        verse.dataset.verse = String(i);
        verse.dataset.surah = String(surah.number);
        verse.textContent = corpus.verses[i];
        verse.setAttribute('aria-label', 'تحديد سورة ' + surah.name + '، الآية ' + n(i - surah.start + 1) + ' · ' + verse.textContent);
        if (i !== first) text.append(' ');
        text.append(verse);
      }
    }
    const baseline = document.createElement('span');
    baseline.className = 'quran-reader-baseline';
    baseline.setAttribute('aria-hidden', 'true');
    text.append(baseline);
    content.append(text);
    const number = document.createElement('footer');
    const clippedAtStart = page.start === range.start && page.start > original[0];
    const clippedAtEnd = page.end === range.end && page.end < original[1];
    const boundary = [
      clippedAtStart && window.mihrabLocale.t('reader.rangeStartsHere'),
      clippedAtEnd && window.mihrabLocale.t('reader.rangeEndsHere'),
    ].filter(Boolean).join(' · ');
    number.textContent = boundary ? n(page.number) + ' · ' + boundary : n(page.number);
    if (boundary) {
      number.className = 'quran-reader-range-cut';
      paper.classList.add('quran-reader-clipped');
    }
    paper.classList.toggle('quran-reader-cut-start', clippedAtStart);
    paper.classList.toggle('quran-reader-cut-end', clippedAtEnd);
    for (const atStart of [true, false]) {
      if (!(atStart ? clippedAtStart : clippedAtEnd)) continue;
      const divider = document.createElement('div');
      divider.className = 'quran-reader-end-divider';
      divider.setAttribute('aria-hidden', 'true');
      divider.textContent = '* * * *';
      if (atStart) content.insertBefore(divider, content.firstChild === corner ? corner.nextSibling : content.firstChild);
      else content.append(divider);
    }
    paper.append(number);
    return paper;
  }

  function pageCount() { return layout.matches ? 2 : 1; }

  function paperFits(paper, size, body, frame) {
    paper.style.setProperty('--reader-type-size', size + 'px');
    return body.scrollHeight <= body.clientHeight &&
      body.scrollWidth <= body.clientWidth + 1 &&
      (!frame || frame.offsetHeight <= frame.parentElement.clientHeight * .64);
  }

  function naturalLastLine(block) {
    const rect = block.getBoundingClientRect();
    const left = block.lastElementChild.getBoundingClientRect().left;
    return Math.max(0, Math.min(1, (rect.right - left) / Math.max(1, rect.width)));
  }

  const wordWidths = new Map();
  let wordCanvas;
  let useWordEstimate = false;
  const verseWords = new WeakMap();

  function estimatedLines(page, corpus, width, size, referenceSize, riwaya) {
    if (typeof OffscreenCanvas !== 'function') return null;
    wordCanvas ??= new OffscreenCanvas(1, 1).getContext('2d');
    if (!wordCanvas) return null;
    const font = referenceSize + 'px ' + (riwaya === 'warsh' ? 'MihrabReaderWarsh' : 'MihrabReaderHafs');
    let widths = wordWidths.get(font);
    if (!widths) {
      if (wordWidths.size === 16) wordWidths.delete(wordWidths.keys().next().value);
      wordWidths.set(font, widths = new Map());
    }
    wordCanvas.font = font;
    wordCanvas.direction = 'rtl';
    function widthOf(word) {
      let measured = widths.get(word);
      if (measured === undefined) {
        measured = wordCanvas.measureText(word).width;
        if (widths.size < 4096) widths.set(word, measured);
      }
      return measured;
    }
    let byVerse = verseWords.get(corpus);
    if (!byVerse) verseWords.set(corpus, byVerse = new Map());
    const scale = size / referenceSize;
    const gap = widthOf(' ') * scale;
    let lines = 1, used = 0;
    for (let index = page.start; index <= page.end; index++) {
      let words = byVerse.get(index);
      if (!words) byVerse.set(index, words = corpus.verses[index].split(/\s+/u).filter(Boolean));
      for (const word of words) {
        const advance = widthOf(word) * scale;
        if (used && used + gap + advance > width) {
          ++lines;
          used = 0;
        }
        used += used ? gap + advance : advance;
      }
    }
    return lines;
  }

  function fitPage(page, preferred) {
    const steps = fitPageSteps(page, preferred);
    let step;
    do { step = steps.next(); } while (!step.done);
    return step.value;
  }

  function* fitPageSteps(page, preferred, context = session, surface = book) {
    const paper = renderPage(page, context);
    const width = Math.floor(surface.clientWidth / pageCount()) - (pageCount() === 2 ? 1 : 0);
    const height = surface.clientHeight;
    const minimum = Math.min(16, width / 18);
    const maximum = Math.min(36, Math.max(22, width / 13));
    paper.classList.add('quran-reader-probe');
    paper.inert = true;
    paper.style.width = width + 'px';
    paper.style.height = height + 'px';
    const body = paper.firstElementChild;
    const block = body.querySelector('.quran-reader-verses');
    const frame = paper.querySelector('.quran-reader-opening-content');
    const fits = size => paperFits(paper, size, body, frame);
    surface.append(paper);
    try {
      yield;
      if (preferred != null && fits(preferred))
        return { size: preferred, leading: 0 };
      let low = Math.min(minimum, preferred ?? maximum);
      let high = preferred ?? maximum;
      while (low > 1 && !fits(low)) { low /= 2; yield; }
      // Estimate a starting bracket without changing the browser's shaping or line breaks.
      if (useWordEstimate && preferred == null && !frame && !paper.classList.contains('quran-reader-clipped')) {
        const textWidth = block.clientWidth;
        const availableHeight = body.clientHeight - (block.offsetTop - body.offsetTop);
        const riwaya = context.riwaya ?? surface.parentElement?.dataset.riwaya ?? reader.dataset.riwaya;
        const referenceSize = 24;
        let floor = low, ceiling = high;
        for (let pass = 0; pass < 4; pass++) {
          const size = Math.round((floor + ceiling) / 2);
          yield;
          const lines = estimatedLines(page, context.corpus, textWidth, size, referenceSize, riwaya);
          if (lines == null || size <= floor || size >= ceiling) break;
          if (lines * size * 1.75 <= availableHeight) floor = size;
          else ceiling = size;
        }
        for (const size of [floor, Math.min(high, floor + 1)]) {
          yield;
          if (size > low && size < high) {
            if (fits(size)) low = size;
            else high = size;
          }
        }
      }
      while (high - low > .1) {
        yield;
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
      }
      const opening = paper.classList.contains('quran-reader-opening');
      if (preferred != null || opening) return { size: low, leading: 0 };

      // Prefer the largest fitting size whose last line can be justified naturally.
      let best = { size: low, line: 0 };
      for (let size = low; size >= Math.min(low, Math.max(low * .87, minimum)); size -= .25) {
        yield;
        if (!fits(size)) continue;
        const line = naturalLastLine(block);
        if (line >= .9) {
          best = { size, line };
          break;
        }
        if (line > best.line) best = { size, line };
      }
      yield;
      const { size, line } = best;
      paper.style.setProperty('--reader-type-size', size + 'px');
      const leading = parseFloat(getComputedStyle(block).lineHeight);
      const justifyLast = line >= .9;
      if (justifyLast) block.style.textAlignLast = 'justify';
      let extra = 0;
      // Each line consumes at least one increment. Bound the search by its
      // current height and the unused space, allowing for pixel rounding.
      const textHeight = block.getBoundingClientRect().height;
      const lineCount = Math.max(1, Math.round(textHeight / leading));
      const unused = body.getBoundingClientRect().bottom - block.getBoundingClientRect().bottom;
      let limit = paper.classList.contains('quran-reader-clipped') ? body.clientHeight
        : Math.min(body.clientHeight, Math.max(0, unused + 2) / lineCount + 2);
      while (limit - extra > .1) {
        yield;
        const middle = (extra + limit) / 2;
        paper.style.setProperty('--reader-leading', leading + middle + 'px');
        if (fits(size)) extra = middle;
        else limit = middle;
      }
      return { size, leading: leading + extra, justifyLast };
    } finally {
      paper.remove();
    }
  }

  function pageAt(index) {
    return session.range.pages.find(page => page.start <= index && index <= page.end);
  }

  function adjacentPage(page, direction) {
    const pages = session.range.pages;
    return pages[pages.indexOf(page) + direction];
  }

  function visiblePages(first) {
    const second = pageCount() === 2 ? adjacentPage(first, 1) : null;
    return second ? [first, second] : [first];
  }

  function turnTarget(direction) {
    if (direction > 0) return adjacentPage(session.visiblePages.at(-1), 1);
    const prior = adjacentPage(session.visiblePages[0], -1);
    return (prior && pageCount() === 2 && adjacentPage(prior, -1)) || prior;
  }

  function completePage(page, corpus) {
    const [start, end] = corpus.units.page[page.number - 1];
    return page.start === start && page.end === end;
  }

  function makePaper(page) {
    const metrics = pageMetrics(page);
    const paper = renderPage(page);
    paper.style.setProperty('--reader-type-size', metrics.size + 'px');
    if (metrics.leading) paper.style.setProperty('--reader-leading', metrics.leading + 'px');
    if (metrics.justifyLast) paper.classList.add('quran-reader-fill-last');
    return paper;
  }

  const cacheTTL = 5 * 60 * 1000;
  let expiryTimer;
  let windowTimer, windowIdle;
  let windowGeneration = 0;

  function pageMetrics(page) {
    const { corpus, range, pageSizes } = session;
    if (!pageSizes.has(page)) {
      const sampleLimit = document.documentElement.dataset.performance === 'eco' ? 1 : 3;
      const middle = range.pages.filter(leaf => completePage(leaf, corpus));
      const nearby = page === range.pages[0] ? middle.slice(0, sampleLimit) : middle.slice(-sampleLimit);
      const sample = middle.filter(leaf => pageSizes.has(leaf));
      if (!sample.length) sample.push(...nearby);
      let preferred;
      if (!completePage(page, corpus) && sample.length) {
        preferred = sample.reduce((sum, leaf) => sum + pageMetrics(leaf).size, 0) / sample.length;
      }
      pageSizes.set(page, fitPage(page, preferred));
    }
    return pageSizes.get(page);
  }

  function warmWindow(page) {
    const active = session;
    const generation = ++windowGeneration;
    clearTimeout(expiryTimer);
    const pages = active.range.pages;
    const start = pages.indexOf(page);
    const profile = window.mihrabPerformance?.profile.id;
    const lookahead = profile === 'eco' ? 0 : profile === 'balanced' ? 4 : 5;
    const ahead = start;
    const retainedPages = pages.slice(Math.max(0, start - (lookahead ? 4 : 0)), Math.max(start + pageCount(), ahead + lookahead + 1));
    for (const cached of active.pageSizes.keys()) {
      if (!retainedPages.includes(cached)) active.pageSizes.delete(cached);
    }
    // Fit the next spread first, then fill the rest of the cache window.
    const following = start + pageCount();
    const upcoming = lookahead
      ? [...pages.slice(following, Math.max(following, ahead + lookahead)),
        ...pages.slice(Math.max(0, start - pageCount()), start)]
        .filter(leaf => !active.pageSizes.has(leaf))
      : [];
    function step(deadline) {
      if (active !== session || generation !== windowGeneration || !reader.open || resizePending) return;
      if (document.hidden || window.mihrabPerformance?.profile.id === 'eco') return;
      if (book.getAnimations({ subtree: true }).length || (deadline && deadline.timeRemaining() < 10)) {
        schedule();
        return;
      }
      const next = upcoming.shift();
      if (!next) return;
      warmPage(next).then(() => {
        if (upcoming.length && generation === windowGeneration) schedule();
      }).catch(console.warn);
    }
    async function warmPage(page) {
      if (active.pageSizes.has(page)) return;
      const steps = fitPageSteps(page);
      try {
        for (;;) {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (active !== session || generation !== windowGeneration || resizePending || !reader.open) return;
          const step = steps.next();
          if (step.done) {
            active.pageSizes.set(page, step.value);
            return;
          }
        }
      } finally { steps.return(); }
    }
    function schedule() {
      windowTimer = setTimeout(() => {
        if (window.requestIdleCallback) windowIdle = requestIdleCallback(step);
        else step();
      }, 30);
    }
    clearTimeout(windowTimer);
    if (windowIdle !== undefined) window.cancelIdleCallback?.(windowIdle);
    if (!resizePending && upcoming.length) schedule();
    expiryTimer = setTimeout(() => {
      if (session === active) active.pageSizes.clear();
    }, cacheTTL);
  }

  function syncPagination() {
    syncLegend();
    const size = [book.clientWidth, book.clientHeight, pageCount()].join(':');
    if (measuredSize !== size) {
      session.pageSizes.clear();
      session.meanTypeSize = null;
    }
    measuredSize = size;
  }

  function render(anchor = null) {
    closeAnnotation();
    closeTranslation();
    updateTranslationControls();
    if (verticalReading()) {
      renderVertical(anchor ?? verticalAnchor());
      return;
    }
    $('previous').hidden = $('next').hidden = false;
    viewport.scrollTop = 0;
    syncPagination();
    const first = pageAt(session.viewStart);
    if (!first) return;
    session.viewStart = first.start;
    const visible = session.visiblePages = visiblePages(first);
    session.viewEnd = visible.at(-1).end;
    const pages = visible.map(makePaper);
    if (pageCount() === 2 && visible.length === 1) {
      const blank = document.createElement('div');
      blank.className = 'quran-reader-page quran-reader-empty-leaf';
      blank.textContent = 'نهاية الورد';
      pages.push(blank);
    }
    book.replaceChildren(...pages);
    $('previous').disabled = !adjacentPage(first, -1);
    $('next').disabled = !adjacentPage(visible.at(-1), 1);
    $('page-number').textContent = window.mihrabLocale.t('reader.mushafPage', { page: visible.map(page => interfaceNumber(page.number)).join(' – ') });
    $('surah').value = QuranReaderModel.reference(session.range.surahs, anchor ?? first.start)?.surah || '';
    customSelects.get($('surah'))?.sync();
    refreshSelection();
    applyHighlights();
  }

  function goToVerse(index) {
    if (verticalReading() && book.querySelector('.quran-translation-row')) {
      jumpVertical(index);
      return;
    }
    session.viewStart = index;
    render(index);
    if (!verticalReading()) warmWindow(pageAt(index));
  }

  function resumeSpread(index, mark) {
    if (verticalReading()) {
      render(index);
      return;
    }
    syncPagination();
    if (pageCount() === 2) {
      const { start, end } = session.range;
      const sameRange = mark?.rangeStart === start && mark?.rangeEnd === end;
      if (sameRange && Number.isInteger(mark.spreadStart) && mark.spreadStart >= start && mark.spreadStart <= index) {
        const first = pageAt(mark.spreadStart);
        const last = visiblePages(first).at(-1);
        if (index <= last.end) {
          session.viewStart = first.start;
          render(index);
          warmWindow(first);
          return;
        }
      }
      // Older bookmarks record only an ayah. Use the parity of the source pages.
      const page = pageAt(index);
      if (page.start > start && (page.number - session.range.pages[0].number) % 2 === 1) {
        const previous = adjacentPage(page, -1);
        session.viewStart = previous.start;
        render(index);
        warmWindow(previous);
        return;
      }
    }
    goToVerse(index);
  }

  function currentMark(index) {
    return {
      index,
      rangeStart: session.range.start,
      rangeEnd: session.range.end,
      ...(!verticalReading() && pageCount() === 2 && { spreadStart: session.viewStart }),
    };
  }

  function turn(direction) {
    if (!session?.range || loading || resizePending || confirmation.open || verticalReading()) return;
    const target = turnTarget(direction);
    if (!target) return;

    const leaves = book.querySelectorAll('.quran-reader-page:not(.quran-reader-turning, .quran-reader-empty-leaf)');
    const leaf = direction > 0 ? leaves[leaves.length - 1] : leaves[0];
    const snapshot = !reduceMotion.matches && window.mihrabPerformance?.profile.id === 'full' && pageCount() === 2 ? leaf.cloneNode(true) : null;
    const position = snapshot && { left: leaf.offsetLeft, width: leaf.offsetWidth, height: leaf.offsetHeight };
    session.viewStart = target.start;
    render();
    warmWindow(target);
    $('page-number').focus({ preventScroll: true });
    if (reduceMotion.matches || window.mihrabPerformance?.profile.id === 'eco') return;
    if (!snapshot) {
      book.firstElementChild.animate([
        { transform: 'translateX(' + (-direction * 16) + 'px)', opacity: .55 },
        { transform: 'none', opacity: 1 },
      ], { duration: 260, easing: 'cubic-bezier(.2,.65,.3,1)' });
      return;
    }
    snapshot.inert = true;
    snapshot.setAttribute('aria-hidden', 'true');
    snapshot.classList.add('quran-reader-turning');
    Object.assign(snapshot.style, {
      left: position.left + 'px', width: position.width + 'px',
      height: position.height + 'px', transformOrigin: direction > 0 ? 'right center' : 'left center',
    });
    book.append(snapshot);
    snapshot.animate([
      { transform: 'rotateY(0deg)', opacity: 1 },
      { transform: 'rotateY(' + (direction * 92) + 'deg)', opacity: .94, offset: .55 },
      { transform: 'rotateY(' + (direction * 164) + 'deg)', opacity: 0 },
    ], { duration: 480, easing: 'cubic-bezier(.3,.1,.2,1)' }).finished.then(
      () => snapshot.remove(), () => snapshot.remove(),
    );
  }

  async function setEdition(riwaya) {
    loading = true;
    $('riwaya').disabled = true;
    $('surah').disabled = true;
    notify('جارٍ فتح المصحف…');
    try {
      const active = session;
      const corpus = await load(riwaya);
      if (active !== session) return;
      const range = QuranReaderModel.open(corpus, session.assignment);
      const storedMark = session.bookmark?.riwaya === riwaya ? session.bookmark : null;
      const saved = QuranReaderModel.resume(range, storedMark ? [storedMark] : []);
      const draft = session.drafts.get(riwaya);
      const selected = draft?.index ?? saved;
      Object.assign(session, { corpus, riwaya, range, selected, saved, pageSizes: new Map(), meanTypeSize: null });
      reader.dataset.riwaya = riwaya;
      const font = riwaya === 'hafs' ? 'MihrabReaderHafs' : 'MihrabReaderWarsh';
      await document.fonts.load('20px ' + font);
      if (active !== session) return;
      $('riwaya').value = riwaya;
      $('range').textContent = refText(range.start) + ' — ' + refText(range.end);
      $('surah').replaceChildren(...range.surahs.map(surah => new Option(readerSurahName(surah), surah.number)));
      await refreshTajweed();
      await loadTranslation();
      if (active === session) resumeSpread(selected ?? range.start, draft ?? storedMark);
    } finally {
      loading = false;
      $('riwaya').disabled = false;
      $('surah').disabled = false;
    }
  }

  async function refreshTajweed() {
    const active = session;
    const supported = active.riwaya === 'hafs' && canHighlight;
    $('tajweed').disabled = !supported;
    $('tajweed').checked = supported && Boolean(preferences.tajweed);
    $('tajweed-note').textContent = active.riwaya === 'warsh' ? 'تلوين التجويد متاح لحفص حالياً.'
      : !canHighlight ? 'عرض التلوين غير مدعوم في إصدار محرّك العرض هذا.' : '';
    try {
      if ($('tajweed').checked) await load('tajweed');
      if (active === session) notify();
    } catch (error) {
      if (active !== session) return;
      $('tajweed').checked = false;
      notify(error.message);
    }
  }

  async function start(kind, opener) {
    if (session || reader.open) return;
    const active = session = { kind, opener, drafts: new Map() };
    $('title').textContent = kind === 'hifz' ? 'مصحف الحفظ والمراجعة' : 'مصحف الورد';
    $('settings').open = false;
    $('range').textContent = '';
    $('bookmark').textContent = '';
    $('page-number').textContent = '';
    $('previous').disabled = true;
    $('next').disabled = true;
    $('complete').disabled = true;
    $('complete').querySelector('span').textContent = kind === 'hifz' ? 'أتممت ورد الحفظ والمراجعة' : 'أتممت ورد القراءة';
    $('riwaya').disabled = true;
    $('surah').disabled = true;
    $('tajweed').disabled = true;
    book.replaceChildren();
    const theme = ['paper', 'night', 'app'].includes(preferences.theme) ? preferences.theme : 'paper';
    reader.dataset.paper = $('theme').value = theme;
    updateTajweedPalette();
    updateTranslationControls();
    reader.showModal();
    notify('جارٍ فتح الورد…');
    try {
      const status = await window.migrateQuranBookmarks(await window.mihrabApi.getQuranStatus());
      if (active !== session) return;
      active.assignment = status[kind + 'Summary'];
      active.bookmark = status.settings?.[kind]?.bookmark || null;
      await setEdition(status.riwaya);
      if (active === session) $('complete').disabled = false;
    } catch (error) {
      if (active === session) notify(error.message);
    }
  }

  function leave() {
    if (updating) return;
    closeAnnotation();
    $('settings').open = false;
    if (session?.drafts.size) {
      if (!confirmation.open) confirmation.showModal();
    } else reader.close();
  }

  async function saveMark(riwaya, { index, rangeStart, rangeEnd, spreadStart }) {
    const ref = QuranReaderModel.reference(data[riwaya].surahs, index);
    const status = await window.mihrabApi.saveQuranBookmark(session.kind, {
      ...ref, riwaya, rangeStart, rangeEnd, spreadStart,
    });
    session.bookmark = status.settings[session.kind].bookmark;
    publish(status);
  }

  function closeAnnotation() {
    annotation.hidden = true;
  }

  function showAnnotation(verse, pointer) {
    const rectangles = [...verse.getClientRects()];
    const rect = rectangles.find(box => pointer.clientY >= box.top && pointer.clientY <= box.bottom) || rectangles[0];
    if (!rect) return;
    annotation.hidden = false;
    const width = annotation.offsetWidth;
    const height = annotation.offsetHeight;
    const left = Math.max(8, Math.min(reader.clientWidth - width - 8, (rect.left + rect.right - width) / 2));
    const top = rect.top >= height + 10 ? rect.top - height - 6 : rect.bottom + 6;
    Object.assign(annotation.style, { left: left + 'px', top: top + 'px' });
    if (pointer.detail === 0) annotation.focus({ preventScroll: true });
  }

  function updateTajweedPalette() {
    const rgb = getComputedStyle(reader).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    const brightInk = rgb?.length === 3 && rgb[0] * .213 + rgb[1] * .715 + rgb[2] * .072 > 138;
    reader.dataset.tajweedTone = brightInk ? 'bright' : 'deep';
  }

  async function saveAndLeave() {
    if (updating) return;
    updating = true;
    try {
      const draft = session.drafts.get(session.riwaya);
      const latest = draft ? [session.riwaya, draft] : [...session.drafts].at(-1);
      if (latest) await saveMark(...latest);
      confirmation.close();
      reader.close();
    } catch {
      $('exit-error').textContent = 'تعذر حفظ الموضع على هذا الجهاز. يمكنك البقاء في المصحف أو الخروج دون حفظ.';
    } finally {
      updating = false;
    }
  }

  $('complete').addEventListener('click', async () => {
    if (updating || loading || !session?.assignment) return;
    updating = true;
    $('complete').disabled = true;
    try {
      const { unit, startNumber, endNumber, riwaya } = session.assignment;
      const updated = await window.mihrabApi.advanceQuranProgress(session.kind, { unit, startNumber, endNumber, riwaya });
      reader.close();
      publish(updated);
      window.showSuccessFeedback?.('تم إتمام الورد وتحديث نطاق المتابعة.');
    } catch (error) {
      notify(error.message || 'تعذّر إتمام الورد.');
    } finally {
      updating = false;
      $('complete').disabled = false;
    }
  });

  const translationCard = $('translation-card');
  const viewport = book.parentElement;
  const translationLanguages = new Set(['en', 'id', 'ur', 'bn', 'fr', 'tr']);
  const translationLanguage = () => translationLanguages.has(preferences.translationLanguage)
    ? preferences.translationLanguage : 'en';
  const translationKey = () => 'translation-' + translationLanguage();
  const ui = (key, fallback) => window.mihrabLocale.has(key) ? window.mihrabLocale.t(key) : fallback;
  let translationRequest = 0;
  let viewChange = 0;
  let hold = null;
  let suppressClick = null;
  let hideTimer = 0;
  let scrollFrame = 0;

  function currentTranslation() {
    return session?.riwaya === 'hafs' && preferences.translationEnabled ? data[translationKey()] : null;
  }

  function verticalReading() {
    return Boolean(currentTranslation() && preferences.translationView === 'vertical');
  }

  function closeTranslation() {
    clearTimeout(hideTimer);
    translationCard.hidden = true;
    translationCard.replaceChildren();
  }

  function updateTranslationControls() {
    const supported = session?.riwaya === 'hafs';
    $('translation-enabled').disabled = !supported;
    $('translation-enabled').checked = supported && Boolean(preferences.translationEnabled);
    $('translation-language').disabled = !supported || !preferences.translationEnabled;
    $('translation-language').value = translationLanguage();
    customSelects.get($('translation-language'))?.sync();
    $('translation-note').hidden = supported || !session?.riwaya;
    const mode = $('view-mode');
    mode.disabled = !currentTranslation();
    mode.setAttribute('aria-pressed', String(verticalReading()));
    const label = verticalReading()
      ? ui('reader.translationPages', 'عرض الصفحات')
      : ui('reader.translationVertical', 'عرض الآيات والترجمة عموديًا');
    mode.title = label;
    mode.setAttribute('aria-label', label);
    reader.dataset.translationView = verticalReading() ? 'vertical' : 'pages';
  }

  async function loadTranslation() {
    const request = ++translationRequest;
    const active = session;
    if (active?.riwaya !== 'hafs' || !preferences.translationEnabled) return;
    try {
      await load(translationKey());
      if (active === session && request === translationRequest) notify();
    } catch {
      if (active === session && request === translationRequest)
        notify(ui('reader.translationLoadFailed', 'تعذر فتح ملف الترجمة المحلي.'));
    }
  }

  function translationContent(index) {
    const pack = currentTranslation();
    const ref = QuranReaderModel.reference(session.range.surahs, index);
    const row = ref && pack?.surahs[ref.surah - 1]?.[ref.ayah - 1];
    if (!row) return document.createDocumentFragment();
    const content = document.createElement('div');
    content.className = 'quran-translation-content';
    const paragraph = document.createElement('p');
    paragraph.lang = translationLanguage();
    paragraph.dir = translationLanguage() === 'ur' ? 'rtl' : 'ltr';
    paragraph.setAttribute('data-no-ui-translation', '');
    paragraph.textContent = row[0];
    content.append(paragraph);
    if (row[1]) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = ui('reader.translationNotes', 'الحواشي');
      const notes = document.createElement('p');
      notes.lang = translationLanguage();
      notes.dir = paragraph.dir;
      notes.setAttribute('data-no-ui-translation', '');
      notes.textContent = row[1];
      details.append(summary, notes);
      content.append(details);
    }
    return content;
  }

  function translationSource(pack) {
    const source = document.createElement('small');
    source.className = 'quran-translation-source';
    source.textContent = ui('reader.translationSourceLabel', 'المصدر') + ' · ';
    const link = document.createElement('a');
    link.href = pack.url;
    link.setAttribute('data-no-ui-translation', '');
    link.textContent = pack.credit + ' · QuranEnc · ' + pack.version;
    link.addEventListener('click', event => {
      event.preventDefault();
      window.mihrabApi.openExternalUrl(pack.url).catch(() => {});
    });
    source.append(link);
    return source;
  }

  function showTranslation(verse) {
    if (verticalReading() || !currentTranslation() || !verse.isConnected) return;
    clearTimeout(hideTimer);
    translationCard.replaceChildren(translationContent(Number(verse.dataset.verse)));
    translationCard.hidden = false;
    const rect = verse.getBoundingClientRect();
    const width = translationCard.offsetWidth;
    const height = translationCard.offsetHeight;
    translationCard.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left)) + 'px';
    translationCard.style.top = Math.max(8, Math.min(innerHeight - height - 8,
      rect.bottom + height + 8 <= innerHeight ? rect.bottom + 8 : rect.top - height - 8)) + 'px';
  }

  function verticalAnchor() {
    const rows = book.querySelectorAll('.quran-translation-row');
    if (!rows.length) return session?.viewStart;
    const top = viewport.getBoundingClientRect().top + 6;
    let low = 0, high = rows.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (rows[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
      else high = mid;
    }
    return Number(rows[low].dataset.index);
  }

  function renderVertical(anchor) {
    const { start, end, surahs } = session.range;
    const fragment = document.createDocumentFragment();
    fragment.append(translationSource(currentTranslation()));
    for (const surah of surahs) {
      for (let index = Math.max(start, surah.start); index <= Math.min(end, surah.end); index++) {
        const row = document.createElement('article');
        row.className = 'quran-translation-row';
        row.dataset.index = String(index);
        const verse = document.createElement('button');
        verse.type = 'button';
        verse.className = 'quran-reader-verse quran-translation-verse';
        verse.dataset.verse = String(index);
        verse.dataset.surah = String(surah.number);
        verse.dir = 'rtl';
        verse.lang = 'ar';
        verse.setAttribute('data-no-ui-translation', '');
        verse.textContent = session.corpus.verses[index];
        row.append(verse, translationContent(index));
        fragment.append(row);
      }
    }
    book.replaceChildren(fragment);
    session.viewStart = start;
    session.viewEnd = end;
    $('previous').hidden = $('next').hidden = true;
    $('page-number').textContent = '';
    refreshSelection();
    jumpVertical(anchor ?? start);
    applyHighlights();
  }

  function jumpVertical(index) {
    const row = book.querySelector('.quran-translation-row[data-index="' + index + '"]');
    const sourceHeight = book.firstElementChild?.offsetHeight || 0;
    if (row) viewport.scrollTop += row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - sourceHeight;
    const ref = QuranReaderModel.reference(session.range.surahs, index);
    if (ref) $('surah').value = ref.surah;
    customSelects.get($('surah'))?.sync();
  }

  async function changeTranslation(patch) {
    if (!session?.range || loading || updating) return;
    const active = session;
    const revision = ++viewChange;
    const anchor = verticalReading() ? verticalAnchor() : session.viewStart;
    closeTranslation();
    try {
      persist({ ...preferences, ...patch });
      await loadTranslation();
      if (active !== session || revision !== viewChange) return;
      session.viewStart = anchor ?? session.range.start;
      render(session.viewStart);
    } catch {
      notify(ui('reader.translationSaveFailed', 'تعذر حفظ إعدادات الترجمة.'));
      updateTranslationControls();
    }
  }

  $('translation-enabled').addEventListener('change', event => {
    changeTranslation({ translationEnabled: event.target.checked });
  });
  $('translation-language').addEventListener('change', event => {
    changeTranslation({ translationLanguage: event.target.value });
  });
  $('view-mode').addEventListener('click', () => {
    changeTranslation({ translationView: verticalReading() ? 'pages' : 'vertical' });
  });
  window.addEventListener('mihrab:interface-language-changed', () => {
    if (!reader.open) return;
    closeTranslation();
    updateTranslationControls();
  });
  viewport.addEventListener('scroll', () => {
    if (!verticalReading() || scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!verticalReading()) return;
      const ref = QuranReaderModel.reference(session.range.surahs, verticalAnchor());
      if (ref && $('surah').value !== String(ref.surah)) {
        $('surah').value = ref.surah;
        customSelects.get($('surah'))?.sync();
      }
    });
  }, { passive: true });

  function scheduleTranslationClose() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(closeTranslation, 180);
  }
  book.addEventListener('pointerover', event => {
    const verse = event.target.closest('[data-verse]');
    if (event.pointerType === 'mouse' && verse) showTranslation(verse);
  });
  book.addEventListener('pointerout', event => {
    if (event.pointerType === 'mouse' && event.target.closest('[data-verse]')) scheduleTranslationClose();
  });
  translationCard.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  translationCard.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse') scheduleTranslationClose();
  });
  function cancelHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }
  book.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || !event.isPrimary || verticalReading() || !currentTranslation()) return;
    const verse = event.target.closest('[data-verse]');
    if (!verse) return;
    cancelHold();
    suppressClick = null;
    hold = { id: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      if (!verse.isConnected) return;
      suppressClick = { verse, until: performance.now() + 1200 };
      showTranslation(verse);
    }, 520) };
  });
  reader.addEventListener('pointermove', event => {
    if (hold?.id === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10)
      cancelHold();
  });
  for (const type of ['pointerup', 'pointercancel']) reader.addEventListener(type, cancelHold);
  book.addEventListener('contextmenu', event => {
    if (hold || suppressClick?.until > performance.now()) event.preventDefault();
  });
  reader.addEventListener('pointerdown', event => {
    if (!translationCard.contains(event.target)) closeTranslation();
  }, true);

  document.querySelectorAll('[data-open-quran-reader]').forEach(button => {
    button.addEventListener('click', () => start(button.dataset.openQuranReader, button));
  });
  book.addEventListener('click', event => {
    const verse = event.target.closest('[data-verse]');
    if (!verse || loading || updating) return;
    if (suppressClick?.verse === verse && performance.now() < suppressClick.until) {
      suppressClick = null;
      return;
    }
    session.selected = Number(verse.dataset.verse);
    if (session.selected === session.saved) session.drafts.delete(session.riwaya);
    else session.drafts.set(session.riwaya, currentMark(session.selected));
    $('surah').value = verse.dataset.surah;
    refreshSelection();
    showAnnotation(verse, event);
  });
  annotation.addEventListener('click', async () => {
    if (updating || !session?.riwaya || session.selected == null) return;
    updating = true;
    try {
      await saveMark(session.riwaya, currentMark(session.selected));
      session.saved = session.selected;
      session.drafts.delete(session.riwaya);
      closeAnnotation();
      refreshSelection();
      book.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    } catch {
      notify('تعذر حفظ الموضع على هذا الجهاز.');
    } finally {
      updating = false;
    }
  });
  reader.addEventListener('pointerdown', event => {
    if (!event.target.closest('[data-verse], #quran-reader-annotation')) closeAnnotation();
    const settings = $('settings');
    if (!settings.contains(event.target)) settings.open = false;
  });
  book.addEventListener('keydown', event => {
    if (event.repeat || ![' ', 'Enter'].includes(event.key) || !event.target.matches('[data-verse]')) return;
    event.preventDefault();
    event.target.click();
  });
  if (typeof bindReadingSwipe === 'function') bindReadingSwipe(book, turn);
  $('previous').addEventListener('click', () => turn(-1));
  $('next').addEventListener('click', () => turn(1));
  $('surah').addEventListener('change', event => {
    const surah = session.range.surahs.find(row => row.number === Number(event.target.value));
    if (surah) goToVerse(Math.max(surah.start, session.range.start));
  });
  $('riwaya').addEventListener('change', async event => {
    if (!session?.assignment) return;
    const edition = event.target.value;
    try { await setEdition(edition); }
    catch (error) {
      if (!session) return;
      $('riwaya').value = session.riwaya;
      notify(error.message);
    }
  });
  $('theme').addEventListener('change', event => {
    const theme = event.target.value;
    reader.dataset.paper = theme;
    updateTajweedPalette();
    if (session?.range) { syncLegend(); applyHighlights(); }
    try { persist({ ...preferences, theme }); } catch { notify('تعذر حفظ مظهر المصحف.'); }
  });
  $('tajweed').addEventListener('change', async event => {
    const active = session;
    const tajweed = event.target.checked;
    try {
      if (tajweed) await load('tajweed');
      if (active !== session || active.riwaya !== 'hafs' || event.target.checked !== tajweed) return;
      persist({ ...preferences, tajweed });
      if (session.viewStart != null) render();
      notify();
    } catch {
      if (active !== session) return;
      event.target.checked = Boolean(preferences.tajweed);
      notify('تعذر تغيير إعداد التلوين.');
    }
  });
  let resizeTimer, resizeIdle, resizePending = false;
  let resizeFit;
  const reflow = async () => {
    if (!reader.open || !session?.range || loading || session.viewStart == null || verticalReading()) {
      resizePending = false;
      return;
    }
    const size = [book.clientWidth, book.clientHeight, pageCount()].join(':');
    if (size === measuredSize) { resizePending = false; return; }
    session.pageSizes.clear();
    session.meanTypeSize = null;
    const anchor = session.selected != null && session.selected >= session.viewStart && session.selected <= session.viewEnd
      ? session.selected : session.viewStart;
    const active = session;
    const generation = windowGeneration;
    const current = pageAt(active.viewStart);
    const first = anchor > visiblePages(current).at(-1).end ? pageAt(anchor) : current;
    for (const page of visiblePages(first)) {
      const steps = resizeFit = fitPageSteps(page);
      let step;
      do {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (generation !== windowGeneration || active !== session || !reader.open) {
          steps.return();
          return;
        }
        step = steps.next();
      } while (!step.done);
      active.pageSizes.set(page, step.value);
    }
    resizeFit = null;
    resizePending = false;
    measuredSize = size;
    active.viewStart = first.start;
    render(anchor);
    warmWindow(first);
  };
  function debounceReflow() {
    if (!reader.open || !session?.range || verticalReading()) return;
    if (!resizePending && [book.clientWidth, book.clientHeight, pageCount()].join(':') === measuredSize) return;
    resizePending = true;
    useWordEstimate = true;
    ++windowGeneration;
    resizeFit?.return();
    resizeFit = null;
    clearTimeout(windowTimer);
    if (windowIdle !== undefined) window.cancelIdleCallback?.(windowIdle);
    clearTimeout(resizeTimer);
    if (resizeIdle !== undefined) window.cancelIdleCallback?.(resizeIdle);
    resizeTimer = setTimeout(() => {
      if (window.requestIdleCallback) resizeIdle = requestIdleCallback(reflow);
      else reflow();
    }, 400);
  }
  const observer = new ResizeObserver(debounceReflow);
  observer.observe(book);
  layout.addEventListener('change', debounceReflow);
  window.addEventListener('resize', debounceReflow);
  reader.addEventListener('keydown', event => {
    if (confirmation.open || event.ctrlKey || event.metaKey ||
        event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
    if (verticalReading() && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.code)) return;
    if (event.altKey && (event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.code))) return;
    const actions = {
      ArrowLeft: () => turn(1), PageDown: () => turn(1),
      ArrowRight: () => turn(-1), PageUp: () => turn(-1),
      KeyS: () => { $('settings').open = !$('settings').open; },
      KeyT: () => { if (!$('tajweed').disabled) $('tajweed').click(); },
    };
    const action = actions[event.code];
    if (!action) return;
    event.preventDefault();
    if (!event.repeat) action();
  });
  $('exit').addEventListener('click', leave);
  reader.addEventListener('cancel', event => { event.preventDefault(); leave(); });
  $('stay').addEventListener('click', () => confirmation.close());
  $('discard').addEventListener('click', () => {
    if (!updating) { confirmation.close(); reader.close(); }
  });
  $('save').addEventListener('click', saveAndLeave);
  confirmation.addEventListener('close', () => { $('exit-error').textContent = ''; });
  reader.addEventListener('close', () => {
    clearHighlights();
    closeTranslation();
    cancelHold();
    suppressClick = null;
    const opener = session?.opener;
    resizeFit?.return();
    resizeFit = null;
    clearTimeout(windowTimer);
    if (windowIdle !== undefined) window.cancelIdleCallback?.(windowIdle);
    clearTimeout(resizeTimer);
    if (resizeIdle !== undefined) window.cancelIdleCallback?.(resizeIdle);
    resizePending = false;
    clearTimeout(expiryTimer);
    session = null;
    useWordEstimate = false;
    measuredSize = '';
    $('legend').hidden = true;
    closeAnnotation();
    book.replaceChildren();
    opener?.focus();
  });
  for (const link of document.querySelectorAll('[data-quran-translation-source]')) {
    link.addEventListener('click', event => {
      event.preventDefault();
      window.mihrabApi.openExternalUrl(link.href).catch(() => {});
    });
  }
})();

