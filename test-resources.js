const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const Storage = require('./src/engines/storage-engine'),
  CityCache = require('./src/engines/city-prayer-cache'),
  { ResourceEngine, allowed, categoryFor } = require('./src/engines/resource-engine');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-resources-'));
  const storage = new Storage(__dirname, dir);
  storage.saveConfig({
    network: {
      enabled: true,
      categories: { youtube: true, hadith: true, prayer: true, location: true, other: true },
    },
  });
  const resource = new ResourceEngine(storage);
  t.after(async () => {
    if (resource.timer) clearTimeout(resource.timer);
    await resource.pending;
    assert.equal(path.dirname(dir), os.tmpdir());
    assert(path.basename(dir).startsWith('mihrab-resources-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, storage, resource };
}
test('network categories are independent and global blocking overrides every category', (t) => {
  const { storage } = fixture(t);
  storage.saveConfig({ network: { categories: { youtube: false } } });
  assert(!allowed(storage.getConfig(), 'youtube'));
  assert(allowed(storage.getConfig(), 'prayer'));
  storage.saveConfig({ network: { enabled: false } });
  for (const category of ['youtube', 'hadith', 'prayer', 'location', 'other'])
    assert(!allowed(storage.getConfig(), category));
  assert.equal(categoryFor('https://i.ytimg.com/vi/x/default.jpg'), 'youtube');
  assert.equal(categoryFor('https://rr1.googlevideo.com/videoplayback'), 'youtube');
  assert.equal(categoryFor('https://hadeethenc.com/api/v1/test'), 'hadith');
  assert.equal(categoryFor('https://api.aladhan.com/v1/test'), 'prayer');
  assert.equal(categoryFor('https://ipwho.is/'), 'location');
});
test('blocked engine fetches never start and downloaded bytes are recorded persistently', async (t) => {
  const { storage, resource } = fixture(t);
  let calls = 0;
  const get = async () => {
    calls++;
    return new Response('{"ok":true}', { status: 200 });
  };
  storage.saveConfig({ network: { categories: { hadith: false } } });
  await assert.rejects(resource.fetch(get, 'https://hadeethenc.com/api/test'), {
    code: 'NETWORK_DISABLED',
  });
  assert.equal(calls, 0);
  storage.saveConfig({ network: { categories: { hadith: true } } });
  assert.deepEqual(await (await resource.fetch(get, 'https://hadeethenc.com/api/test')).json(), {
    ok: true,
  });
  await resource.flush();
  const usage = JSON.parse(fs.readFileSync(resource.file, 'utf8'));
  assert.equal(usage.days[new Date().toISOString().slice(0, 10)].hadith, 11);
});
test('Chromium requests obey the same policy including thumbnails and unknown hosts', (t) => {
  const { storage, resource } = fixture(t);
  const handlers = {},
    session = {
      webRequest: {
        onBeforeRequest: (f) => (handlers.before = f),
        onCompleted: (f) => (handlers.done = f),
        onErrorOccurred: (f) => (handlers.error = f),
      },
      closeAllConnections: async () => {},
      clearCache: async () => {},
    };
  resource.attachSession(session);
  storage.saveConfig({ network: { categories: { youtube: false } } });
  let result;
  handlers.before({ url: 'https://i.ytimg.com/vi/test/a.jpg', id: 1 }, (r) => (result = r));
  assert.equal(result.cancel, true);
  handlers.before({ url: 'file:///test/index.html', id: 2 }, (r) => (result = r));
  assert(!result.cancel);
  storage.saveConfig({ network: { enabled: false } });
  handlers.before({ url: 'https://unknown.example/test', id: 3 }, (r) => (result = r));
  assert.equal(result.cancel, true);
});
test('turning off a category aborts an already active request', async (t) => {
  const { storage, resource } = fixture(t);
  let started;
  const ready = new Promise((r) => (started = r));
  const work = resource.fetch(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(Error('aborted')));
      }),
    'https://www.youtube.com/feeds/test',
  );
  await ready;
  storage.saveConfig({ network: { categories: { youtube: false } } });
  await resource.applyPolicy();
  await assert.rejects(work, /aborted/);
});
test('city cache preserves each city and calculation method separately for the current date', (t) => {
  const { storage } = fixture(t),
    cache = new CityCache(storage),
    date = new Date('2026-11-02T12:00:00Z'),
    a = {
      countryCode: 'MA',
      city: 'طنجة',
      lat: 35.76,
      lng: -5.83,
      timeZone: 'Africa/Casablanca',
      calculationMethod: 'Habous',
    },
    b = { ...a, city: 'الرباط', lat: 34.02, lng: -6.84 };
  cache.remember({ location: a, prayerAdjustments: { fajr: 7 }, officialSync: {} }, date);
  cache.remember({ location: b, prayerAdjustments: { fajr: 2 }, officialSync: {} }, date);
  assert.equal(cache.restore(a, date).prayerAdjustments.fajr, 7);
  assert.equal(cache.restore(b, date).prayerAdjustments.fajr, 2);
  assert.equal(cache.restore({ ...a, calculationMethod: 'Egyptian' }, date), null);
  assert.equal(cache.restore(a, new Date('2026-11-03T12:00:00Z')), null);
});
test('data deletion is restricted to named data, retains settings and resets usage honestly', async (t) => {
  const { storage, resource } = fixture(t);
  fs.writeFileSync(storage.youtubeCachePath, '{}');
  const original = fs.readFileSync(storage.userConfigPath, 'utf8');
  await resource.deleteData('youtube');
  assert(!fs.existsSync(storage.youtubeCachePath));
  assert.equal(fs.readFileSync(storage.userConfigPath, 'utf8'), original);
  await assert.rejects(resource.deleteData('../user-config.json'));
  resource.record('youtube', 123);
  await resource.deleteData('history');
  assert.deepEqual(resource.usage.days, {});
});
test('blocked YouTube keeps cached feed state without contacting the server', async (t) => {
  const { storage } = fixture(t);
  storage.saveConfig({ network: { categories: { youtube: false } } });
  let calls = 0;
  const YT = require('./src/engines/youtube-rss-engine'),
    engine = new YT(
      storage,
      __dirname,
      async () => {
        calls++;
        throw Error('must not fetch');
      },
      { readOnly: true },
    );
  const state = await engine.refreshFeeds();
  assert.equal(calls, 0);
  assert(state.networkErrors.some((row) => row.name === 'إعدادات الشبكة'));
});
