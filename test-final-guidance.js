const testSource = require('./scripts/test-source.cjs');
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
test('Quick view region changes validate a real city and calculation method before saving', async () => {
  let handler, patch;
  const ctx = {
    ipcMain: { handle: (_, fn) => (handler = fn) },
    require,
    prayerEngine: {
      getCountries: () => [{ code: 'MA', method: 'Habous' }],
      getCities: () => [
        {
          id: 'test',
          city: 'مدينة اختبار',
          countryCode: 'MA',
          lat: 34,
          lng: -6,
          timeZone: 'Africa/Casablanca',
        },
      ],
    },
    saveApplicationSettings: async (value) => {
      patch = value;
      return { config: {}, prayerData: {} };
    },
    mainWindow: null,
  };
  vm.runInNewContext(testSource.ipc(source, 'mini:save-region'), ctx);
  await handler(null, {
    countryCode: 'MA',
    cityId: 'test',
    calculationMethod: 'MuslimWorldLeague',
    manual: true,
  });
  assert.equal(patch.location.calculationMethod, 'MuslimWorldLeague');
  assert.equal(patch.location.calculationMethodSelection, 'manual');
  assert.equal(patch.location.autoDetect, false);
  await assert.rejects(
    handler(null, { countryCode: 'MA', cityId: 'missing', calculationMethod: 'Habous' }),
  );
  await assert.rejects(
    handler(null, { countryCode: 'MA', cityId: 'test', calculationMethod: 'invalid' }),
  );
});
test('Quick view reserves notification space and hides if there is no safe room', () => {
  let bounds,
    hidden = false;
  const entries = new Map([
    ['notice', { ready: true, height: 180, win: { isDestroyed: () => false } }],
  ]);
  const ctx = {
    miniWindow: {
      isDestroyed: () => false,
      isVisible: () => true,
      setBounds: (value) => (bounds = value),
      hide: () => (hidden = true),
    },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
    miniExpanded: false,
    notificationCenter: { entries },
  };
  vm.runInNewContext(testSource.namedFunction(source, 'positionMini'), ctx);
  ctx.positionMini();
  assert.equal(bounds.y, 900 - 16 - 192 - 310);
  assert.equal(bounds.x, 1440 - 420 - 16);
  entries.get('notice').height = 800;
  ctx.positionMini();
  assert(hidden);
});
test('Release rules keep runtime state and original private account source out of packages', () => {
  const pkg = require('./package.json'),
    ignore = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
  for (const name of [
    'personal-data*.json',
    'user-config.json',
    'network-usage.json',
    'city-prayer-cache.json',
    'youtube-cache.json',
  ]) {
    assert(pkg.build.files.includes('!data/' + name));
    assert(pkg.build.extraResources.find((e) => e.from === 'data').filter.includes('!' + name));
    assert(ignore.includes('data/' + name));
  }
});
