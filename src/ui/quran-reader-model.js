'use strict';

const QuranReaderModel = (() => {
  const bookmarkLimit = 32;

  function open(corpus, assignment) {
    const ranges = corpus.units[assignment.unit];
    const first = ranges?.[assignment.startNumber - 1];
    const last = ranges?.[assignment.endNumber - 1];
    if (!first || !last || first[0] > last[1]) throw new Error('حدود الورد غير متاحة لهذه الرواية.');
    const start = first[0];
    const end = last[1];
    const pages = corpus.units.page.flatMap(([a, b], index) =>
      a <= end && b >= start ? [{ number: index + 1, start: Math.max(a, start), end: Math.min(b, end) }] : [],
    );
    const surahs = corpus.surahs.filter(surah => surah.start <= end && surah.end >= start);
    if (!pages.length || pages[0].start !== start || pages.at(-1).end !== end)
      throw new Error('تعذر مطابقة صفحات المصحف مع حدود الورد.');
    return { start, end, pages, surahs };
  }

  function reference(surahs, index) {
    const surah = surahs.find(row => row.start <= index && index <= row.end);
    return surah && { surah: surah.number, ayah: index - surah.start + 1 };
  }

  function resume(range, bookmarks = []) {
    if (!Array.isArray(bookmarks)) return null;
    for (const mark of bookmarks) {
      const surah = range.surahs.find(row => row.number === mark?.surah);
      if (!surah || !Number.isInteger(mark.ayah) || mark.ayah < 1) continue;
      const index = surah.start + mark.ayah - 1;
      if (index <= surah.end && index >= range.start && index <= range.end) return index;
    }
    return null;
  }

  function save(bookmarks, mark) {
    const list = Array.isArray(bookmarks) ? bookmarks : [];
    return [mark, ...list.filter(row => row?.surah !== mark.surah || row?.ayah !== mark.ayah)].slice(0, bookmarkLimit);
  }

  return { open, reference, resume, save };
})();

if (typeof module !== 'undefined') module.exports = QuranReaderModel;

