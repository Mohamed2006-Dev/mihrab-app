const { test } = require('node:test');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const root = process.env.MIHRAB_TEST_ROOT || __dirname;
const Geography = require(path.join(root, 'src/engines/prayer-times-engine'));
const Prayer = require(path.join(root, 'src/engines/prayer-engine'));
const Storage = require(path.join(root, 'src/engines/storage-engine'));
const Scheduler = require(path.join(root, 'src/engines/scheduler-engine'));
const Quran = require(path.join(root, 'src/engines/quran-wird-engine'));
const geo = new Geography(null, root);
const date = new Date('2026-11-01T12:00:00Z');
function fixture(t, code = 'FR', fetchFn = null) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-geo-'));
  t.after(() => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert(path.basename(directory).startsWith('mihrab-geo-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const storage = new Storage(root, directory),
    city = geo.cities(code).find((c) => c.isCapital) || geo.cities(code)[0];
  storage.saveConfig({
    location: { ...city, autoDetect: false, calculationMethod: geo.methodForCountry(code) },
    prayerAdjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  });
  const prayer = new Prayer(storage, fetchFn);
  return { storage, prayer, city, directory };
}
function response(data, status = 200) {
  return { ok: status === 200, status, json: async () => data };
}
function globalFeed(prayer, at = date, patch = {}) {
  const loc = prayer.getLocation(),
    raw = prayer.calculateRawPrayerTimes(at);
  const names = {
    fajr: 'Fajr',
    sunrise: 'Sunrise',
    dhuhr: 'Dhuhr',
    asr: 'Asr',
    maghrib: 'Maghrib',
    isha: 'Isha',
  };
  const timings = Object.fromEntries(
    Object.entries(names).map(([id, name]) => [name, raw[id].toISOString()]),
  );
  const p = Geography.dateParts(at, loc.timeZone);
  return {
    code: 200,
    data: {
      timings,
      date: { gregorian: { date: p.day + '-' + p.month + '-' + p.year } },
      meta: {
        timezone: loc.timeZone,
        method: { id: Geography.API_METHODS[loc.calculationMethod] },
      },
      ...patch,
    },
  };
}
function officialFeed(city = 'الرباط', day = '2026-11-01') {
  return {
    villes: [
      {
        nom: city,
        horaires: [
          {
            date: day,
            Fajr: '05:11',
            Chorouq: '06:44',
            Dhuhr: '12:30',
            Asr: '15:37',
            Maghrib: '17:33',
            Ishae: '18:53',
          },
        ],
      },
    ],
  };
}
test('global countries include all continents and every bundled city has coordinates and an IANA zone', () => {
  const countries = geo.countries();
  assert.equal(countries.length, 249);
  assert(!countries.some((c) => ['CS', 'AN'].includes(c.code)));
  for (const code of [
    'US',
    'CA',
    'BR',
    'MX',
    'FR',
    'DE',
    'JP',
    'CN',
    'IN',
    'AU',
    'NZ',
    'ZA',
    'NG',
    'KE',
    'MA',
    'SA',
  ])
    assert(countries.some((c) => c.code === code));
  let count = 0;
  for (const country of countries)
    for (const city of geo.cities(country.code)) {
      count++;
      assert(Number.isFinite(city.lat) && Math.abs(city.lat) <= 90);
      assert(Number.isFinite(city.lng) && Math.abs(city.lng) <= 180);
      assert(city.id && city.city && city.timeZone);
      assert.equal(city.countryCode, country.code);
      assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: city.timeZone }));
    }
  assert(count > 34000);
  assert.deepEqual(geo.cities('AQ'), []);
});
test('country-method defaults follow the requested regional map', () => {
  for (const [codes, method] of [
    [['MA'], 'Habous'],
    [['SA', 'AE', 'KW', 'QA', 'BH', 'OM'], 'UmmAlQura'],
    [['EG', 'SD', 'SY', 'LB', 'JO', 'PS', 'DZ', 'TN', 'LY'], 'Egyptian'],
    [['TR', 'BA', 'AL', 'MK', 'XK', 'RS', 'BG', 'GR', 'RO'], 'Turkey'],
    [['US', 'CA'], 'NorthAmerica'],
    [['PK', 'IN', 'BD', 'AF'], 'Karachi'],
    [['FR', 'DE', 'BR', 'JP', 'AU', 'ZA'], 'MuslimWorldLeague'],
  ])
    for (const code of codes) assert.equal(geo.methodForCountry(code), method, code);
});
test('country aliases and legacy labels resolve without stale country codes', () => {
  const loc = geo.normalizeLocation({
    country: 'المملكة العربية السعودية',
    countryCode: 'MA',
    lat: 21.4,
    lng: 39.8,
  });
  assert.equal(loc.countryCode, 'SA');
  assert.equal(loc.timeZone, 'Asia/Riyadh');
  assert.equal(loc.calculationMethod, 'UmmAlQura');
  assert.equal(geo.country('France').code, 'FR');
  assert.equal(geo.country('فرنسا').code, 'FR');
});
test('manual methods remain selectable; unsupported method and timezone are explicit errors', () => {
  assert.equal(
    geo.normalizeLocation({
      ...geo.cities('US')[0],
      calculationMethod: 'Karachi',
      calculationMethodSelection: 'manual',
    }).calculationMethod,
    'Karachi',
  );
  assert.throws(
    () => geo.normalizeLocation({ ...geo.cities('US')[0], calculationMethod: 'wrong' }),
    /غير مدعومة/,
  );
  assert.throws(
    () => geo.normalizeLocation({ ...geo.cities('US')[0], timeZone: 'Invalid/Zone' }),
    /منطقة زمنية/,
  );
});
test('equator and Greenwich zero values are preserved and invalid coordinates are rejected', () => {
  const loc = geo.normalizeLocation({
    countryCode: 'GB',
    lat: 0,
    lng: 0,
    timeZone: 'Europe/London',
  });
  assert.equal(loc.lat, 0);
  assert.equal(loc.lng, 0);
  for (const lat of [NaN, Infinity, 91])
    assert.throws(() => geo.normalizeLocation({ lat, lng: 0 }), /إحداثيات/);
});
test('prayer cards use the selected city day and time zone across the international date line', (t) => {
  const f = fixture(t, 'NZ');
  f.storage.saveConfig({
    location: {
      city: 'Kiritimati',
      country: 'كيريباتي',
      countryCode: 'KI',
      lat: 1.872,
      lng: -157.428,
      timeZone: 'Pacific/Kiritimati',
      calculationMethod: 'MuslimWorldLeague',
    },
  });
  const at = new Date('2026-10-29T23:30:00Z'),
    data = f.prayer.calculateLocalPrayerTimes(at);
  assert.equal(data.dateKey, '2026-10-30');
  assert.equal(data.isFriday, true);
  assert.equal(
    Geography.dateKey(data.prayers.find((p) => p.id === 'dhuhr').time, 'Pacific/Kiritimati'),
    data.dateKey,
  );
  for (const prayer of data.prayers) {
    assert.equal(prayer.time24, Geography.formatTime(prayer.time, 'Pacific/Kiritimati'));
    assert.equal(prayer.time.getUTCSeconds(), 0);
  }
});
test('date shifts retain the previous city day across daylight saving changes', () => {
  for (const [at, zone, previous] of [
    ['2026-03-09T04:30:00Z', 'America/New_York', '2026-03-08'],
    ['2026-11-02T05:30:00Z', 'America/New_York', '2026-11-01'],
    ['2026-10-30T11:30:00Z', 'Pacific/Kiritimati', '2026-10-30'],
  ])
    assert.equal(Geography.dateKey(Geography.shiftDay(new Date(at), -1, zone), zone), previous);
});
test('unknown polar prayer times remain unavailable instead of becoming invented clock values', (t) => {
  const f = fixture(t, 'NO');
  f.storage.saveConfig({
    location: { city: 'Longyearbyen', lat: 78.2232, lng: 15.6469, timeZone: 'Arctic/Longyearbyen' },
  });
  const data = f.prayer.calculateLocalPrayerTimes(new Date('2026-06-21T12:00:00Z'));
  assert(data.calculationWarning);
  assert(data.prayers.some((p) => p.time === null && p.time24 === '--:--'));
});
test('global verification selects ISNA/Karachi/MWL/Diyanet IDs and correct city timezone/date', async (t) => {
  for (const code of ['US', 'CA', 'PK', 'IN', 'FR', 'TR']) {
    const f = fixture(t, code);
    let url;
    f.prayer.setFetchFn(async (target) => {
      url = new URL(target);
      return response(globalFeed(f.prayer));
    });
    const report = await f.prayer.verifyWithOfficialAwqafApi({
      date,
      dryRun: true,
      throwOnError: true,
    });
    assert.equal(report.status, 'alternative_updated');
    assert.equal(report.message, Geography.ALTERNATIVE_MESSAGE);
    assert.equal(
      url.searchParams.get('method'),
      String(Geography.API_METHODS[geo.methodForCountry(code)]),
    );
    assert.equal(url.searchParams.get('timezonestring'), f.prayer.getLocation().timeZone);
    assert(url.pathname.endsWith('/01-11-2026'));
    assert(Object.values(report.discrepanciesInMinutes).every((v) => v === 0));
  }
});
test('successful Moroccan verification really reads the official exact city and date, preserving a manual method', async (t) => {
  const f = fixture(t, 'MA');
  f.storage.saveConfig({
    location: {
      city: 'الرباط',
      lat: 34.0209,
      lng: -6.8416,
      calculationMethod: 'Egyptian',
      calculationMethodSelection: 'manual',
    },
  });
  const calls = [];
  f.prayer.setFetchFn(async (url) => {
    calls.push(url);
    return response(officialFeed());
  });
  const report = await f.prayer.verifyWithOfficialAwqafApi({ date, throwOnError: true });
  assert.equal(report.status, 'verified_online');
  assert.equal(report.message, Geography.OFFICIAL_MESSAGE);
  assert.equal(calls.length, 1);
  assert(calls[0].startsWith('https://www.habous.gov.ma/'));
  assert.equal(f.storage.getConfig().location.calculationMethod, 'Egyptian');
  assert(report.autoApplied);
  assert.deepEqual(f.storage.getConfig().prayerAdjustments, report.discrepanciesInMinutes);
});
test('an unknown Moroccan city or wrong official day uses an explicit alternative, never Rabat or the first day', async (t) => {
  for (const feed of [officialFeed('مدينة أخرى'), officialFeed('الرباط', '2026-10-31')]) {
    const f = fixture(t, 'MA');
    f.storage.saveConfig({ location: { city: 'الرباط', lat: 34.0209, lng: -6.8416 } });
    f.prayer.setFetchFn(async (url) =>
      response(url.includes('habous.gov.ma') ? feed : globalFeed(f.prayer)),
    );
    const report = await f.prayer.verifyWithOfficialAwqafApi({
      date,
      dryRun: true,
      throwOnError: true,
    });
    assert.equal(report.status, 'alternative_updated');
    assert(report.officialError);
  }
});
test('an unreachable official provider can fall back successfully without being labelled official', async (t) => {
  const f = fixture(t, 'MA');
  f.prayer.setFetchFn(async (url) => {
    if (url.includes('habous')) throw TypeError('network disconnected');
    return response(globalFeed(f.prayer));
  });
  const report = await f.prayer.verifyWithOfficialAwqafApi({
    date,
    dryRun: true,
    throwOnError: true,
  });
  assert.equal(report.providerKind, 'alternative');
  assert.equal(report.status, 'alternative_updated');
  assert(report.officialError.includes('disconnected'));
});
test('offline failure is friendly, keeps previous offsets, and never marks autoApplied', async (t) => {
  const f = fixture(t, 'FR', async () => {
    throw TypeError('offline');
  });
  f.storage.saveConfig({ prayerAdjustments: { fajr: 7, maghrib: 2 } });
  const before = f.storage.getConfig().prayerAdjustments;
  const report = await f.prayer.verifyWithOfficialAwqafApi({ date });
  assert.equal(report.message, Geography.OFFLINE_MESSAGE);
  assert.equal(report.status, 'offline_fallback');
  assert.equal(report.autoApplied, false);
  assert.deepEqual(f.storage.getConfig().prayerAdjustments, before);
  await assert.rejects(
    f.prayer.verifyWithOfficialAwqafApi({ date, throwOnError: true }),
    /قد يكون التوقيت/,
  );
});
test('HTTP and malformed/wrong-day/timezone/method responses fail without a false offline or success label', async (t) => {
  const f = fixture(t, 'FR');
  const original = f.storage.getConfig().prayerAdjustments;
  const bad = [
    response({}, 503),
    response({ code: 200, data: { timings: { Fajr: 'NaN' } } }),
    response(globalFeed(f.prayer, date, { date: { gregorian: { date: '31-10-2026' } } })),
    response(globalFeed(f.prayer, date, { meta: { timezone: 'Asia/Tokyo' } })),
    response(globalFeed(f.prayer, date, { meta: { method: { id: 4 } } })),
  ];
  for (const result of bad) {
    f.prayer.setFetchFn(async () => result);
    const report = await f.prayer.verifyWithOfficialAwqafApi({ date });
    assert.equal(report.status, 'sync_failed');
    assert.equal(report.autoApplied, false);
    assert.deepEqual(f.storage.getConfig().prayerAdjustments, original);
    assert(report.error);
  }
});
test('dry-run verification changes neither config nor monthly cache files', async (t) => {
  const f = fixture(t, 'MA');
  f.storage.saveConfig({ location: { city: 'الرباط' } });
  const raw = fs.readFileSync(f.storage.userConfigPath);
  f.prayer.setFetchFn(async () =>
    response({ villes: Array.from({ length: 30 }, () => officialFeed().villes[0]) }),
  );
  await f.prayer.verifyWithOfficialAwqafApi({ date, dryRun: true, throwOnError: true });
  assert(raw.equals(fs.readFileSync(f.storage.userConfigPath)));
  assert(!fs.existsSync(path.join(f.storage.dataDir, 'habous-horaires-2026-11.json')));
});
test('cached official data cannot claim a fresh online verification', async (t) => {
  const f = fixture(t, 'MA');
  f.storage.saveConfig({ location: { city: 'الرباط' } });
  fs.writeFileSync(
    path.join(f.storage.dataDir, 'habous-horaires-2026-11.json'),
    JSON.stringify({ villes: Array.from({ length: 30 }, () => officialFeed().villes[0]) }),
  );
  f.prayer.setFetchFn(async () => {
    throw Error('no request should happen');
  });
  const report = await f.prayer.verifyWithOfficialAwqafApi({
    date,
    bypassCache: false,
    dryRun: true,
    throwOnError: true,
  });
  assert.equal(report.status, 'verified_cached');
  assert.notEqual(report.message, Geography.OFFICIAL_MESSAGE);
});
test('prayer verification state expires when the day or geographic location changes', async (t) => {
  const f = fixture(t, 'FR');
  f.prayer.setFetchFn(async () => response(globalFeed(f.prayer)));
  await f.prayer.verifyWithOfficialAwqafApi({ date, throwOnError: true });
  assert.equal(f.prayer.calculateLocalPrayerTimes(date).verification.status, 'alternative_updated');
  f.prayer.setFetchFn(async () => {
    throw TypeError('offline');
  });
  await f.prayer.verifyWithOfficialAwqafApi({ date });
  assert.equal(f.storage.getConfig().officialSync.lastDiscrepancyReport.officialTimings, null);
  f.prayer.setFetchFn(async () => response(globalFeed(f.prayer)));
  await f.prayer.verifyWithOfficialAwqafApi({ date, throwOnError: true });
  assert.equal(f.storage.getConfig().officialSync.lastDiscrepancyReport.error, null);
  assert.equal(
    f.prayer.calculateLocalPrayerTimes(new Date('2026-11-02T12:00:00Z')).verification,
    null,
  );
  f.storage.saveConfig({ location: { lng: f.city.lng + 1 } });
  assert.equal(f.prayer.calculateLocalPrayerTimes(date).verification, null);
});
test('city aliases cannot substitute Rabat for Sale or eastern Laayoune for western Laayoune', (t) => {
  const f = fixture(t, 'MA'),
    engine = f.prayer.habousSyncEngine;
  const cities = [{ nom: 'الرباط' }, { nom: 'سلا' }, { nom: 'العيون الشرقية' }, { nom: 'العيون' }];
  assert.equal(engine.matchCity(cities, 'سلا').nom, 'سلا');
  assert.equal(engine.matchCity(cities, 'العيون').nom, 'العيون');
  assert.equal(engine.matchCity([{ nom: 'الرباط' }], 'سلا'), null);
  assert.equal(engine.matchCity([{ nom: 'العيون الشرقية' }], 'العيون'), null);
});
test('scheduling fires once at the displayed city instant even when host calendar date differs', (t) => {
  const f = fixture(t, 'NZ');
  f.storage.saveConfig({
    location: {
      city: 'Kiritimati',
      country: 'كيريباتي',
      countryCode: 'KI',
      lat: 1.872,
      lng: -157.428,
      timeZone: 'Pacific/Kiritimati',
      calculationMethod: 'MuslimWorldLeague',
    },
    officialSync: { enabled: false },
    screenLock: { enabled: false },
  });
  const data = f.prayer.calculateLocalPrayerTimes(new Date('2026-10-29T22:00:00Z')),
    at = data.prayers.find((p) => p.id === 'dhuhr').time,
    events = [];
  const scheduler = new Scheduler({
    storage: f.storage,
    prayerEngine: f.prayer,
    hadithEngine: { getHadithForPrayer: () => ({}) },
    quranEngine: { getFullStatus: () => ({ schedules: {} }) },
    youtubeEngine: {},
    callbacks: { onPrayerTimeReached: (value) => events.push(value) },
  });
  scheduler.tick(new Date(at.getTime() - 30000));
  assert.equal(events.length, 0);
  scheduler.tick(at);
  scheduler.tick(new Date(at.getTime() + 10000));
  assert.equal(events.length, 1);
  assert.equal(scheduler.lastDateKey, Geography.dateKey(at, 'Pacific/Kiritimati'));
});
test('Quran reminders display their clock in the selected city timezone', (t) => {
  const f = fixture(t, 'US'),
    quran = new Quran(f.storage, root),
    data = f.prayer.calculateLocalPrayerTimes(date);
  const schedules = quran.computeNotificationSchedules(data),
    config = f.storage.getConfig();
  const expected = new Date(
    data.prayers.find((p) => p.id === 'isha').time.getTime() +
      (config.quranWird.reading.afterIshaMinutes || 30) * 60000,
  );
  assert.equal(
    schedules.readingNotificationTime,
    Geography.formatTime(expected, data.location.timeZone),
  );
});
test('the 2026 Moroccan legal-time change is applied once at its precise UTC boundary', () => {
  assert.equal(
    Geography.formatTime(new Date('2026-08-01T12:00:00Z'), 'Africa/Casablanca'),
    '13:00',
  );
  assert.equal(
    Geography.formatTime(new Date('2026-09-20T00:59:00Z'), 'Africa/Casablanca'),
    '01:59',
  );
  assert.equal(
    Geography.formatTime(new Date('2026-09-20T01:00:00Z'), 'Africa/Casablanca'),
    '01:00',
  );
  assert.equal(
    Geography.formatTime(new Date('2026-11-01T12:00:00Z'), 'Africa/Casablanca'),
    '12:00',
  );
});
test('alternative times require an explicit offset and convert the instant instead of applying a timezone-sized correction', async (t) => {
  const f = fixture(t, 'MA');
  f.prayer.setFetchFn(async (url) => {
    if (url.includes('habous')) throw TypeError('official temporarily unavailable');
    return response(globalFeed(f.prayer));
  });
  const report = await f.prayer.verifyWithOfficialAwqafApi({
    date,
    dryRun: true,
    throwOnError: true,
  });
  assert(Object.values(report.discrepanciesInMinutes).every((v) => v === 0));
  f.prayer.setFetchFn(async (url) => {
    if (url.includes('habous')) throw TypeError('official temporarily unavailable');
    const result = globalFeed(f.prayer);
    result.data.timings.Fajr = '05:00';
    return response(result);
  });
  const failure = await f.prayer.verifyWithOfficialAwqafApi({ date, dryRun: true });
  assert.equal(failure.status, 'sync_failed');
  assert.match(failure.error, /إزاحة زمنية/);
});

test('the country list exposes Palestine and migrates former location codes to it', () => {
  const countries = geo.countries();
  assert(!countries.some((c) => c.code === 'IL'));
  assert.equal(geo.country('PS').name, 'فلسطين');
  for (const name of ['IL', 'Israel', 'إسرائيل', 'دولة فلسطين'])
    assert.equal(geo.country(name).code, 'PS');
  const cities = geo.cities('PS');
  assert.equal(cities.length, 146);
  assert.equal(new Set(cities.map((c) => c.id)).size, cities.length);
  assert(cities.every((c) => c.country === 'فلسطين' && c.countryCode === 'PS'));
  assert.equal(
    geo.normalizeLocation({ countryCode: 'IL', country: 'Israel', lat: 31.78, lng: 35.22 }).country,
    'فلسطين',
  );
});
