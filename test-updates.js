const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { EventEmitter } = require('node:events');
const { UpdateEngine } = require('./src/engines/update-engine');
function fixture({ supported = true, allowed = true, busy = false } = {}) {
  let config = { updates: {} };
  const updater = new EventEmitter();
  Object.assign(updater, {
    setFeedURL: (feed) => (updater.feed = feed),
    checkForUpdates: async () => ({ updateInfo: { version: updater.next || '1.0.1' } }),
    downloadUpdate: async () => {
      updater.emit('update-downloaded', { version: '1.0.1' });
    },
    quitAndInstall: () => (updater.installed = true),
  });
  const storage = {
    getConfig: () => config,
    saveConfig: (p) => (config = { ...config, updates: { ...config.updates, ...p.updates } }),
  };
  return {
    updater,
    storage,
    engine: new UpdateEngine({
      updater,
      storage,
      supported,
      allowed: () => allowed,
      busy: () => busy,
      version: '1.0.0',
    }),
  };
}
test('Stable checks persist timestamp and download only on request', async () => {
  const f = fixture();
  await f.engine.check();
  assert.equal(f.engine.status().phase, 'available');
  assert(f.storage.getConfig().updates.lastChecked);
  assert(!f.engine.ready);
  assert.equal(f.updater.allowPrerelease, false);
  await f.engine.download();
  assert(f.engine.ready);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  f.engine.install();
  assert(f.updater.installed);
});
test('Prerelease opt in never enables downgrade and manual checks bypass daily schedule', async () => {
  const f = fixture();
  f.storage.saveConfig({ updates: { enabled: false, prerelease: true, autoDownload: true } });
  f.engine.configure();
  await f.engine.check();
  assert.equal(f.updater.allowPrerelease, true);
  assert.equal(f.updater.allowDowngrade, false);
  assert(f.engine.ready);
});
test('Development, blocked network and prayer lock cannot install', async () => {
  await assert.rejects(fixture({ supported: false }).engine.check());
  await assert.rejects(fixture({ allowed: false }).engine.check());
  const f = fixture({ busy: true });
  await f.engine.check();
  await f.engine.download();
  assert.throws(() => f.engine.install(), /التثبيت مؤجل/);
  assert(!f.updater.installed);
});
test('No newer version and failed checks are reported honestly', async () => {
  const f = fixture();
  f.updater.next = '1.0.0';
  await f.engine.check();
  assert.equal(f.engine.status().phase, 'current');
  f.updater.checkForUpdates = async () => {
    throw Error('offline');
  };
  await assert.rejects(f.engine.check());
  assert.equal(f.engine.status().phase, 'error');
});
test('Periodic check obeys opt out and does not overlap checks', async () => {
  const f = fixture();
  let calls = 0,
    done;
  f.updater.checkForUpdates = () => {
    calls++;
    return new Promise((resolve) => (done = resolve));
  };
  f.storage.saveConfig({ updates: { enabled: false } });
  f.engine.tick();
  assert.equal(calls, 0);
  f.storage.saveConfig({ updates: { enabled: true } });
  f.engine.tick();
  f.engine.tick();
  assert.equal(calls, 1);
  done({ updateInfo: { version: '1.0.0' } });
});
