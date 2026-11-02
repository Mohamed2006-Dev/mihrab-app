const PAGES = ['tab-prayers', 'tab-hadith', 'tab-youtube', 'tab-quran', 'tab-settings'];
const DEFAULTS = {
  zoom: 100,
  readingSize: 100,
  contrast: 'theme',
  clearFont: false,
  reduceMotion: false,
  buttonVisible: true,
  buttonPosition: 'bottom-left',
  pages: PAGES,
};
function normalize(value = {}) {
  const clamp = (n, min, max, fallback) =>
    Number.isFinite(Number(n))
      ? Math.max(min, Math.min(max, Math.round(Number(n) / 10) * 10))
      : fallback;
  return {
    zoom: clamp(value.zoom, 80, 150, 100),
    readingSize: clamp(value.readingSize, 100, 180, 100),
    contrast: ['theme', 'light', 'dark'].includes(value.contrast) ? value.contrast : 'theme',
    clearFont: value.clearFont === true,
    reduceMotion: value.reduceMotion === true,
    buttonVisible: value.buttonVisible !== false,
    buttonPosition: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(
      value.buttonPosition,
    )
      ? value.buttonPosition
      : 'bottom-left',
    pages: Array.isArray(value.pages)
      ? [...new Set(value.pages.filter((p) => PAGES.includes(p)))]
      : [...PAGES],
  };
}
module.exports = { DEFAULTS, PAGES, normalize };
