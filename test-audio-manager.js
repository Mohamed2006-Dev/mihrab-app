const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AudioManager } = require('./src/engines/audio-manager');

function setup(initial = { deviceId: 'original-speakers', volume: 0.372549027, muted: false }) {
  let current = { ...initial };
  const calls = [];
  const backend = {
    async getState() {
      calls.push('read');
      return { ...current };
    },
    async mute(state) {
      calls.push(['mute', state.deviceId]);
      current.muted = true;
    },
    async restore(state) {
      calls.push(['restore', { ...state }]);
      current = { ...state };
    },
  };
  return {
    manager: new AudioManager({ backend, platform: 'win32' }),
    backend,
    calls,
    current: () => current,
  };
}

test('restores the exact original system level and original output device', async () => {
  const { manager, current, calls } = setup();
  await manager.muteForLock();
  assert.equal(current().muted, true);
  current().volume = 0.05;
  current().deviceId = 'a-new-default-device';
  await manager.restore();
  assert.deepEqual(current(), { deviceId: 'original-speakers', volume: 0.372549027, muted: false });
  assert.equal(calls.filter((call) => call === 'read').length, 1);
  assert.equal(manager.needsRestore, false);
});

test('preserves an initially muted system and zero volume', async () => {
  const original = { deviceId: 'speakers', volume: 0, muted: true };
  const { manager, current } = setup(original);
  await manager.muteForLock();
  await manager.restore();
  assert.deepEqual(current(), original);
});

test('repeated mute calls never toggle sound or overwrite the original snapshot', async () => {
  const { manager, calls, current } = setup();
  await Promise.all([manager.muteForLock(), manager.muteForLock()]);
  assert.equal(calls.filter((call) => call === 'read').length, 1);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'mute').length, 1);
  await manager.restore();
  await manager.restore();
  assert.equal(current().muted, false);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'restore').length, 1);
});

test('closing immediately during capture waits for mute then restores in order', async () => {
  const { manager, backend, current } = setup();
  let captured;
  backend.getState = () =>
    new Promise((resolve) => {
      captured = resolve;
    });
  const muting = manager.muteForLock();
  assert.equal(manager.needsRestore, true);
  const restoring = manager.restore();
  await Promise.resolve();
  captured({ deviceId: 'speakers', volume: 0.61, muted: false });
  await Promise.all([muting, restoring]);
  assert.deepEqual(current(), { deviceId: 'speakers', volume: 0.61, muted: false });
  assert.equal(manager.needsRestore, false);
});

test('a replacement lock captures the restored state, not the preceding lock mute', async () => {
  const { manager, current } = setup();
  const original = { ...current() };
  await manager.muteForLock();
  await Promise.all([manager.restore(), manager.muteForLock()]);
  await manager.restore();
  assert.deepEqual(current(), original);
});

test('failed restoration retains the snapshot for a later retry', async () => {
  const { manager, backend, current } = setup();
  const restore = backend.restore;
  await manager.muteForLock();
  backend.restore = async () => {
    throw new Error('Device temporarily disconnected');
  };
  await assert.rejects(manager.restore(), /disconnected/);
  assert.equal(manager.needsRestore, true);
  backend.restore = restore;
  await manager.restore();
  assert.equal(current().volume, 0.372549027);
  assert.equal(manager.needsRestore, false);
});

test('a mute command that fails after changing the system can still be restored', async () => {
  const { manager, backend, current } = setup();
  backend.mute = async () => {
    current().muted = true;
    throw new Error('Readback failed');
  };
  await assert.rejects(manager.muteForLock(), /Readback/);
  assert.equal(manager.needsRestore, true);
  await manager.restore();
  assert.equal(current().muted, false);
});

test('invalid or unavailable snapshots cannot change the system volume', async () => {
  for (const state of [
    null,
    {},
    { deviceId: 's', volume: NaN, muted: false },
    { deviceId: 's', volume: 2, muted: false },
  ]) {
    const { manager, backend, calls } = setup();
    backend.getState = async () => state;
    await assert.rejects(manager.muteForLock(), /valid original audio state/);
    assert.deepEqual(calls, []);
    assert.equal(manager.needsRestore, false);
  }
});

test('disabling system mute or running on another platform does not call Windows controls', async () => {
  const { backend, calls } = setup();
  const manager = new AudioManager({ backend, platform: 'linux' });
  await manager.restore();
  await manager.muteForLock();
  assert.deepEqual(calls, []);
  assert.equal(manager.needsRestore, false);
});
