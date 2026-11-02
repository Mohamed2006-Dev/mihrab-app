const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { normalize, PAGES } = require('./src/engines/accessibility-engine');
test('accessibility magnification has bounded validated defaults', () => {
  assert.equal(normalize().zoom, 100);
  assert.equal(normalize().readingSize, 100);
  assert.equal(normalize({ zoom: 999, readingSize: 999 }).zoom, 150);
  assert.equal(normalize({ zoom: -1, readingSize: -1 }).zoom, 80);
  assert.equal(normalize({ readingSize: 999 }).readingSize, 180);
  assert.equal(normalize({ readingSize: -1 }).readingSize, 100);
  assert.equal(normalize({ zoom: 'bad' }).zoom, 100);
});
test('accessibility permits hiding the control everywhere and restricting it to reading pages', () => {
  const prefs = normalize({
    buttonVisible: false,
    pages: ['tab-hadith', 'tab-quran', 'bad', 'tab-quran'],
    buttonPosition: 'top-right',
    contrast: 'light',
  });
  assert.equal(prefs.buttonVisible, false);
  assert.deepEqual(prefs.pages, ['tab-hadith', 'tab-quran']);
  assert.equal(prefs.buttonPosition, 'top-right');
  assert.deepEqual(normalize({ pages: [] }).pages, []);
  assert.deepEqual(normalize().pages, PAGES);
  assert.equal(normalize({ contrast: 'invalid', buttonPosition: 'invalid' }).contrast, 'theme');
  assert.equal(normalize({ buttonPosition: 'invalid' }).buttonPosition, 'bottom-left');
});
