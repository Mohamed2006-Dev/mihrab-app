const testSource = require('./scripts/test-source.cjs');
const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('fs'),
  os = require('os'),
  path = require('path'),
  vm = require('vm');
const {
  ProjectInfoEngine,
  sanitize,
  safeUrl,
  PRIVATE_FILE,
} = require('./src/engines/project-info-engine');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-project-test-'));
  fs.mkdirSync(path.join(root, 'data'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('Public contacts never include banking or arbitrary private properties', (t) => {
  const root = fixture(t);
  fs.writeFileSync(
    path.join(root, 'data', PRIVATE_FILE),
    JSON.stringify({
      gitHub: 'https://github.com/example',
      paypal: 'https://paypal.me/example',
      secret: 'fixture-private',
      bank_account_informations: {
        full_name: 'Fixture User',
        rib: 'TEST-000',
        swift_code: 'TESTCODE',
      },
    }),
  );
  const engine = new ProjectInfoEngine(root),
    info = engine.publicInfo();
  assert.equal(info.contacts.paypal, 'https://paypal.me/example');
  assert(!JSON.stringify(info).includes('TEST-000'));
  assert(!JSON.stringify(info).includes('fixture-private'));
  assert.equal(engine.bankInfo().bank.rib, 'TEST-000');
  assert.equal(engine.bankField('rib'), 'TEST-000');
  assert.throws(() => engine.bankField('secret'));
  assert.throws(() => engine.contactUrl('bank_account_informations'));
});
test('Contact links restrict schemes, domains and credentials', () => {
  for (const value of [
    'javascript:alert(1)',
    'http://paypal.me/example',
    'https://paypal.me.evil.example/u',
    'https://example.com/u',
    'https://user:pass@paypal.me/u',
    'https://paypal.me:444/u',
  ])
    assert.equal(safeUrl(value, 'paypal'), null);
  assert.equal(safeUrl('fixture@example.com', 'gmail'), 'mailto:fixture@example.com');
  assert.equal(safeUrl('a@example.com?subject=x', 'gmail'), null);
  assert.equal(safeUrl('https://github.com/', 'gitHub'), null);
  assert.deepEqual(Object.keys(sanitize({})), ['gitHub', 'instagram', 'gmail', 'paypal']);
});
test('Bank support returns only bank fields without loading a QR image', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'data', 'bank-acc-qr.jpg'), 'not an image');
  const info = new ProjectInfoEngine(root).bankInfo();
  assert(!('qr' in info));
  assert.deepEqual(Object.keys(info), ['bank']);
});
test('Malformed configuration reports a generic error without exposing contents', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'data', PRIVATE_FILE), '{"private_fixture": bad }');
  assert.throws(
    () => new ProjectInfoEngine(root).publicInfo(),
    (error) => !error.message.includes('private_fixture') && error.message.includes('تعذر'),
  );
});
test('Packaged app ignores the private source and uses the explicit public support file', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'data', PRIVATE_FILE), 'not JSON');
  fs.writeFileSync(
    path.join(root, 'data', 'project-public-info.json'),
    JSON.stringify({
      paypal: 'https://paypal.me/example',
      bank_account_informations: { rib: 'TEST-000' },
    }),
  );
  const engine = new ProjectInfoEngine(root, root, true);
  assert(engine.publicInfo().contacts.paypal);
  assert.equal(engine.bankField('rib'), 'TEST-000');
  const pkg = require('./package.json');
  assert(pkg.build.files.includes('!data/personal-data*.json'));
  assert(
    pkg.build.extraResources.find((v) => v.from === 'data').filter.includes('!personal-data*.json'),
  );
});
test('Quran bell toggles preserve the other mode, custom timing and dismiss disabled notices', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'),
    handlers = new Map();
  let config = {
      quranWird: {
        notificationMode: 'both',
        reading: { customTime: '09:15' },
        hifz: { customTime: '06:20' },
      },
    },
    dismiss;
  const context = {
    ipcMain: { handle: (k, fn) => handlers.set(k, fn) },
    projectInfoEngine: {},
    storage: {
      getConfig: () => config,
      saveConfig: (patch) =>
        (config = { ...config, quranWird: { ...config.quranWird, ...patch.quranWird } }),
    },
    prayerEngine: { calculateLocalPrayerTimes: () => ({ isFriday: false }) },
    quranEngine: { getFullStatus: () => ({ settings: config.quranWird }) },
    getAppNow: () => new Date(),
    notificationCenter: { closeWhere: (fn) => (dismiss = fn) },
    NoticePolicy: require('./src/engines/notification-settings'),
  };
  vm.runInNewContext(
    src.slice(
      src.indexOf('// Contact data stays local;'),
      testSource.ipcStart(src, 'quran:advance-progress'),
    ),
    context,
  );
  const toggle = handlers.get('quran:toggle-notification');
  assert.equal(toggle(null, 'reading').config.quranWird.notificationMode, 'hifz_only');
  assert(dismiss({ type: 'quran_reading' }));
  assert(!dismiss({ type: 'quran_hifz' }));
  assert.equal(toggle(null, 'hifz').config.quranWird.notificationMode, 'none');
  assert.equal(toggle(null, 'reading').config.quranWird.notificationMode, 'reading_only');
  assert.equal(toggle(null, 'hifz').config.quranWird.notificationMode, 'both');
  assert.equal(config.quranWird.reading.customTime, '09:15');
  assert.throws(() => toggle(null, 'arbitrary'));
});

test('Local contact formats normalize without weakening allowed domains', (t) => {
  assert.equal(safeUrl('paypal.me/example', 'paypal'), 'https://paypal.me/example');
  assert.equal(
    safeUrl('https//www.instagram.com/example', 'instagram'),
    'https://www.instagram.com/example',
  );
  assert.equal(safeUrl('@example', 'instagram'), 'https://instagram.com/example');
  assert.equal(safeUrl('github.com/example', 'gitHub'), 'https://github.com/example');
  assert.equal(safeUrl('https//evil.example/example', 'instagram'), null);
  const root = fixture(t);
  fs.writeFileSync(
    path.join(root, 'data', PRIVATE_FILE),
    '\ufeff' + JSON.stringify({ github: 'github.com/example', gmail: 'fixture@example.com' }),
  );
  const engine = new ProjectInfoEngine(root);
  assert(engine.publicInfo().contacts.gitHub);
  assert.equal(
    engine.contactUrl('gmail'),
    'https://mail.google.com/mail/?view=cm&fs=1&to=fixture%40example.com',
  );
});

test('Report drafts encode exact text and use only the dedicated inbox', () => {
  const { buildReport, issueBase } = require('./src/engines/bug-report-engine');
  const payload = {
    scope: 'الصلاة & اختبار',
    description: 'وصف عربي\n&to=attacker@example.com',
    channel: 'gmail',
  };
  let draft = buildReport(payload),
    url = new URL(draft.url);
  assert.equal(url.hostname, 'mail.google.com');
  assert.equal(url.searchParams.get('to'), 'anonymous.acc.unkown@gmail.com');
  assert(url.searchParams.get('body').includes(payload.description));
  assert(!draft.copyRequired);
  draft = buildReport({ ...payload, channel: 'github' }, 'https://github.com/example/repo/issues');
  url = new URL(draft.url);
  assert.equal(url.pathname, '/example/repo/issues/new');
  assert(url.searchParams.get('body').includes(payload.description));
  for (const bad of [
    'http://github.com/example/repo/issues',
    'https://evil.example/repo/issues',
    'https://github.com/example/repo/pulls',
    'https://user:pass@github.com/example/repo/issues',
  ])
    assert.throws(() => issueBase(bad));
  assert.throws(() => buildReport({ ...payload, channel: 'unknown' }));
  assert.throws(() => buildReport({ ...payload, scope: '' }));
  draft = buildReport({ ...payload, description: 'ن'.repeat(8000) });
  assert(draft.copyRequired);
  assert(draft.text.includes('ن'.repeat(8000)));
  assert(!new URL(draft.url).searchParams.has('body'));
});
