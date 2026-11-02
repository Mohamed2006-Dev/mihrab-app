const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const root = __dirname,
  Hadith = require('./src/engines/hadith-engine'),
  Storage = require('./src/engines/storage-engine');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadeethenc-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Hadith(new Storage(root, dir), root);
}
test('offline catalog, explanations, metadata and exports use one source', (t) => {
  const e = setup(t),
    state = e.getHadithForPrayer('test');
  assert.equal(state.totalStored, 384);
  assert.equal(state.hadith.sharh.source, 'HadeethEnc');
  assert(state.hadith.grade);
  assert(state.hadith.sourceUrl.startsWith('https://hadeethenc.com/'));
  assert(e.formatHadithMarkdown().includes('HadeethEnc'));
  assert(e.getHadithLibrary({ limit: 8 }).items.every((r) => r.hasSharh));
});
test('online search fetches only official HadeethEnc endpoints and commits complete details', async (t) => {
  const e = setup(t),
    calls = [];
  e.setFetchFn(async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () =>
        url.includes('/search/')
          ? [{ id: '999999' }]
          : [
              {
                id: '999999',
                hadeeth: 'نص حديث للاختبار لا ينشر ضمن المكتبة الأصلية',
                grade: 'درجة تجريبية',
                attribution: 'مصدر الاختبار',
                explanation: 'شرح اختبار',
              },
            ],
    };
  });
  const r = await e.syncFromHadeethEncApi('الصلاة');
  assert(r.success);
  assert.equal(r.addedCount, 1);
  assert(calls.every((url) => new URL(url).hostname === 'hadeethenc.com'));
  assert.equal(e.getExportHadith('hadeethenc_999999').sharh.source, 'HadeethEnc');
});
test('network and incomplete responses remain visible errors and do not change stock', async (t) => {
  const e = setup(t),
    before = e.getDatabase().hadiths.length;
  e.setFetchFn(async () => {
    throw Error('offline');
  });
  await assert.rejects(e.syncFromHadeethEncApi('الصلاة'), /offline/);
  e.setFetchFn(async (url) => ({
    ok: true,
    json: async () => (url.includes('/search/') ? [{ id: '1' }] : []),
  }));
  await assert.rejects(e.syncFromHadeethEncApi('الصلاة'), /ناقصة/);
  assert.equal(e.getDatabase().hadiths.length, before);
});
test('forced refresh preserves stored identity and source attribution', async (t) => {
  const e = setup(t),
    h = e.getDatabase().hadiths[0];
  e.setFetchFn(async () => ({
    ok: true,
    json: async () => [
      {
        id: h.id.replace('hadeethenc_', ''),
        hadeeth: h.text,
        grade: h.grade,
        attribution: h.book,
        explanation: 'شرح مجدد للاختبار',
      },
    ],
  }));
  await e.enrichStoredHadith(h.id, { force: true });
  assert.equal(e.getExportHadith(h.id).fingerprint, h.fingerprint);
  assert.equal(e.getExportHadith(h.id).sharh.explanation, 'شرح مجدد للاختبار');
});

test('source links derive from stored provider identity and copied text retains attribution', (t) => {
  const e = setup(t),
    h = e.getDatabase().hadiths[0];
  assert.equal(
    e.getHadithSourceUrl(h.id),
    'https://hadeethenc.com/ar/browse/hadith/' + h.id.replace('hadeethenc_', ''),
  );
  const text = e.formatHadithMarkdown(h.id, false);
  assert(text.includes('HadeethEnc.com'));
  assert(text.includes(e.getHadithSourceUrl(h.id)));
  assert(text.includes(h.text));
  assert.throws(() => e.getHadithSourceUrl('https://example.com'), /غير موجود/);
});

test('export image credits the publisher once at the bottom and retains separate attribution', (t) => {
  const e = setup(t),
    h = e.getDatabase().hadiths[0];
  const { buildHadithImageHtml } = require('./src/engines/hadith-image');
  const html = buildHadithImageHtml(
    { ...h, gradeSource: 'HadeethEnc.com', metadataSource: 'HadeethEnc.com' },
    root,
  );
  assert.equal((html.match(/HadeethEnc\.com/g) || []).length, 1);
  assert(!html.includes('مصدر الدرجة'));
  assert(!html.includes('توثيق البيانات'));
  assert(!html.includes('/browse/hadith/'));
  assert(html.includes('التخريج'));
  assert(html.includes(h.book));
});
