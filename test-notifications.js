const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Scheduler = require('./src/engines/scheduler-engine');
const NotificationCenter = require('./src/engines/notification-center');

function time(hm, day = '2026-11-01') {
  return new Date(`${day}T${hm}`);
}
function schedulerFixture(lockEnabled = false, isha = 20) {
  const config = {
    location: {},
    prayerAdjustments: {},
    notifications: {
      prePrayerMinutes: 15,
      fridayPrePrayerMinutes: 60,
      dailyVideoAfterIshaMinutes: 45,
    },
    screenLock: {
      enabled: lockEnabled,
      minutesBeforeAdhan: 15,
      lockDurationMinutes: 20,
      snoozeMinutes: 3,
      muteSystemAudio: true,
    },
  };
  const events = [];
  let calculations = 0;
  const engine = new Scheduler({
    storage: { getConfig: () => config },
    prayerEngine: {
      calculateLocalPrayerTimes: (date) => {
        calculations++;
        const prayers = [
          ['fajr', 5],
          ['sunrise', 6],
          ['dhuhr', 13],
          ['asr', 16],
          ['maghrib', 18],
          ['isha', isha],
        ].map(([id, hour]) => {
          const at = new Date(date);
          at.setHours(hour, 0, id === 'dhuhr' ? 45 : 0, 0);
          return { id, name: id, time: at, time24: `${hour}:00`, time12: `${hour}:00` };
        });
        return { prayers, isFriday: date.getDay() === 5 };
      },
      verifyWithOfficialAwqafApi: async () => ({}),
    },
    hadithEngine: { getHadithForPrayer: () => ({ hadith: { text: 'حديث' } }) },
    quranEngine: { getFullStatus: () => ({ schedules: {}, readingSummary: {}, hifzSummary: {} }) },
    youtubeEngine: {
      refreshFeeds: async () => ({
        dailyRecommendation: {
          videoId: 'abcdefghijk',
          title: 'درس',
          channelName: 'قناة',
          contextTitle: 'العلم',
        },
      }),
    },
    callbacks: Object.fromEntries(
      [
        'onNotification',
        'onPrayerTimeReached',
        'onPreLockWarning',
        'onActivateScreenLock',
        'onModeChanged',
        'onError',
      ].map((name) => [name, (data) => events.push({ name, data })]),
    ),
  });
  return {
    engine,
    events,
    config,
    calculations: () => calculations,
    of: (name) => events.filter((event) => event.name === name),
  };
}

test('adhan cannot fire 30 seconds early; it fires once at the displayed minute', () => {
  const f = schedulerFixture();
  f.engine.tick(time('12:59:30'));
  assert.equal(f.of('onPrayerTimeReached').length, 0);
  f.engine.tick(time('13:00:00'));
  assert.equal(f.of('onPrayerTimeReached').length, 1);
  assert.equal(f.of('onPrayerTimeReached')[0].data.prayer.time.getSeconds(), 0);
  f.engine.tick(time('13:00:30'));
  f.engine.tick(time('13:00:59'));
  f.engine.tick(time('13:01:00'));
  assert.equal(f.of('onPrayerTimeReached').length, 1);
});

test('sunrise has no adhan; old prayer minutes are not replayed on startup', () => {
  const f = schedulerFixture();
  f.engine.tick(time('06:00:00'));
  f.engine.tick(time('13:02:00'));
  assert.equal(f.of('onPrayerTimeReached').length, 0);
});

test('a failed hadith update is reported and cannot suppress the adhan', () => {
  const f = schedulerFixture();
  f.engine.hadithEngine.getHadithForPrayer = () => {
    throw new Error('hadith-write-failed');
  };
  f.engine.tick(time('13:00:00'));
  assert.equal(f.of('onPrayerTimeReached').length, 1);
  assert.equal(f.of('onError')[0].data.message, 'hadith-write-failed');
});

test('hadith updates use isolated writable data and leave the real cache unchanged', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const Storage = require('./src/engines/storage-engine');
  const Hadith = require('./src/engines/hadith-engine');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-hadith-test-'));
  const realCache = path.join(__dirname, 'data', 'hadith-cache.json');
  const before = fs.existsSync(realCache) ? fs.readFileSync(realCache) : null;
  try {
    const storage = new Storage(__dirname, directory);
    const engine = new Hadith(storage, __dirname);
    assert.equal(engine.cachePath, storage.hadithCachePath);
    engine.getHadithForPrayer('isolated-test', true);
    assert(fs.existsSync(storage.hadithCachePath));
    if (before) assert(before.equals(fs.readFileSync(realCache)), 'The real hadith cache changed.');
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert(path.basename(directory).startsWith('mihrab-hadith-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('without a lock screen only the silent persistent pre-prayer reminder is sent', () => {
  const f = schedulerFixture();
  f.engine.tick(time('12:45:00'));
  f.engine.tick(time('12:46:00'));
  const reminders = f.of('onNotification').filter((event) => event.data.type === 'pre_prayer');
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].data.playAudio, false);
  assert.equal(reminders[0].data.persistent, true);
  assert.equal(f.of('onPreLockWarning').length, 0);
  assert.equal(f.of('onActivateScreenLock').length, 0);
});

test('lock mode sends its own warning and lock, without the generic pre-prayer reminder', () => {
  const f = schedulerFixture(true);
  f.engine.tick(time('12:43:00'));
  f.engine.tick(time('12:44:00'));
  f.engine.tick(time('12:45:00'));
  f.engine.tick(time('12:45:30'));
  assert.equal(
    f.of('onNotification').filter((event) => event.data.type === 'pre_prayer').length,
    0,
  );
  assert.equal(f.of('onPreLockWarning').length, 1);
  assert.equal(f.of('onActivateScreenLock').length, 1);
  assert.equal(new Date(f.of('onActivateScreenLock')[0].data.prayerTime).getMinutes(), 0);
});

test('snooze moves the actual lock deadline instead of missing the original minute forever', () => {
  const f = schedulerFixture(true);
  f.engine.tick(time('12:44:00'));
  const id = f.of('onPreLockWarning')[0].data.scheduleId;
  const result = f.engine.snoozeScreenLock(3, id, time('12:44:15'));
  assert.equal(new Date(result.lockAt).getMinutes(), 48);
  f.engine.tick(time('12:45:00'));
  assert.equal(f.of('onActivateScreenLock').length, 0);
  f.engine.tick(time('12:48:00'));
  assert.equal(f.of('onActivateScreenLock').length, 1);
  assert.throws(() => f.engine.snoozeScreenLock(3, id, time('12:48:01')), /قابل للتمديد/);
});

test('snoozing to adhan cancels this lock and does not suppress the adhan', () => {
  const f = schedulerFixture(true);
  f.engine.tick(time('12:44:00'));
  const id = f.of('onPreLockWarning')[0].data.scheduleId;
  const result = f.engine.snoozeScreenLock(10, id, time('12:54:00'));
  assert.equal(result.cancelled, true);
  f.engine.tick(time('12:45:00'));
  f.engine.tick(time('13:00:00'));
  assert.equal(f.of('onActivateScreenLock').length, 0);
  assert.equal(f.of('onPrayerTimeReached').length, 1);
});

test('switching modes discards pending lock plans and keeps adhan deduplication', () => {
  const f = schedulerFixture(false);
  f.engine.tick(time('12:43:00'));
  f.config.screenLock.enabled = true;
  f.engine.tick(time('12:44:00'));
  f.config.screenLock.enabled = false;
  f.engine.tick(time('12:44:20'));
  f.engine.tick(time('12:45:00'));
  assert.equal(f.of('onPreLockWarning').length, 1);
  assert.equal(f.of('onActivateScreenLock').length, 0);
  assert.equal(f.engine.lockPlans.size, 0);
  f.engine.tick(time('13:00:00'));
  f.config.screenLock.enabled = true;
  f.engine.tick(time('13:00:01'));
  assert.equal(f.of('onPrayerTimeReached').length, 1);
});

test('one-second checking reuses the prayer calculation until settings change', () => {
  const f = schedulerFixture();
  for (let second = 0; second < 20; second++)
    f.engine.tick(time(`12:00:${String(second).padStart(2, '0')}`));
  assert.equal(f.calculations(), 1);
  f.config.prayerAdjustments.dhuhr = 2;
  f.engine.tick(time('12:00:21'));
  assert.equal(f.calculations(), 2);
});

test('daily lesson is due exactly at isha +45 and routes to lessons inside the app', async () => {
  const f = schedulerFixture();
  f.engine.tick(time('20:44:59'));
  await Promise.resolve();
  assert.equal(
    f.of('onNotification').filter((event) => event.data.type === 'daily_video').length,
    0,
  );
  f.engine.tick(time('20:45:00'));
  await Promise.resolve();
  await Promise.resolve();
  const notices = f.of('onNotification').filter((event) => event.data.type === 'daily_video');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].data.action, 'open_lessons');
  assert.equal(notices[0].data.playAudio, false);
});

test('the +45-minute lesson can cross midnight without being lost', async () => {
  const f = schedulerFixture(false, 23);
  f.config.notifications.dailyVideoAfterIshaMinutes = 90;
  f.engine.tick(time('00:29:59', '2026-11-02'));
  await Promise.resolve();
  assert.equal(
    f.of('onNotification').filter((event) => event.data.type === 'daily_video').length,
    0,
  );
  f.engine.tick(time('00:30:00', '2026-11-02'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    f.of('onNotification').filter((event) => event.data.type === 'daily_video').length,
    1,
  );
});

test('Friday advance reminders honor their separate lead time', () => {
  const f = schedulerFixture();
  f.engine.tick(time('11:59:59', '2026-11-06'));
  assert.equal(
    f.of('onNotification').filter((event) => event.data.type === 'pre_prayer').length,
    0,
  );
  f.engine.tick(time('12:00:00', '2026-11-06'));
  assert.equal(
    f.of('onNotification').filter((event) => event.data.type === 'pre_prayer').length,
    1,
  );
});

test('the main adhan callback waits for audio restoration before playback and refreshes the UI', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  let callbacks;
  const calls = [];
  const context = {
    SchedulerEngine: class {
      constructor(options) {
        callbacks = options.callbacks;
      }
    },
    storage: { getConfig: () => ({ location: {} }) },
    prayerEngine: { calculateLocalPrayerTimes: () => ({ nextPrayer: {} }) },
    hadithEngine: {},
    youtubeEngine: {},
    quranEngine: {},
    notificationCenter: { closeWhere: () => calls.push('dismiss-warning') },
    showCustomNotificationPopup: (data) => {
      calls.push('popup');
      assert.equal(data.type, 'prayer_time');
    },
    audioManager: { needsRestore: true },
    lockWindow: {},
    closePrayerLockWindow: async () => {
      await Promise.resolve();
      calls.push('restore');
    },
    mainWindow: {
      isDestroyed: () => false,
      webContents: {
        send: (_, data) => {
          calls.push('ui');
          assert(data.prayerData);
        },
      },
    },
    getAppNow: () => new Date(),
    app: { isQuitting: false },
    reportNotificationError: (error) => {
      throw error;
    },
    createPrayerLockWindow() {},
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('const scheduler = new SchedulerEngine('),
      source.indexOf('function createMainWindow()'),
    ),
    context,
  );
  await callbacks.onPrayerTimeReached({ prayer: { id: 'dhuhr', name: 'الظهر' }, hadithState: {} });
  assert.deepEqual(calls, ['dismiss-warning', 'restore', 'popup', 'ui']);
  calls.length = 0;
  await callbacks.onPrayerTimeReached({
    prayer: { id: 'dhuhr', name: 'الظهر' },
    hadithState: {},
    notify: false,
  });
  assert.deepEqual(calls, ['dismiss-warning', 'restore', 'ui']);
});

test('real preparation always ends at adhan regardless of legacy duration settings', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const now = time('12:55:00');
  const delays = [];
  class Window extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setFullScreen() {}
    setKiosk() {}
    setBounds() {}
    loadFile() {
      return Promise.resolve();
    }
  }
  const context = {
    BrowserWindow: Window,
    miniWindow: null,
    lockWindow: null,
    lockReleaseTimer: null,
    lockKeepAliveInterval: null,
    closePrayerLockWindow() {},
    getAppNow: () => now,
    muteSystemAudioIfNeeded() {},
    setWindowsTaskbarVisibility() {},
    screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 100, height: 100 } }) },
    setInterval: () => 1,
    setTimeout: (_, delay) => {
      delays.push(delay);
      return 2;
    },
    clearTimeout() {},
    path,
    appDir: '.',
    themeEngine: { getActiveThemeState: () => ({}) },
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('function createPrayerLockWindow('),
      source.indexOf('const scheduler = new SchedulerEngine('),
    ),
    context,
  );
  const result = context.createPrayerLockWindow({
    lockDurationMinutes: 20,
    prayerTime: time('13:00:00').toISOString(),
  });
  assert.equal(result.durationSeconds, 300);
  assert(delays.includes(300000));
  context.lockWindow = null;
  const short = context.createPrayerLockWindow({
    lockDurationMinutes: 1,
    durationSeconds: 2,
    prayerTime: time('13:00:00').toISOString(),
  });
  assert.equal(short.durationSeconds, 300);
  context.lockWindow = null;
  assert.throws(() => context.createPrayerLockWindow({}), /موعد أذان/);
  const preview = context.createPrayerLockWindow({ isTestMode: true, durationSeconds: 30 });
  assert.equal(preview.durationSeconds, 30);
});

function centerFixture() {
  const timers = new Map();
  let next = 0;
  const actions = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setAudioMuted = () => {};
      this.webContents.send = (_, data) => {
        this.payload = data;
      };
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    loadFile() {
      this.webContents.emit('did-finish-load');
      return Promise.resolve();
    }
  }
  const config = { notifications: { playAdhanAudio: true } };
  const center = new NotificationCenter({
    BrowserWindow: Window,
    appDir: '.',
    getWorkArea: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    getConfig: () => config,
    getTheme: () => ({}),
    setTimer: (fn, ms) => {
      const id = ++next;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    onAction: async (payload, action) => {
      actions.push(action);
      return action === 'snooze'
        ? { lockAt: '2026-11-01T12:53:00', message: 'تم التمديد' }
        : { opened: true };
    },
  });
  return { center, timers, actions, config, entry: (key) => center.entries.get(key) };
}

test('pre-prayer and lock warnings never play adhan, even with a mistaken playAudio flag', () => {
  const f = centerFixture();
  for (const type of ['pre_prayer', 'lock_warning', 'daily_video']) {
    const key = f.center.show({ type, playAudio: true });
    assert.equal(f.entry(key).data.playAudio, false);
  }
  f.center.close();
  assert.equal(f.timers.size, 0);
});

test('persistent reminders have no expiry and unrelated notices do not replace them', () => {
  const f = centerFixture();
  const key = f.center.show({ type: 'pre_prayer', prayerId: 'dhuhr' });
  assert.equal(f.entry(key).expiry, null);
  assert.equal(f.timers.size, 0);
  f.center.show({ type: 'quran_reading' });
  assert(f.center.entries.has(key));
  assert.equal(f.entry(key).win.destroyed, false);
  f.center.show({ type: 'prayer_time', prayerId: 'dhuhr' });
  assert.equal(f.center.entries.has(key), false);
  assert.equal(f.center.entries.size, 2);
  f.center.close();
  assert.equal(f.timers.size, 0);
});

test('manual dismissal closes only the sending notification', () => {
  const f = centerFixture();
  const a = f.center.show({ type: 'pre_prayer' });
  const b = f.center.show({ type: 'daily_video' });
  f.center.closeFromSender(f.entry(b).win.webContents);
  assert(f.center.entries.has(a));
  assert(!f.center.entries.has(b));
  assert.throws(() => f.center.closeFromSender({}), /لم تعد متاحة/);
  f.center.close();
});

test('snooze runs inside the warning and updates the same persistent window', async () => {
  const f = centerFixture();
  const key = f.center.show({
    type: 'lock_warning',
    scheduleId: 'plan',
    lockAt: '2026-11-01T12:50:00',
  });
  const win = f.entry(key).win;
  await f.center.action(win.webContents, 'snooze');
  assert.equal(f.entry(key).win, win);
  assert.equal(win.payload.lockAt, '2026-11-01T12:53:00');
  assert.equal(f.entry(key).expiry, null);
  f.center.close();
});

test('daily reminder invokes the internal route; settings silence the adhan', async () => {
  const f = centerFixture();
  const key = f.center.show({ type: 'daily_video', video: { videoId: 'abcdefghijk' } });
  await f.center.action(f.entry(key).win.webContents, 'open_lessons');
  assert.deepEqual(f.actions, ['open_lessons']);
  assert.equal(f.center.entries.size, 0);
  f.config.notifications.playAdhanAudio = false;
  const adhan = f.center.show({ type: 'prayer_time' });
  assert.equal(f.entry(adhan).data.playAudio, false);
  f.center.close();
});

test('prayer switches suppress only the popup, retaining the adhan-time lifecycle', () => {
  const f = schedulerFixture();
  f.config.notifications.prayerEnabled = false;
  f.engine.tick(time('13:00:00'));
  assert.equal(f.of('onPrayerTimeReached').length, 1);
  assert.equal(f.of('onPrayerTimeReached')[0].data.notify, false);
});
test('Friday prayer switch is independent of the ordinary dhuhr switch', () => {
  const f = schedulerFixture();
  f.config.notifications.prayers = { dhuhr: false, friday: true };
  f.engine.tick(time('13:00:00', '2026-11-05'));
  assert.equal(f.of('onPrayerTimeReached').at(-1).data.notify, false);
  f.engine.tick(time('13:00:00', '2026-11-06'));
  assert.equal(f.of('onPrayerTimeReached').at(-1).data.notify, true);
});
test('per-prayer lead time and disabled reminders override the global lead time', () => {
  const f = schedulerFixture();
  f.config.notifications.prePrayerOverrides = {
    dhuhr: { enabled: true, minutes: 25 },
    asr: { enabled: false, minutes: 30 },
  };
  f.engine.tick(time('12:34:59'));
  assert.equal(f.of('onNotification').length, 0);
  f.engine.tick(time('12:35:00'));
  assert.equal(f.of('onNotification').length, 1);
  f.engine.tick(time('15:30:00'));
  assert.equal(f.of('onNotification').length, 1);
});
test('Friday reminder is separately disabled and always at least 30 minutes early', () => {
  const f = schedulerFixture();
  f.config.notifications.fridayPrePrayerMinutes = 2;
  f.engine.tick(time('12:29:59', '2026-11-06'));
  assert.equal(f.of('onNotification').length, 0);
  f.engine.tick(time('12:30:00', '2026-11-06'));
  assert.equal(f.of('onNotification').length, 1);
  const g = schedulerFixture();
  g.config.notifications.fridayPrePrayerEnabled = false;
  g.engine.tick(time('12:30:00', '2026-11-06'));
  assert.equal(g.of('onNotification').length, 0);
});
test('lock warning uses its configured lead, and snoozing is capped at ten minutes', () => {
  const f = schedulerFixture(true);
  f.config.screenLock.warningMinutes = 5;
  f.engine.tick(time('12:39:59'));
  assert.equal(f.of('onPreLockWarning').length, 0);
  f.engine.tick(time('12:40:00'));
  const id = f.of('onPreLockWarning')[0].data.scheduleId;
  const result = f.engine.snoozeScreenLock(999, id, time('12:40:00'));
  assert.equal(result.minutes, 10);
  assert.equal(new Date(result.lockAt).getMinutes(), 55);
  f.engine.tick(time('12:45:00'));
  assert.equal(f.of('onActivateScreenLock').length, 0);
  f.engine.tick(time('12:55:00'));
  assert.equal(f.of('onActivateScreenLock').length, 1);
});
test('lesson notices honor disabled, fixed and selected-prayer modes including zero offset', async () => {
  const f = schedulerFixture();
  f.config.notifications.lessons = { enabled: false, timingMode: 'fixed', customTime: '12:30' };
  f.engine.tick(time('12:30:00'));
  await Promise.resolve();
  assert.equal(f.of('onNotification').length, 0);
  f.config.notifications.lessons.enabled = true;
  f.engine.tick(time('12:30:10'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.of('onNotification').filter((e) => e.data.type === 'daily_video').length, 1);
  f.config.notifications.lessons = {
    enabled: true,
    timingMode: 'prayer',
    prayer: 'asr',
    minutesAfter: 0,
  };
  f.engine.tick(time('16:00:00'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.of('onNotification').filter((e) => e.data.type === 'daily_video').length, 2);
});
test('Quran notifications use the selected prayer and retain yesterday after midnight', () => {
  const f = schedulerFixture(false, 23),
    Quran = require('./src/engines/quran-engine');
  f.config.quranWird = {
    notificationMode: 'reading_only',
    reading: { timingMode: 'prayer', afterPrayer: 'isha', afterPrayerMinutes: 90 },
    hifz: { timingMode: 'fixed', customTime: '00:30' },
  };
  const q = new Quran({ getConfig: () => f.config }, __dirname);
  f.engine.quranEngine = {
    getFullStatus: (data) => ({
      schedules: q.computeNotificationSchedules(data),
      readingSummary: { currentAssignment: 'ورد' },
      hifzSummary: { currentAssignment: 'مراجعة' },
    }),
  };
  f.engine.tick(time('00:29:59', '2026-11-02'));
  assert.equal(f.of('onNotification').filter((e) => e.data.type === 'quran_reading').length, 0);
  f.engine.tick(time('00:30:00', '2026-11-02'));
  f.engine.tick(time('00:30:10', '2026-11-02'));
  assert.equal(f.of('onNotification').filter((e) => e.data.type === 'quran_reading').length, 1);
  assert.equal(f.of('onNotification').filter((e) => e.data.type === 'quran_hifz').length, 0);
  f.config.quranWird.notificationMode = 'hifz_only';
  f.config.quranWird.hifz = { timingMode: 'prayer', afterPrayer: 'asr', afterPrayerMinutes: 0 };
  f.engine.tick(time('16:00:00', '2026-11-02'));
  assert.equal(f.of('onNotification').filter((e) => e.data.type === 'quran_hifz').length, 1);
});
test('legacy settings migrate safely and new invalid notification settings are rejected', () => {
  const policy = require('./src/engines/notification-settings');
  const config = policy.normalizeConfig({
    notifications: { dailyVideoAfterIshaMinutes: 90 },
    screenLock: { minutesBeforeAdhan: 5, snoozeMinutes: 15 },
  });
  assert.equal(config.screenLock.minutesBeforeAdhan, 15);
  assert.equal(config.screenLock.snoozeMinutes, 10);
  assert.equal(config.notifications.lessons.minutesAfter, 90);
  policy.validateConfig(config);
  for (const [field, value] of [
    ['minutesBeforeAdhan', 14],
    ['warningMinutes', 0],
    ['snoozeMinutes', 11],
  ])
    assert.throws(() =>
      policy.validateConfig({ ...config, screenLock: { ...config.screenLock, [field]: value } }),
    );
  assert.throws(() =>
    policy.validateConfig({
      ...config,
      notifications: { ...config.notifications, fridayPrePrayerMinutes: 29 },
    }),
  );
  assert.equal(
    policy.allowsNotice(
      { ...config, screenLock: { enabled: true } },
      { type: 'pre_prayer', prayerId: 'fajr' },
    ),
    false,
  );
});
