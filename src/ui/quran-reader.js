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

  function refText(index) {
    const surah = session.range.surahs.find(row => row.start <= index && index <= row.end);
    return surah.name + '، الآية ' + n(index - surah.start + 1);
  }

  function refreshSelection() {
    const selected = session.selected;
    for (const verse of book.querySelectorAll('[data-verse]')) {
      verse.setAttribute('aria-pressed', String(Number(verse.dataset.verse) === selected));
    }
    $('bookmark').textContent = selected === null ? 'اختر آية لتحديد موضع المتابعة'
      : (session.drafts.has(session.riwaya) ? 'موضع غير محفوظ · ' : 'موضع المتابعة المحفوظ · ') + refText(selected);
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
        const [topic, name] = tajweed.rules[id];
        if (daylight && !daylightRule(topic, name)) continue;
        const span = new Range();
        span.setStart(text, start);
        span.setEnd(text, end);
        highlights[topic].add(span);
      }
    }
    const priority = [0, 1, 4, 3, 5, 2, 6];
    for (const [topic, highlight] of highlights.entries()) {
      highlight.priority = priority[topic];
      CSS.highlights.set(highlightPrefix + topic, highlight);
    }
  }

  function syncLegend() {
    const visible = canHighlight && $('tajweed').checked && session.riwaya === 'hafs' && data.tajweed;
    const legend = $('legend');
    const rules = $('legend-rules');
    legend.hidden = !visible;
    const tone = reader.dataset.tajweedTone;
    if (!visible || rules.dataset.tone === tone) return;
    rules.replaceChildren();
    rules.dataset.tone = tone;
    const labels = tone === 'bright' ? data.tajweed.topics : daylightLabels;
    for (const [topic, label] of labels.entries()) {
      if (!label) continue;
      const item = document.createElement('span');
      item.className = 'quran-reader-rule quran-reader-rule-color-' + topic;
      item.textContent = label;
      rules.append(item);
    }
  }

  function renderPage(page) {
    const paper = document.createElement('section');
    paper.className = 'quran-reader-page';
    const original = session.corpus.units.page[page.number - 1];
    const opening = page.number <= 2 && page.start === original[0] && page.end === original[1];
    if (opening) paper.classList.add('quran-reader-opening');
    paper.setAttribute('aria-label', 'صفحة المصحف ' + n(page.number));
    const body = document.createElement('div');
    body.className = 'quran-reader-page-body';
    paper.append(body);
    const flow = document.createElement('div');
    flow.className = 'quran-reader-page-flow';
    body.append(flow);
    const surahs = session.range.surahs.filter(surah => surah.start <= page.end && surah.end >= page.start);
    const corner = document.createElement('div');
    corner.className = 'quran-reader-running-title';
    corner.textContent = surahs[0].name;
    const content = opening ? document.createElement('div') : flow;
    if (opening) {
      body.append(corner);
      content.className = 'quran-reader-opening-content';
      flow.append(content);
    } else {
      flow.append(corner);
    }
    for (const surah of surahs) {
      const first = Math.max(surah.start, page.start);
      const last = Math.min(surah.end, page.end);
      if (first === surah.start) {
        const title = document.createElement('h3');
        title.textContent = 'سورة ' + surah.name;
        content.append(title);
        if (surah.basmala) {
          const basmala = document.createElement('p');
          basmala.className = 'quran-reader-basmala';
          basmala.textContent = surah.basmala;
          content.append(basmala);
        }
      }
      const text = document.createElement('div');
      text.className = 'quran-reader-verses';
      for (let i = first; i <= last; i++) {
        const verse = document.createElement('span');
        verse.setAttribute('role', 'button');
        verse.tabIndex = 0;
        verse.className = 'quran-reader-verse';
        verse.dataset.verse = String(i);
        verse.dataset.surah = String(surah.number);
        verse.textContent = session.corpus.verses[i];
        verse.setAttribute('aria-label', 'تحديد سورة ' + surah.name + '، الآية ' + n(i - surah.start + 1) + ' · ' + verse.textContent);
        if (i !== first) text.append(' ');
        text.append(verse);
      }
      if (last === page.end) {
        const baseline = document.createElement('span');
        baseline.className = 'quran-reader-baseline';
        baseline.setAttribute('aria-hidden', 'true');
        text.append(baseline);
      }
      content.append(text);
    }
    const number = document.createElement('footer');
    const clippedAtStart = page.start === session.range.start && page.start > original[0];
    const clippedAtEnd = page.end === session.range.end && page.end < original[1];
    const boundary = [
      clippedAtStart && 'بداية الورد من هذه الصفحة',
      clippedAtEnd && 'بقية الصفحة خارج الورد',
    ].filter(Boolean).join(' · ');
    number.textContent = boundary ? n(page.number) + ' · ' + boundary : n(page.number);
    if (boundary) {
      number.className = 'quran-reader-range-cut';
      paper.classList.add('quran-reader-clipped');
    }
    if (clippedAtEnd) {
      const divider = document.createElement('div');
      divider.className = 'quran-reader-end-divider';
      divider.setAttribute('aria-hidden', 'true');
      divider.textContent = '۞ ۞ ۞ ۞';
      flow.append(divider);
    }
    paper.append(number);
    return paper;
  }

  function pageCount() { return layout.matches ? 2 : 1; }

  const baselineClearance = 26;

  function baselineRoom(body) {
    const marker = body.querySelector('.quran-reader-baseline');
    return body.getBoundingClientRect().bottom - baselineClearance - marker.getBoundingClientRect().top;
  }

  function lastLineFullness(body) {
    const marker = body.querySelector('.quran-reader-baseline');
    const box = marker.parentElement.getBoundingClientRect();
    return (box.right - marker.getBoundingClientRect().left) / box.width;
  }

  function isDensePage(body) {
    return body.firstElementChild.offsetHeight >= body.clientHeight * .70;
  }

  function alignLastLine(paper) {
    if (paper.matches('.quran-reader-opening, .quran-reader-clipped')) return;
    const body = paper.firstElementChild;
    if (!isDensePage(body)) {
      paper.classList.add('quran-reader-sparse');
      return;
    }
    const blocks = [...body.querySelectorAll('.quran-reader-verses')];
    if (lastLineFullness(body) >= .72) blocks.at(-1).classList.add('quran-reader-justify-last');
    if (!blocks.length) return;
    const style = getComputedStyle(blocks[0]);
    const lineHeight = parseFloat(style.lineHeight);
    const size = parseFloat(style.fontSize);
    const lines = blocks.reduce((count, block) => count + Math.max(1, Math.round(block.offsetHeight / lineHeight)), 0);
    const room = baselineRoom(body);
    if (room <= 0) return;
    const setLeading = extra => paper.style.setProperty('--reader-leading', lineHeight + extra + 'px');
    const fitsLeading = () => {
      const remaining = baselineRoom(body);
      const contentHeight = body.firstElementChild.getBoundingClientRect().height;
      return remaining >= 0 && contentHeight + remaining <= body.clientHeight;
    };
    const limit = Math.min(size * .48, room / (lines - .5));
    setLeading(limit);
    if (!fitsLeading()) {
      let low = 0;
      let high = limit;
      while (high - low > .1) {
        const mid = (low + high) / 2;
        setLeading(mid);
        if (fitsLeading()) low = mid;
        else high = mid;
      }
      setLeading(low);
    }
    const freeHeight = body.clientHeight - body.firstElementChild.getBoundingClientRect().height;
    const topInset = Math.min(freeHeight, baselineRoom(body));
    if (topInset >= 0 && topInset <= size * .65) {
      blocks[0].style.paddingBlockStart = topInset + 'px';
    } else {
      paper.style.removeProperty('--reader-leading');
    }
  }

  function getPages(source) {
    if (session.pagination.has(source.number)) return session.pagination.get(source.number);
    // Leave room for the spine border and subpixel text metrics.
    const width = Math.floor(book.clientWidth / pageCount()) - 2;
    const height = book.clientHeight - 6;
    if (width <= 0 || height <= 0) return [{ ...source }];
    const result = [];
    const minimum = source.number <= 2 ? 13 : 16;
    const maximum = layout.matches ? 35 : Math.min(30, Math.max(22, width / 14));
    const setSize = (node, size) => node.style.setProperty('--reader-type-size', size + 'px');

    function measure(start, end, size, inspectLastLine = false) {
      const node = renderPage({ ...source, start, end });
      node.classList.add('quran-reader-probe');
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
      node.style.width = width + 'px';
      node.style.height = height + 'px';
      setSize(node, size);
      book.append(node);
      const body = node.firstElementChild;
      const openingContent = node.querySelector('.quran-reader-opening-content');
      // Keep the rectangular text block inside the circular frame.
      const fitsFrame = !openingContent ||
        openingContent.offsetHeight <= openingContent.parentElement.clientHeight * .64;
      const fits = fitsFrame && body.scrollHeight <= body.clientHeight + 1 &&
        body.scrollWidth <= body.clientWidth + 1 &&
        (openingContent || node.matches('.quran-reader-clipped') || baselineRoom(body) >= 0);
      const fullness = fits && inspectLastLine &&
        !node.matches('.quran-reader-opening, .quran-reader-clipped') && isDensePage(body)
        ? lastLineFullness(body) : -1;
      node.remove();
      return inspectLastLine ? fullness : fits;
    }

    for (let start = source.start; start <= source.end;) {
      let end = source.end;
      let low = minimum;
      if (source.number <= 2 && !measure(start, end, low)) low = 11;
      if (!measure(start, end, low)) {
        low = minimum;
        if (measure(start, start, minimum)) {
          let left = start;
          let right = end - 1;
          while (left < right) {
            const mid = Math.ceil((left + right) / 2);
            if (measure(start, mid, minimum)) left = mid;
            else right = mid - 1;
          }
          end = left;
          // Prefer two balanced leaves over an almost empty continuation.
          const verses = session.corpus.verses.slice(start, source.end + 1);
          const half = verses.reduce((sum, verse) => sum + verse.length, 0) / 2;
          let balancedEnd = start;
          let length = verses[0].length;
          while (balancedEnd < end && length < half) {
            balancedEnd++;
            length += session.corpus.verses[balancedEnd].length;
          }
          if (balancedEnd < end && measure(balancedEnd + 1, source.end, minimum)) end = balancedEnd;
        } else {
          end = start;
          low = 12;
        }
      }
      let high = maximum;
      while (high - low > .25) {
        const mid = (low + high) / 2;
        if (measure(start, end, mid)) low = mid;
        else high = mid;
      }
      // A smaller font can pull a short final line back onto the preceding line.
      // Prefer that over forcing a handful of words across the full width.
      let chosen = low;
      let fullness = measure(start, end, low, true);
      if (fullness >= 0 && fullness < .62) {
        const floor = Math.max(Math.min(low, 16), low * .87);
        for (let size = low - .5; size >= floor && fullness < .70; size -= .5) {
          const candidate = measure(start, end, size, true);
          if (candidate > fullness + .05) {
            chosen = size;
            fullness = candidate;
          }
        }
      }
      result.push({ ...source, start, end, fontSize: chosen });
      start = end + 1;
    }
    session.pagination.set(source.number, result);
    return result;
  }

  function pageAt(index) {
    const source = session.range.pages.find(page => page.start <= index && index <= page.end);
    return source && getPages(source).find(page => page.start <= index && index <= page.end);
  }

  function syncPagination() {
    syncLegend();
    const size = [book.clientWidth, book.clientHeight, pageCount()].join(':');
    if (measuredSize !== size) session.pagination.clear();
    measuredSize = size;
  }

  function render(anchor = null) {
    closeAnnotation();
    syncPagination();
    const first = pageAt(session.viewStart);
    if (!first) return;
    session.viewStart = first.start;
    const visible = [first];
    if (pageCount() === 2 && first.end < session.range.end) visible.push(pageAt(first.end + 1));
    session.viewEnd = visible.at(-1).end;
    const pages = visible.map(page => {
      const paper = renderPage(page);
      paper.style.setProperty('--reader-type-size', (page.fontSize ?? 18) + 'px');
      return paper;
    });
    if (pageCount() === 2 && visible.length === 1) {
      const blank = document.createElement('div');
      blank.className = 'quran-reader-page quran-reader-empty-leaf';
      blank.textContent = 'نهاية الورد';
      pages.push(blank);
    }
    book.replaceChildren(...pages);
    for (const paper of pages) {
      if (!paper.classList.contains('quran-reader-empty-leaf')) alignLastLine(paper);
    }
    $('previous').disabled = first.start === session.range.start;
    $('next').disabled = session.viewEnd === session.range.end;
    $('page-number').textContent = 'صفحة المصحف ' + [...new Set(visible.map(page => n(page.number)))].join(' – ');
    $('surah').value = QuranReaderModel.reference(session.range.surahs, anchor ?? first.start)?.surah || '';
    refreshSelection();
    applyHighlights();
  }

  function goToVerse(index) {
    session.viewStart = index;
    render(index);
  }

  function resumeSpread(index, mark) {
    syncPagination();
    if (pageCount() === 2) {
      const { start, end } = session.range;
      const sameRange = mark?.rangeStart === start && mark?.rangeEnd === end;
      if (sameRange && Number.isInteger(mark.spreadStart) && mark.spreadStart >= start && mark.spreadStart <= index) {
        const first = pageAt(mark.spreadStart);
        const last = first.end < end ? pageAt(first.end + 1) : first;
        if (index <= last.end) {
          session.viewStart = first.start;
          render(index);
          return;
        }
      }
      // Older bookmarks record only an ayah. Use the parity of the source pages.
      const page = pageAt(index);
      if (page.start > start && (page.number - session.range.pages[0].number) % 2 === 1) {
        session.viewStart = pageAt(page.start - 1).start;
        render(index);
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
      ...(pageCount() === 2 && { spreadStart: session.viewStart }),
    };
  }

  function turn(direction) {
    if (!session?.range || loading || confirmation.open) return;
    let target = session.viewEnd + 1;
    if (direction < 0) {
      if ($('previous').disabled) return;
      const prior = pageAt(session.viewStart - 1);
      const paired = pageCount() === 2 && prior.start > session.range.start ? pageAt(prior.start - 1) : null;
      target = (paired ?? prior).start;
    } else if ($('next').disabled) return;

    const leaves = book.querySelectorAll('.quran-reader-page:not(.quran-reader-turning, .quran-reader-empty-leaf)');
    const leaf = direction > 0 ? leaves[leaves.length - 1] : leaves[0];
    const snapshot = !reduceMotion.matches && pageCount() === 2 ? leaf.cloneNode(true) : null;
    const position = snapshot && { left: leaf.offsetLeft, width: leaf.offsetWidth, height: leaf.offsetHeight };
    goToVerse(target);
    $('page-number').focus({ preventScroll: true });
    if (reduceMotion.matches) return;
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
      Object.assign(session, { corpus, riwaya, range, selected, saved, pagination: new Map() });
      reader.dataset.riwaya = riwaya;
      const font = riwaya === 'hafs' ? 'MihrabReaderHafs' : 'MihrabReaderWarsh';
      await document.fonts.load('20px ' + font);
      if (active !== session) return;
      $('riwaya').value = riwaya;
      $('range').textContent = refText(range.start) + ' — ' + refText(range.end);
      $('surah').replaceChildren(...range.surahs.map(surah => new Option(surah.name, surah.number)));
      await refreshTajweed();
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

  document.querySelectorAll('[data-open-quran-reader]').forEach(button => {
    button.addEventListener('click', () => start(button.dataset.openQuranReader, button));
  });
  book.addEventListener('click', event => {
    const verse = event.target.closest('[data-verse]');
    if (!verse || loading || updating) return;
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
  const reflow = () => {
    if (!reader.open || !session?.range || loading || session.viewStart == null) return;
    const size = [book.clientWidth, book.clientHeight, pageCount()].join(':');
    if (size === measuredSize) return;
    measuredSize = size;
    session.pagination.clear();
    const anchor = session.selected != null && session.selected >= session.viewStart && session.selected <= session.viewEnd
      ? session.selected : session.viewStart;
    resumeSpread(anchor, currentMark(anchor));
  };
  const observer = new ResizeObserver(reflow);
  observer.observe(book);
  layout.addEventListener('change', reflow);
  window.addEventListener('resize', reflow);
  reader.addEventListener('keydown', event => {
    if (confirmation.open || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
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
    const opener = session?.opener;
    session = null;
    measuredSize = '';
    $('legend').hidden = true;
    closeAnnotation();
    book.replaceChildren();
    opener?.focus();
  });
})();

