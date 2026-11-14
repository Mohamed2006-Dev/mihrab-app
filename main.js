const NoticePolicy = require('./src/engines/notification-settings');
const {
  app,
  BrowserWindow,
  safeStorage,
  ipcMain,
  shell,
  screen,
  net,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  dialog,
  clipboard,
  powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ============================================================================
// 1. Single-instance lock.
// ============================================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Focus the existing window when another instance starts.
app.on('second-instance', () => {
  if (preparationSession && !preparationSession.preview) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// ============================================================================
// 2. Application identity, writable data paths and graphics compatibility.
// ============================================================================
app.name = 'mihrab-desktop';
if (process.platform === 'win32') app.setAppUserModelId('com.mihrab.desktop');
try {
  if (!app.commandLine.hasSwitch('user-data-dir'))
    app.setPath('userData', path.join(app.getPath('appData'), 'mihrab-desktop'));
} catch (_) {}
if (process.argv.includes('--mihrab-software-rendering')) app.disableHardwareAcceleration();

const StorageEngine = require('./src/engines/storage-engine');
const ThemeEngine = require('./src/engines/theme-engine');
const PrayerEngine = require('./src/engines/prayer-engine');
const HadithEngine = require('./src/engines/hadith-engine');
const { renderHadithImage } = require('./src/engines/hadith-image');
const YouTubeRssEngine = require('./src/engines/youtube-rss-engine');
const QuranWirdEngine = require('./src/engines/quran-wird-engine');
const SchedulerEngine = require('./src/engines/scheduler-engine');
const { AudioManager } = require('./src/engines/audio-manager');
const NotificationCenter = require('./src/engines/notification-center');

const isPackaged = app.isPackaged;
const appDir = __dirname;
// Resolve packaged extraResources or development theme and data directories.
const resourcesDir =
  isPackaged && fs.existsSync(path.join(process.resourcesPath, 'themes'))
    ? process.resourcesPath
    : __dirname;
const writableDir = isPackaged ? app.getPath('userData') : __dirname;

const storage = new StorageEngine(resourcesDir, writableDir);
const themeEngine = new ThemeEngine(resourcesDir, writableDir);
const { ProjectInfoEngine } = require('./src/engines/project-info-engine');
const projectInfoEngine = new ProjectInfoEngine(resourcesDir, writableDir, isPackaged);

// Use Electron's Chromium network stack for provider requests.
const { ResourceEngine, allowed: networkAllowed } = require('./src/engines/resource-engine');
const resources = new ResourceEngine(storage);
const netFetch = (url, options) => resources.fetch((u, o) => net.fetch(u, o), url, options);

const prayerEngine = new PrayerEngine(storage, netFetch);
const hadithEngine = new HadithEngine(storage, resourcesDir, netFetch);
const youtubeEngine = new YouTubeRssEngine(storage, resourcesDir, netFetch, {
  onCacheError: reportNotificationError,
});
const quranEngine = new QuranWirdEngine(storage, resourcesDir);
const PerformanceEngine = require('./src/engines/performance-engine');
const deviceHardware = PerformanceEngine.detectHardware();
let performanceSignals;
const currentPerformance = () => PerformanceEngine.resolve(storage.getConfig(), deviceHardware, performanceSignals);
youtubeEngine.performancePaged = currentPerformance().profile.paged;
youtubeEngine.maxAttempts = currentPerformance().profile.requestAttempts;
function trimFeedForPerformance(feed) {
  const profile = currentPerformance().profile;
  if (!profile.paged) return feed;
  if (!youtubeEngine.refreshTask && !youtubeEngine.pendingWrite) youtubeEngine.videoCache = null;
  if (youtubeEngine.pendingWrite)
    youtubeEngine.pendingWrite.then(() => youtubeEngine.releaseMemory(), reportNotificationError);
  return { ...feed, videos: [], filteredVideos: [], paged: true };
}

let mainWindow = null;
let lockWindow = null;
let lockReleaseTimer = null;
const preparationWindows = new Map();
let preparationSession = null;
let preparationSuspended = false;
const PreparationProgress = require('./src/engines/preparation-progress');
const preparationDirectory = process.platform === 'win32' && process.env.LOCALAPPDATA &&
  !app.commandLine.hasSwitch('user-data-dir')
  ? path.join(process.env.LOCALAPPDATA, 'Mihrab', 'Preparation')
  : app.getPath('userData');
const preparation = new PreparationProgress(path.join(preparationDirectory, 'preparation-progress.json'));
const audioManager = new AudioManager();
let previousAppAudioMuted = null;
let quitAudioPending = false;
let quitAudioRestored = false;

let schedulerTimer = null;

let tray = null;
app.isQuitting = false;

const notificationCenter = new NotificationCenter({
  BrowserWindow,
  appDir,
  getPrayerHadith: () => getRandomPrayerHadith(),
  getWorkArea: () => screen.getPrimaryDisplay().workArea,
  getConfig: () => storage.getConfig(),
  getTheme: () => themeEngine.getActiveThemeState(),
  onError: reportNotificationError,
  onAudioStatus: (status) => {
    if (status.status === 'error') console.error('[NotificationAudio]', status.message);
  },
  onAction: async (data, action) => {
    if (action === 'snooze') {
      if (data.preview) {
        const lockAt = new Date(
          Math.max(new Date(data.lockAt).getTime(), getAppNow().getTime()) +
            data.snoozeMinutes * 60000,
        ).toISOString();
        if (!data.snoozeMinutes) throw new Error('استُخدم التمديد لهذه المعاينة.');
        return { lockAt, snoozeMinutes: 0, message: 'تأجّل موعد الظهور في المعاينة.' };
      }
      return scheduler.snoozeScreenLock(data.snoozeMinutes, data.scheduleId, getAppNow());
    }
    if (preparationSession && !preparationSession.preview)
      throw new Error('يمكن فتح محراب بعد انتهاء شاشة التهيئة.');
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    const target = action === 'open_reminder'
      ? { tabId: data.tabId, lesson: data.lesson, videoId: data.videoId }
      : { tabId: 'tab-youtube', lesson: true, videoId: data.video?.videoId };
    const send = () => mainWindow?.webContents.send('app:navigate', target);
    if (mainWindow.webContents.isLoadingMainFrame()) mainWindow.webContents.once('did-finish-load', send);
    else send();
    return { opened: true };
  },
});

function reportNotificationError(error) {
  console.error('[Notification]', error.message);
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('app:notification-error', { message: error.message });
}

function getAppNow() {
  return new Date();
}

/** Mute system audio while the preparation screen is active. */
function muteSystemAudioIfNeeded(shouldMute) {
  if (!shouldMute) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (previousAppAudioMuted === null)
      previousAppAudioMuted = mainWindow.webContents.isAudioMuted();
    mainWindow.webContents.setAudioMuted(true);
  }
  // The manager serializes capture/mute/restore, including a close during capture.
  audioManager.muteForLock().catch((error) => {
    console.error('[Audio] Could not mute the system:', error.message);
  });
}

function restorePrayerLockAudio() {
  if (previousAppAudioMuted !== null) {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.setAudioMuted(previousAppAudioMuted);
    previousAppAudioMuted = null;
  }
  return audioManager
    .restore()
    .then(() => ({ audioRestored: true }))
    .catch((error) => {
      reportNotificationError(error);
      return { audioRestored: false, error: error.message };
    });
}

let lastNotificationHadithId = null;
function getRandomPrayerHadith() {
  const normalize = (text) =>
    String(text || '')
      .replace(/[\u064b-\u065f\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا');
  const candidates = hadithEngine
    .getDatabase()
    .hadiths.filter(
      (hadith) =>
        hadith.text &&
        hadith.grade &&
        !/ضعيف|موضوع|باطل/.test(hadith.grade) &&
        /صلاة|الصلاة|الصلوات|الوضوء|ساجد|السجود|ركعتا|ركعتين/.test(
          normalize([hadith.topic || '', hadith.text].join(' ')),
        ),
    );
  if (!candidates.length) return null;
  const alternatives = candidates.filter(
    (hadith) => (hadith.id || hadith.fingerprint || hadith.text) !== lastNotificationHadithId,
  );
  const pool = alternatives.length ? alternatives : candidates;
  const hadith = pool[Math.floor(Math.random() * pool.length)];
  lastNotificationHadithId = hadith.id || hadith.fingerprint || hadith.text;
  return {
    id: lastNotificationHadithId,
    text: hadith.text,
    source: hadith.book || hadith.mohdith || '',
    grade: hadith.grade,
  };
}

/** Independent notification lifetimes: transient notices cannot replace a prayer warning. */
function showCustomNotificationPopup(payload) {
  if (app.isQuitting) return null;
  return notificationCenter.show(payload);
}
function closeNotificationPopup() {
  notificationCenter.close();
}

/** Keep background services available through the system tray. */
function createSystemTray() {
  if (tray) return;

  const iconPath = path.join(appDir, 'src', 'ui', 'assets', 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('محراب — مواقيت الصلاة والأوراد اليومية');

  updateTrayContextMenu();

  tray.on('click', () => {
    if (preparationSession && !preparationSession.preview) return;
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function updateTrayContextMenu() {
  if (!tray) return;
  const config = storage.getConfig();
  const isAudioOn = config.notifications?.playAdhanAudio !== false;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🕌 فتح واجهة محراب الرئيسية',
      enabled: !preparationSession || preparationSession.preview,
      click: () => {
        if (preparationSession && !preparationSession.preview) return;
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      id: 'menu-adhan-audio',
      label: isAudioOn ? 'كتم صوت الأذان والتنبيهات 🔇' : 'تفعيل صوت الأذان والتنبيهات 🔊',
      click: () => {
        const updated = !isAudioOn;
        storage.saveConfig({
          notifications: {
            ...(storage.getConfig().notifications || {}),
            playAdhanAudio: updated,
          },
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:config-updated', storage.getConfig());
        }
        updateTrayContextMenu();
      },
    },
    { type: 'separator' },
    {
      label: '❌ إغلاق التطبيق نهائياً',
      enabled: !preparationSession || preparationSession.preview,
      click: () => {
        if (preparationSession && !preparationSession.preview) return;
        app.isQuitting = true;
        clearInterval(miniTimer);
        clearTimeout(miniHideTimer);
        if (miniWindow && !miniWindow.isDestroyed()) miniWindow.destroy();
        if (updateTimer) {
          clearInterval(updateTimer);
          updateTimer = null;
        }
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function samplePreparationActivity(now = Date.now()) {
  if (preparationSuspended) return;
  const idle = powerMonitor.getSystemIdleTime();
  const state = powerMonitor.getSystemIdleState(60);
  const locked = state === 'locked' || state === 'unknown';
  preparation.observe(now, idle, locked);
  const session = preparationSession;
  if (session && !session.preview && session.shownAt && !locked &&
      now < session.endsAt && now - session.shownAt > (idle + 1) * 1000)
    session.active = true;
}

function closePrayerLockWindow() {
  const session = preparationSession;
  preparationSession = null;
  lockWindow = null;
  clearTimeout(lockReleaseTimer);
  lockReleaseTimer = null;
  for (const window of preparationWindows.values()) {
    if (!window.isDestroyed()) window.destroy();
  }
  preparationWindows.clear();
  const audioRestored = restorePrayerLockAudio();
  if (!app.isQuitting) {
    updateTrayContextMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (session?.restoreMain) {
        mainWindow.setSkipTaskbar(false);
        if (session.restoreMain.visible) {
          if (session.restoreMain.minimized) {
            mainWindow.showInactive();
            mainWindow.minimize();
          } else mainWindow.show();
        }
      }
      audioRestored.then(result => {
        if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting)
          mainWindow.webContents.send('lockscreen:closed', result);
      });
    }
  }
  return audioRestored;
}

async function finishPrayerPreparation() {
  const session = preparationSession;
  if (!session || Date.now() < session.endsAt) return;
  let streak = null;
  if (!session.preview && !preparationSuspended && session.shownAt) {
    try {
      streak = preparation.complete(session.prayer, session.active);
    } catch (error) {
      reportNotificationError(error);
    }
  }
  await closePrayerLockWindow();
  if (streak !== null && !app.isQuitting) {
    showCustomNotificationPopup({
      type: 'preparation_streak',
      title: 'أحسنت، أبقيت شاشة التهيئة حتى الأذان',
      body: 'عدد جلساتك المتتالية: ' + new Intl.NumberFormat('ar', { numberingSystem: 'arab' }).format(streak) +
        '. استغل وقت شاشة التهيئة في القيام والاستعداد للصلاة.',
      playAudio: false,
    });
  }
}

function createPreparationDisplay(display, session) {
  const window = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    thickFrame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    webPreferences: {
      devTools: false,
      preload: path.join(appDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  preparationWindows.set(display.id, window);
  window.setAlwaysOnTop(true, 'screen-saver', 1);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on('close', event => event.preventDefault());
  window.on('closed', () => {
    if (preparationWindows.get(display.id) === window) {
      preparationWindows.delete(display.id);
      if (preparationSession === session) closePrayerLockWindow();
    }
  });
  window.on('blur', () => {
    if (preparationSession === session && !window.isDestroyed())
      window.setAlwaysOnTop(true, 'screen-saver', 1);
  });
  window.webContents.on('render-process-gone', () => {
    if (preparationSession === session) closePrayerLockWindow();
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (preparationSession !== session || input.type !== 'keyDown') return;
    if (input.alt && input.shift && !input.control && !input.meta && input.code === 'KeyS') {
      event.preventDefault();
      if (input.isAutoRepeat || Date.now() >= session.endsAt ||
          (!session.preview && !preparation.canBypass(Date.now()))) return;
      session.bypassRevealed = true;
      window.webContents.send('lockscreen:reveal-bypass');
    }
  });
  window.webContents.on('did-finish-load', () => {
    if (preparationSession !== session || window.isDestroyed()) return;
    if (Date.now() >= session.endsAt) {
      finishPrayerPreparation();
      return;
    }
    const initialDisplay = !session.shownAt;
    if (initialDisplay) {
      samplePreparationActivity();
      session.active = preparation.wasWorking(Date.now());
    }
    window.webContents.send('lockscreen:init', {
      ...session.payload,
      endsAt: session.endsAt,
      streak: preparation.streak,
      isTestMode: session.preview,
      themeState: themeEngine.getActiveThemeState(),
    });
    if (initialDisplay) session.shownAt = Date.now();
    if (display.id === screen.getPrimaryDisplay().id) window.show();
    else window.showInactive();
    window.setSkipTaskbar(true);
    window.setBounds(display.bounds);
  });
  window.loadFile(path.join(appDir, 'src', 'ui', 'lockscreen.html')).catch(error => {
    reportNotificationError(error);
    if (preparationSession === session) closePrayerLockWindow();
  });
}

function syncPreparationDisplays() {
  const session = preparationSession;
  if (!session) return;
  const primary = screen.getPrimaryDisplay();
  const displays = session.preview ? [primary] : screen.getAllDisplays();
  const ids = new Set(displays.map(display => display.id));
  for (const [id, window] of preparationWindows) {
    if (!ids.has(id)) {
      preparationWindows.delete(id);
      if (!window.isDestroyed()) window.destroy();
    }
  }
  for (const display of displays) {
    const window = preparationWindows.get(display.id);
    if (window) window.setBounds(display.bounds);
    else createPreparationDisplay(display, session);
  }
  lockWindow = preparationWindows.get(primary.id) || null;
}

function createPrayerLockWindow(payload = {}) {
  const preview = Boolean(payload.isTestMode);
  if (preparationSession && !preparationSession.preview)
    return { started: false, isTestMode: preview };
  const now = Date.now();
  const endsAt = preview ? now + payload.durationSeconds * 1000 : Date.parse(payload.prayerTime);
  const prayer = payload.preparationId;
  if (!preview && (preparationSuspended || !prayer || preparation.prayer(prayer)?.ended || !(endsAt > now)))
    return { started: false, isTestMode: preview };
  if (preparationSession) closePrayerLockWindow();
  const session = { preview, prayer, endsAt, payload, active: false };
  preparationSession = session;
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  if (!preview && mainWindow && !mainWindow.isDestroyed()) {
    session.restoreMain = { visible: mainWindow.isVisible(), minimized: mainWindow.isMinimized() };
    mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
  }
  updateTrayContextMenu();
  muteSystemAudioIfNeeded(payload.muteSystemAudio);
  syncPreparationDisplays();
  lockReleaseTimer = setTimeout(finishPrayerPreparation, endsAt - now);
  return { started: true, durationSeconds: Math.ceil((endsAt - now) / 1000), isTestMode: preview };
}


const scheduler = new SchedulerEngine({
  preparation,
  storage,
  prayerEngine,
  hadithEngine,
  quranEngine,
  youtubeEngine,
  callbacks: {
    onAutomationError: (error) => {
      console.warn('[Prayer verification]',error.message);
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('app:automation-status',{error:true,message:'تعذر التحقق التلقائي من المواقيت: '+error.message});
    },
    onOfficialSyncCompleted: () => {
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('app:automation-status',{message:'تم تحديث مواقيت اليوم وحفظها لمنطقتك.'});
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(
          'app:prayer-schedule',
          prayerEngine.calculateLocalPrayerTimes(getAppNow()),
        );
    },
    onCustomReminder: (payload) => {
      showCustomNotificationPopup({
        ...payload,
        id: 'custom:' + payload.id,
        type: 'custom_reminder',
        video: payload.lesson ? { videoId: payload.videoId } : undefined,
      });
    },
    onNotification: (payload) => {
      showCustomNotificationPopup(payload);
    },
    onPrayerScheduleChanged: (prayerData) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('app:prayer-schedule', prayerData);
    },
    onModeChanged: ({ lockEnabled }) => {
      notificationCenter.closeWhere(
        (data) => data.type === (lockEnabled ? 'pre_prayer' : 'lock_warning'),
      );
      if (!lockEnabled && preparationSession && !preparationSession.preview) closePrayerLockWindow();
    },
    onPreLockWarning: (warning) => {
      showCustomNotificationPopup({
        ...warning,
        type: 'lock_warning',
        persistent: true,
        playAudio: false,
        title: `التهيؤ لـ${warning.prayerName}: قفل الشاشة قريباً`,
        body: warning.snoozeMinutes
          ? 'احفظ عملك الآن. يمكنك تأجيل ظهور الشاشة مرة واحدة من هذا التنبيه.'
          : 'احفظ عملك الآن استعدادًا لظهور شاشة التهيئة.',
      });
    },
    onActivateScreenLock: (payload) => {
      notificationCenter.closeWhere(
        (data) => data.type === 'lock_warning' && data.scheduleId === payload.scheduleId,
      );
      createPrayerLockWindow({ ...payload, isTestMode: false });
    },
    onPrayerTimeReached: async ({ prayer, hadithState, notify = true }) => {
      // Release any lock and restore the previous system mute state before adhan playback.
      notificationCenter.closeWhere(
        (data) =>
          ['pre_prayer', 'lock_warning'].includes(data.type) &&
          (!data.prayerId || data.prayerId === prayer.id),
      );
      if (preparationSession?.endsAt <= Date.now()) await finishPrayerPreparation();
      else if (!preparationSession && audioManager.needsRestore) await restorePrayerLockAudio();
      if (app.isQuitting) return;
      const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
      if (notify)
        showCustomNotificationPopup({
          type: 'prayer_time',
          prayerId: prayer.id,
          prayerName: prayer.name,
          title: `حان الآن موعد أذان ${prayer.name}`,
          body: `الله أكبر — حان موعد ${prayer.name} عند ${prayer.time12 || prayer.time24} بتوقيت ${storage.getConfig().location?.city || 'مدينتك'}.`,
          playAudio: true,
        });
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('app:prayer-reached', { prayer, hadithState, prayerData });
    },
    onError: reportNotificationError,
  },
});

function createMainWindow() {
  const appIconPath = path.join(appDir, 'src', 'ui', 'assets', 'app-icon.png');
  mainWindow = new BrowserWindow({
    show: false,
    width: 1360,
    height: 880,
    minWidth: 1060,
    minHeight: 720,
    title: 'محراب — مواقيت الصلاة والأوراد اليومية',
    icon: fs.existsSync(appIconPath) ? appIconPath : undefined,
    backgroundColor: '#071310',
    autoHideMenuBar: true,
    webPreferences: {
      devTools: false,
      preload: path.join(appDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor:
        require('./src/engines/accessibility-engine').normalize(storage.getConfig().accessibility)
          .zoom / 100,
    },
  });

  mainWindow.once('ready-to-show',()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.show();});

  // Interface zoom shortcuts.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.alt && input.type === 'keyDown') {
      const key = input.key || '',
        code = input.code || '';
      const step =
        ['+', '='].includes(key) || code === 'NumpadAdd'
          ? 10
          : key === '-' || code === 'NumpadSubtract'
            ? -10
            : key === '0' || code === 'Digit0' || code === 'Numpad0'
              ? 0
              : null;
      if (step !== null) {
        event.preventDefault();
        mainWindow.webContents.send('accessibility:shortcut', step);
        return;
      }
    }
  });

  // Hide the main window on close while retaining background services.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));
}

// ============================================================================
// IPC handlers.
// ============================================================================

// ============================================================================

const interfaceLanguages = new Set(['ar', 'en', 'id', 'ur', 'bn', 'fr', 'tr']);
const interfaceLanguageFile = () => path.join(app.getPath('userData'), 'interface-language');
function readInterfaceLanguage() {
  try {
    const code = fs.readFileSync(interfaceLanguageFile(), 'utf8').trim();
    return interfaceLanguages.has(code) ? code : 'ar';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return 'ar';
  }
}
ipcMain.handle('interface-language:get', readInterfaceLanguage);
function writeInterfaceLanguage(code) {
  const file = interfaceLanguageFile();
  fs.writeFileSync(file + '.tmp', code, 'utf8');
  fs.renameSync(file + '.tmp', file);
}
function sharedSettings() {
  const {activeTheme:theme,activeMode:mode}=themeEngine.getActiveThemeState();
  return {language:readInterfaceLanguage(),theme,mode};
}
ipcMain.handle('interface-language:set', (event, code) => {
  if (event.sender !== mainWindow?.webContents || !interfaceLanguages.has(code)) {
    throw new Error('Invalid interface language request');
  }
  storage.saveConfig({sharedSettings:{...sharedSettings(),language:code}},false,sharedSettings());
  writeInterfaceLanguage(code);
});
ipcMain.handle('interface-language:catalog', (_, code) => {
  if (!interfaceLanguages.has(code)) throw new Error('Invalid interface language');
  return JSON.parse(fs.readFileSync(path.join(appDir, 'src', 'ui', 'locales', code + '.json'), 'utf8'));
});

ipcMain.handle('app:get-bootstrap-data', async () => {
  const config = storage.getConfig();
  const now = getAppNow();
  const prayerData = prayerEngine.calculateLocalPrayerTimes(now);
  const currentPrayerKey = `${prayerData.nextPrayer?.id || 'fajr'}_${now.toISOString().slice(0, 10)}`;
  const hadithState = hadithEngine.getHadithForPrayer(currentPrayerKey, false);
  const quranState = quranEngine.getFullStatus(prayerData);
  const youtubeState = trimFeedForPerformance(youtubeEngine.getFeedState('all'));
  const countries = prayerEngine.getCountries();
  const currentLocation = prayerEngine.getLocation();
  const cities = currentLocation.countryCode
    ? prayerEngine.getCities(currentLocation.countryCode)
    : [];
  const themeState = themeEngine.getActiveThemeState();

  return {
    config: { ...storage.getConfig(), location: prayerEngine.getLocation() },
    countries,
    themeState,
    performanceProfile: currentPerformance(),
    prayerData,
    hadithState,
    quranState,
    youtubeState,
    cities,
    effectiveNowIso: now.toISOString(),
  };
});

// 1. Themes.
ipcMain.handle('accessibility:set', (_, value) => {
  const preferences = require('./src/engines/accessibility-engine').normalize(value);
  storage.saveConfig({ accessibility: preferences });
  return preferences;
});
function updateAuxiliaryWindowThemes(themeState) {
  if (!themeState) return;
  for (const window of preparationWindows.values()) {
    if (!window.isDestroyed()) window.webContents.send('lockscreen:theme-updated', themeState);
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('theme:live-reloaded', themeState);
  }
}

ipcMain.handle('theme:get-state', () => themeEngine.getActiveThemeState());
ipcMain.handle('theme:set', (_, { themeId, mode }) => {
  const before=sharedSettings();
  const next={...before,theme:themeId||before.theme,mode:mode||before.mode};
  require('./src/engines/local-sync-contract').sanitize('settings',next);
  storage.saveConfig({sharedSettings:next},false,before);
  const newState = themeEngine.setTheme(themeId, mode);
  updateAuxiliaryWindowThemes(newState);
  return newState;
});

// 2. Location, prayer calculations and verification.
ipcMain.handle('prayer:get-cities', (_, { countryCode }) => prayerEngine.getCities(countryCode));

ipcMain.handle('prayer:detect-location', async () => {
  const res = await prayerEngine.detectLocationOnline({ throwOnError: false, dryRun: true });
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  return { ...res, prayerData, config: storage.getConfig() };
});

ipcMain.handle('prayer:verify-official', async () => {
  const report = await prayerEngine.verifyWithOfficialAwqafApi({
    throwOnError: false,
    date: getAppNow(),
  });
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  return { report, prayerData, config: storage.getConfig() };
});

ipcMain.handle('prayer:get-times', () => {
  return prayerEngine.calculateLocalPrayerTimes(getAppNow());
});

// 3. HadeethEnc content and local hadith library.
ipcMain.handle('hadith:next', () => {
  return hadithEngine.getHadithForPrayer(`manual_${Date.now()}`, true);
});

ipcMain.handle('hadith:library', (_, options) => hadithEngine.getHadithLibrary(options));
ipcMain.handle('hadith:select', (_, { key }) => hadithEngine.selectStoredHadith(key));
ipcMain.handle('hadith:open-source', async (_, { key }) => {
  const url = hadithEngine.getHadithSourceUrl(key);
  resources.ensure(require('./src/engines/resource-engine').categoryFor(url));
  await shell.openExternal(url);
  return { opened: true };
});
ipcMain.handle('hadith:copy', (_, { key }) => {
  clipboard.writeText(hadithEngine.formatHadithMarkdown(key, false));
  return { copied: true };
});
ipcMain.handle('hadith:details', (_, { key, force }) =>
  hadithEngine.enrichStoredHadith(key, { force: force === true }),
);
ipcMain.handle('hadith:export-image', async (_, { key }) => {
  const hadith = hadithEngine.getExportHadith(key);
  const safeName = String(key || 'hadith')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32);
  const choice = await dialog.showSaveDialog(mainWindow, {
    title: 'تحميل صورة الحديث',
    defaultPath: 'hadith-' + safeName + '.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (choice.canceled || !choice.filePath) return { canceled: true };
  const png = await getHadithPreview(key);
  await fs.promises.writeFile(choice.filePath, png);
  return { saved: true, fileName: path.basename(choice.filePath) };
});

ipcMain.handle('hadith:sync-hadeethenc', async (_, { topic }) => {
  const syncResult = await hadithEngine.syncFromHadeethEncApi(topic);
  const hadithState = hadithEngine.buildState(hadithEngine.getDatabase());
  return { syncResult, hadithState };
});

// 4. YouTube channels and RSS feeds.
ipcMain.handle('performance:signals', (event, signals) => {
  if (event.sender !== mainWindow?.webContents) return currentPerformance();
  performanceSignals = {
    ...signals,
    onBattery: powerMonitor.isOnBatteryPower(),
  };
  const result = currentPerformance();
  youtubeEngine.maxAttempts = result.profile.requestAttempts;
  youtubeEngine.performancePaged = result.profile.paged;
  return result;
});
ipcMain.handle('performance:set', (_, level) => {
  if (!['auto', 'full', 'balanced', 'eco'].includes(level)) throw Error('مستوى الأداء غير صالح.');
  storage.saveConfig({ performance: { level } });
  const result = currentPerformance();
  youtubeEngine.maxAttempts = result.profile.requestAttempts;
  youtubeEngine.performancePaged = result.profile.paged;
  return result;
});
const pageWorkers = new Map();
ipcMain.handle('youtube:get-page', async (event, options = {}) => {
  const profile = currentPerformance().profile;
  const previous = pageWorkers.get(event.sender.id);
  if (previous) {
    previous.reject(Error('استُبدل طلب الصفحة بطلب أحدث.'));
    await previous.worker.terminate();
  }
  const limit = profile.paged ? profile.batchSize : 8,
    offset = Number.isFinite(Number(options.offset))
      ? Math.max(0, Math.floor(Number(options.offset) / limit) * limit)
      : 0;
  return new Promise((resolve, reject) => {
    const worker = new (require('worker_threads').Worker)(
      path.join(appDir, 'src', 'engines', 'youtube-page-worker.js'),
      {
        workerData: {
          baseDir: resourcesDir,
          dataDir: storage.dataDir,
          config: storage.getConfig(),
          offset,
          limit,
          channelIds: Array.isArray(options.channelIds) ? options.channelIds : [],
          contextIds: Array.isArray(options.contextIds) ? options.contextIds : [],
          recommendedVideoId: options.recommendedVideoId,
        },
      },
    );
    const key = event.sender.id;
    pageWorkers.set(key, { worker, reject });
    let replied = false;
    const timer = setTimeout(() => {
      reject(Error('انتهت مهلة قراءة الدروس المحفوظة.'));
      worker.terminate();
    }, 15000);
    worker.once('message', (message) => {
      replied = true;
      if (message.error) reject(Error(message.error));
      else resolve(message);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (pageWorkers.get(key)?.worker === worker) pageWorkers.delete(key);
      if (!replied) reject(Error('تعذر قراءة دفعة الدروس.'));
    });
  });
});

ipcMain.handle('youtube:add-channel', async (_, payload) => {
  const res = await youtubeEngine.addChannel(payload);
  const feeds = trimFeedForPerformance(youtubeEngine.getFeedState('all'));
  return { ...res, feeds };
});

ipcMain.handle('youtube:remove-channel', async (_, { channelId }) => {
  const res = youtubeEngine.removeChannel(channelId);
  const feeds = trimFeedForPerformance(youtubeEngine.getFeedState('all'));
  return { ...res, feeds };
});

ipcMain.handle('youtube:get-state', () =>
  trimFeedForPerformance(youtubeEngine.getFeedState('all')),
);

ipcMain.handle('youtube:refresh-feeds', async (_, { contextId }) => {
  const p = currentPerformance().profile;
  youtubeEngine.maxAttempts = p.requestAttempts;
  return trimFeedForPerformance(await youtubeEngine.refreshFeeds(contextId || 'all'));
});

ipcMain.handle('youtube:lesson-by-id', (_, id) => youtubeEngine.getLessonById(id));
ipcMain.handle('youtube:lesson-another', (_, excluded) => youtubeEngine.getAnotherLesson(excluded));
let lessonSnoozeTimer;
ipcMain.handle('youtube:lesson-snooze', (_, id) => {
  if (!youtubeEngine.getLessonById(id)) throw new Error('هذا الدرس غير متاح.');
  if (storage.getConfig().notifications?.lessons?.enabled === false)
    throw new Error('تنبيهات الدروس متوقفة.');
  clearTimeout(lessonSnoozeTimer);
  lessonSnoozeTimer = setTimeout(() => {
    const video = youtubeEngine.getLessonById(id);
    if (video && storage.getConfig().notifications?.lessons?.enabled !== false) {
      Promise.resolve(showCustomNotificationPopup({
        type: 'daily_video', title: 'تذكير بالدرس', body: video.title,
        video, action: 'open_lessons', playAudio: false,
      })).catch(reportNotificationError);
    }
  }, 5 * 60 * 1000);
  return { scheduled: true };
});

ipcMain.handle('youtube:open-external', async (_, { url }) => {
  resources.ensure(require('./src/engines/resource-engine').categoryFor(url));
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return { opened: true };
  }
  return { opened: false };
});

// 5. Quran portions.
// Contact data stays local; banking information is requested only by its dialog.
// User-confirmed browser drafts; no report is submitted by the application.
function feedbackContext(payload) {
  if (payload?.includeContext !== true) return undefined;
  return {
    AppVersion: app.getVersion(),
    Platform: process.platform === 'win32' ? 'Windows' : process.platform,
    OS: require('node:os').release(),
    Language: /^[a-z]{2}$/.test(payload.language) ? payload.language : '',
    Recitation: storage.getConfig().quranWird?.riwaya || 'hafs',
  };
}
ipcMain.handle('report:preview', (_, payload) => {
  const { buildReport } = require('./src/engines/bug-report-engine');
  const context = feedbackContext(payload);
  return { ...buildReport(payload, undefined, context), context };
});
ipcMain.handle('report:open-draft', async (_, payload) => {
  const { buildReport } = require('./src/engines/bug-report-engine');
  const issues = payload?.channel === 'github' ? projectInfoEngine.readSource()?.['git-issues'] : undefined;
  await shell.openExternal(buildReport(payload, issues, feedbackContext(payload)).url);
  return { opened: true };
});
let updateEngine = null,
  updateTimer = null;
function getUpdateEngine() {
  if (!updateEngine) {
    const { UpdateEngine } = require('./src/engines/update-engine');
    updateEngine = new UpdateEngine({
      updater: require('electron-updater').autoUpdater,
      storage,
      supported:
        app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE,
      version: app.getVersion(),
      allowed: () => networkAllowed(storage.getConfig(), 'other'),
      busy: () =>
        Boolean(lockWindow && !lockWindow.isDestroyed()) ||
        [...notificationCenter.entries.values()].some((e) => e.data?.type === 'prayer_time'),
      emit: (data) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('updates:status', data);
      },
    });
  }
  return updateEngine;
}
ipcMain.handle('updates:status', () => getUpdateEngine().status());
ipcMain.handle('updates:check', () => getUpdateEngine().check());
ipcMain.handle('updates:download', () => getUpdateEngine().download());
ipcMain.handle('updates:install', () => getUpdateEngine().install());
ipcMain.handle('project:get-info', () => projectInfoEngine.publicInfo());
ipcMain.handle('project:get-bank-support', () => projectInfoEngine.bankInfo());
ipcMain.handle('project:copy-bank-field', (_, key) => {
  clipboard.writeText(projectInfoEngine.bankField(key));
  return { success: true };
});
ipcMain.handle('project:open-contact', async (_, kind) => {
  const url = projectInfoEngine.contactUrl(kind);
  if (!url.startsWith('mailto:')) resources.ensure('other');
  await shell.openExternal(url);
  return { success: true };
});
ipcMain.handle('quran:toggle-notification', (_, kind) => {
  if (!['reading', 'hifz'].includes(kind)) throw Error('نوع ورد غير صالح.');
  const current = storage.getConfig().quranWird?.notificationMode || 'both';
  let reading = ['both', 'reading_only'].includes(current),
    hifz = ['both', 'hifz_only'].includes(current);
  if (kind === 'reading') reading = !reading;
  else hifz = !hifz;
  const notificationMode = reading ? (hifz ? 'both' : 'reading_only') : hifz ? 'hifz_only' : 'none';
  const config = storage.saveConfig({ quranWird: { notificationMode } });
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  notificationCenter.closeWhere(
    (data) => !NoticePolicy.allowsNotice(config, data, prayerData.isFriday),
  );
  return { config, quranState: quranEngine.getFullStatus(prayerData) };
});

ipcMain.handle('quran:advance-progress', (_, { type, expected }) => {
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  quranEngine.advanceWirdProgress(type, expected);
  return quranEngine.getFullStatus(prayerData);
});

ipcMain.handle('quran:roll-random', () => {
  quranEngine.rollRandomReadingWird();
  return quranEngine.getFullStatus(prayerEngine.calculateLocalPrayerTimes(getAppNow()));
});

ipcMain.handle('quran:bookmark', (_, { kind, mark, migrate }) => {
  quranEngine.saveBookmark(kind, mark, migrate);
  return quranEngine.getFullStatus(prayerEngine.calculateLocalPrayerTimes(getAppNow()));
});

ipcMain.handle('quran:set-position', (_, { kind, start }) => {
  const message = quranEngine.setPosition(kind, start);
  return { message, quranState: quranEngine.getFullStatus(prayerEngine.calculateLocalPrayerTimes(getAppNow())) };
});

ipcMain.handle('quran:get-status', () => {
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  return quranEngine.getFullStatus(prayerData);
});

// 6. Settings and prayer preparation screen.
const LocalSync = require('./src/engines/local-sync-desktop');
const localSync = new LocalSync({
  directory: writableDir, safeStorage,
  onLinkChanged: status => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:sync-link-changed', status);
  },
  getConfig: () => ({...storage.getConfig(),sharedSettings:sharedSettings()}),
  resolveLocation: ({ country, city }) => {
    const geography = prayerEngine.geography;
    const entry = geography.country(country);
    if (!entry) return null;
    const candidates = geography.cities(entry.code).filter((row) => row.city === city);
    const match = candidates.length === 1 ? candidates[0] : null;
    if (!match) return null;
    const previous = storage.getConfig().location;
    const manual = previous?.calculationMethodSelection === 'manual';
    return {
      city: match.city, country: entry.name, countryCode: entry.code,
      lat: match.lat, lng: match.lng, timeZone: match.timeZone,
      calculationMethod: manual ? previous.calculationMethod : entry.method,
      calculationMethodSelection: manual ? 'manual' : 'auto',
      source: 'manual', autoUpdate: false, autoDetect: false,
    };
  },
  applyPatch: async patch => {
    if(patch.sharedSettings){
      const {language,theme,mode}=patch.sharedSettings;
      writeInterfaceLanguage(language);
      const nextTheme=themeEngine.setTheme(theme,mode);
      if(nextTheme.activeTheme!==theme||nextTheme.activeMode!==mode)throw Error('theme_save_failed');
      updateAuxiliaryWindowThemes(nextTheme);
      mainWindow?.webContents.send('theme:live-reloaded',nextTheme);
    }
    const result = await saveApplicationSettings(patch, true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:sync-applied', {
        config: result.config,
        interfaceLanguage: patch.sharedSettings?.language,
        prayerData: patch.location ? result.prayerData : undefined,
        quranState: patch.quranWird || patch.location ? result.quranState : undefined,
        youtubeState: patch.youtube ? youtubeEngine.getFeedState() : undefined,
      });
    }
  },
});
function syncHandler(method) {
  return (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
      throw Error('نافذة الربط غير مصرح بها.');
    return localSync[method](...args);
  };
}
ipcMain.handle('sync:status', syncHandler('status'));
ipcMain.handle('sync:offer', syncHandler('offer'));
ipcMain.handle('sync:approve', syncHandler('approve'));
ipcMain.handle('sync:unlink', syncHandler('unlink'));

async function saveApplicationSettings(newConfig, fromSync = false) {
  if (preparationSession && !preparationSession.preview && newConfig.screenLock?.enabled === false)
    throw new Error('يمكن إيقاف شاشة التهيئة من الإعدادات بعد انتهاء الجلسة.');
  if (newConfig.location && localSync.ownsLocation() && !fromSync)
    throw Error('الموقع يُدار من الهاتف المرتبط. افصل الربط لتعديله هنا.');
  const previous = storage.getConfig();
  let patch = newConfig;
  if (newConfig.location) {
    const location = prayerEngine.geography.normalizeLocation({
      ...previous.location,
      ...newConfig.location,
    });
    if (!String(location.city || '').trim()) throw new Error('يرجى إدخال اسم المدينة.');
    const changed = ['lat', 'lng', 'timeZone', 'calculationMethod'].some(
      (key) => location[key] !== prayerEngine.getLocation()[key],
    );
    patch = { ...newConfig, location };
    if (changed) {
      prayerEngine.rememberLocationSettings(
        { ...previous, location: prayerEngine.getLocation() },
        getAppNow(),
      );
      const restored = prayerEngine.restoreLocationSettings(location, getAppNow());
      patch.prayerAdjustments = newConfig.prayerAdjustments || {
        fajr: 0,
        sunrise: 0,
        dhuhr: 0,
        asr: 0,
        maghrib: 0,
        isha: 0,
      };
      patch.officialSync = {
        ...(newConfig.officialSync || {}),
        lastSyncTime: null,
        lastDiscrepancyReport: null,
        lastSuccessfulReport: null,
      };
      if (restored) {
        if (!newConfig.prayerAdjustments) patch.prayerAdjustments = restored.prayerAdjustments;
        patch.officialSync = restored.officialSync;
      }
      notificationCenter.closeWhere((data) => ['pre_prayer', 'lock_warning'].includes(data.type));
    }
  }
  if (newConfig.quranWird) {
    const merged = storage.deepMerge(previous.quranWird || {}, newConfig.quranWird);
    patch = {
      ...patch,
      quranWird: quranEngine.validateSettings(fromSync ? merged :
        quranEngine.convertSettings(previous.quranWird || {}, merged)),
    };
  }
  if (
    newConfig.performance &&
    !['auto', 'eco', 'balanced', 'full'].includes(newConfig.performance.level)
  )
    throw Error('مستوى الأداء غير صالح.');
  if (newConfig.updates && (getUpdateEngine().downloading || getUpdateEngine().ready))
    throw Error('لا يمكن تغيير خيارات التحديث أثناء التنزيل أو بعد تجهيز حزمة للتثبيت.');
  if (patch.notifications?.customReminders !== undefined)
    require('./src/engines/custom-reminders').validate(patch.notifications.customReminders);
  const saved = storage.saveConfig(patch, fromSync);
  if (newConfig.updates) getUpdateEngine().configure();
  if (newConfig.performance) {
    const p = currentPerformance().profile;
    youtubeEngine.performancePaged = p.paged;
    youtubeEngine.maxAttempts = p.requestAttempts;
    youtubeEngine.releaseMemory();
  }
  if (newConfig.network) {
    if (updateEngine && !networkAllowed(saved, 'other')) updateEngine.cancelNetwork();
    await resources.applyPolicy();
    for (const window of BrowserWindow.getAllWindows()) window.webContents.stop();
    if (!networkAllowed(saved, 'youtube') && mainWindow && !mainWindow.isDestroyed())
      await mainWindow.webContents.executeJavaScript(
        "document.querySelectorAll('iframe[src*=youtube]').forEach(e=>e.remove())",
      );
  }
  if (newConfig.location) queueCityVerification();
  notificationCenter.closeWhere(
    (data) =>
      !NoticePolicy.allowsNotice(
        saved,
        data,
        prayerEngine.calculateLocalPrayerTimes(getAppNow()).isFriday,
      ) ||
      (data.type === 'lock_warning' &&
        JSON.stringify(previous.screenLock) !== JSON.stringify(saved.screenLock)) ||
      (data.type === 'pre_prayer' &&
        JSON.stringify(previous.notifications) !== JSON.stringify(saved.notifications)),
  );
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  const quranState = quranEngine.getFullStatus(prayerData);
  return {
    config: saved,
    prayerData,
    quranState,
    performanceProfile: newConfig.performance ? currentPerformance() : undefined,
  };
}
ipcMain.handle('settings:save', (_, newConfig) => saveApplicationSettings(newConfig));
ipcMain.handle('reminders:save', (_, rows) => {
  const reminders = require('./src/engines/custom-reminders');
  reminders.validate(rows);
  const unique = reminders.unique(rows);
  const saved = storage.saveConfig({ notifications: { customReminders: unique } });
  return saved.notifications.customReminders;
});

function queueCityVerification() {
  return scheduler.triggerAutomaticOfficialSync(getAppNow());
}
let locationUpdateTask=null,lastLocationUpdate=0;
function updateLocationAutomatically(){
  if (localSync.ownsLocation()) return;
  const cfg=storage.getConfig();
  if(!cfg.location?.autoUpdate||!networkAllowed(cfg,'location')||locationUpdateTask||Date.now()-lastLocationUpdate<1800000)return;
  lastLocationUpdate=Date.now();
  locationUpdateTask=prayerEngine.detectLocationOnline({dryRun:true,throwOnError:true}).then(result=>{
    if(!result.success||!storage.getConfig().location?.autoUpdate)return;
    const current=storage.getConfig().location;
    return saveApplicationSettings({location:{...result.location,autoUpdate:true,...(current.calculationMethodSelection==='manual'?{calculationMethod:current.calculationMethod,calculationMethodSelection:'manual'}:{})}});
  }).catch(reportNotificationError).finally(()=>{locationUpdateTask=null});
}
ipcMain.handle('resources:stats', async () =>
  resources.stats(
    app.isPackaged ? require('path').dirname(app.getPath('exe')) : appDir,
    app.getPath('userData'),
    app.getAppMetrics().reduce((sum, item) => sum + (item.memory?.workingSetSize || 0) * 1024, 0),
  ),
);
ipcMain.handle('resources:clear-cache', async () => {
  await resources.clearCache();
  return { success: true };
});
ipcMain.handle('resources:delete-data', async (_, kind) => {
  if (kind === 'youtube') {
    if (youtubeEngine.refreshTask) await youtubeEngine.refreshTask;
    await youtubeEngine.flushCache();
    youtubeEngine.videoCache = null;
    youtubeEngine.cacheRevision = 0;
    youtubeEngine.persistedRevision = 0;
  }
  await resources.deleteData(kind);
  if (kind === 'hadith') hadithEngine.initializeLocalDatabase();
  return {
    success: true,
    hadithState: kind === 'hadith' ? hadithEngine.getHadithForPrayer('after-local-reset') : null,
    feeds: kind === 'youtube' ? youtubeEngine.getFeedState('all') : null,
  };
});

ipcMain.handle('lockscreen:snooze', (_, { minutes, scheduleId }) => {
  return scheduler.snoozeScreenLock(minutes, scheduleId, getAppNow());
});

ipcMain.handle('lockscreen:preview-warning', () => {
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  scheduler.triggerPreLockWarning(prayerData.nextPrayer);
  return { triggered: true };
});

ipcMain.handle('lockscreen:preview-lock', (event, { durationSeconds }) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
    throw new Error('المعاينة متاحة من نافذة الإعدادات.');
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  const hadithState = hadithEngine.getHadithForPrayer(`preview_${Date.now()}`, true);
  return createPrayerLockWindow({
    prayerName: prayerData.nextPrayer?.name || 'صلاة الجماعة',
    prayerTime12: prayerData.nextPrayer?.time12 || '',
    hadith: hadithState.hadith,
    motivationalQuote: scheduler.getRandomMotivationalQuote(),
    durationSeconds: Math.max(1, Math.min(60, Number(durationSeconds) || 30)),
    isTestMode: true,
    muteSystemAudio: Boolean(storage.getConfig().screenLock?.muteSystemAudio),
  });
});

function isPreparationSender(event) {
  return [...preparationWindows.values()].some(window =>
    !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === event.sender.mainFrame);
}

ipcMain.handle('lockscreen:force-close', async (event) => {
  if (!preparationSession?.preview || !preparationSession.bypassRevealed || !isPreparationSender(event))
    throw new Error('إغلاق المعاينة متاح من شاشة المعاينة فقط.');
  const result = await closePrayerLockWindow();
  return { closed: true, ...result };
});

ipcMain.handle('lockscreen:bypass', async (event) => {
  const session = preparationSession;
  const now = Date.now();
  if (!session || session.preview || !session.bypassRevealed || !isPreparationSender(event) ||
      now >= session.endsAt || !preparation.bypass(session.prayer, now))
    throw new Error('التجاوز غير متاح لهذه الجلسة.');
  return closePrayerLockWindow();
});

ipcMain.on('notification-popup:audio-status', (event, data) =>
  notificationCenter.reportAudio(event.sender, data),
);
ipcMain.handle('notification-popup:action', (event, { action }) =>
  notificationCenter.action(event.sender, action),
);

ipcMain.handle('notification-popup:close', (event) => {
  notificationCenter.closeFromSender(event.sender);
  return { closed: true };
});

let miniWindow = null,
  miniTimer = null,
  miniExpanded = false,
  miniHideTimer = null;
function miniMotion() {
  const c = storage.getConfig();
  return c.accessibility?.reduceMotion || currentPerformance().profile.id === 'eco'
    ? 0
    : currentPerformance().profile.id === 'balanced'
      ? 120
      : 240;
}
function miniPayload() {
  return {
    prayerData: prayerEngine.calculateLocalPrayerTimes(getAppNow()),
    countries: prayerEngine.getCountries(),
    locationSelection: storage.getConfig().location?.calculationMethodSelection,
    themeState: themeEngine.getActiveThemeState(),
    motion: miniMotion(),
  };
}
function positionMini() {
  if (!miniWindow || miniWindow.isDestroyed() || !miniWindow.isVisible()) return;
  const area = screen.getPrimaryDisplay().workArea,
    occupied = [...notificationCenter.entries.values()]
      .filter((e) => e.ready && !e.win.isDestroyed())
      .reduce((sum, e) => sum + e.height + 12, 0),
    height = Math.min(miniExpanded ? 620 : 310, area.height - 32),
    width = Math.min(420, area.width - 32);
  const y = area.y + area.height - 16 - occupied - height;
  if (y < area.y + 12) {
    miniWindow.hide();
    return;
  }
  miniWindow.setBounds({
    x: Math.round(area.x + area.width - width - 16),
    y: Math.round(y),
    width,
    height,
  });
}
function hideMini() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  clearTimeout(miniHideTimer);
  if (!miniMotion()) {
    miniWindow.hide();
    return;
  }
  miniWindow.webContents
    .executeJavaScript(
      `document.body.animate([{opacity:1},{opacity:0,transform:'translateY(8px)'}],{duration:${miniMotion()}}).finished`,
    )
    .catch(() => {});
  miniHideTimer = setTimeout(() => {
    miniWindow?.hide();
  }, miniMotion());
}
async function toggleMini() {
  if (lockWindow && !lockWindow.isDestroyed()) return;
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
    hideMini();
    return;
  }
  clearTimeout(miniHideTimer);
  if (!miniWindow || miniWindow.isDestroyed()) {
    miniWindow = new BrowserWindow({
      width: 420,
      height: 310,
      show: false,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      backgroundColor: '#0c2019',
      webPreferences: {
        devTools: false,
        preload: path.join(appDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    miniWindow.on('closed', () => {
      miniWindow = null;
      clearInterval(miniTimer);
      miniTimer = null;
    });
    await miniWindow.loadFile(path.join(appDir, 'src/ui/mini-prayer.html'));
    miniTimer = setInterval(() => {
      if (miniWindow?.isVisible()) {
        miniWindow.webContents.send('mini:state', miniPayload());
        positionMini();
      }
    }, 30000);
  }
  miniExpanded = false;
  miniWindow.webContents.send('mini:state', { ...miniPayload(), resetEditor: true });
  miniWindow.showInactive();
  positionMini();
  miniWindow.webContents
    .executeJavaScript(
      `document.body.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:${miniMotion()}})`,
    )
    .catch(() => {});
}
ipcMain.handle('mini:toggle', () => toggleMini());
ipcMain.handle('mini:get', () => miniPayload());
ipcMain.handle('mini:hide', () => hideMini());
ipcMain.handle('mini:resize', (_, expanded) => {
  miniExpanded = expanded === true;
  positionMini();
});
ipcMain.handle('mini:open-main', () => {
  hideMini();
  mainWindow?.show();
  mainWindow?.focus();
});
ipcMain.handle('mini:save-region', async (_, value) => {
  const country = prayerEngine.getCountries().find((c) => c.code === value?.countryCode),
    city = country && prayerEngine.getCities(country.code).find((c) => c.id === value.cityId);
  if (!city) throw Error('اختر دولة ومدينة صحيحتين من القائمة.');
  if (
    !Object.hasOwn(
      require('./src/engines/prayer-times-engine').API_METHODS,
      value.calculationMethod,
    )
  )
    throw Error('اختر طريقة حساب صحيحة.');
  const result = await saveApplicationSettings({
    location: {
      ...city,
      autoDetect: false,
      calculationMethod: value.calculationMethod,
      calculationMethodSelection: value.manual === true ? 'manual' : 'auto',
    },
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:region-updated', result.config);
    mainWindow.webContents.send('app:prayer-schedule', result.prayerData);
  }
  return { saved: true };
});
const originalReflow = notificationCenter.reflow.bind(notificationCenter);
notificationCenter.reflow = function () {
  originalReflow();
  positionMini();
};
const avatarTasks = new Map();
ipcMain.handle('youtube:avatar', (_, id) => {
  if (!/^UC[\w-]{22}$/.test(id) || !youtubeEngine.getChannels().some((c) => c.channelId === id))
    throw Error('قناة غير موجودة.');
  const profile = currentPerformance().profile;
  if (!profile.images) {
    avatarTasks.clear();
    return null;
  }
  resources.ensure('youtube');
  if (!avatarTasks.has(id)) {
    const limit = profile.id === 'balanced' ? 32 : 100;
    while (avatarTasks.size >= limit) avatarTasks.delete(avatarTasks.keys().next().value);
    avatarTasks.set(
      id,
      youtubeEngine
        .getChannelPage('https://www.youtube.com/channel/' + id)
        .then((p) => p.avatarUrl)
        .catch((error) => {
          avatarTasks.delete(id);
          throw error;
        }),
    );
  }
  return avatarTasks.get(id);
});
let imagePreview = null,
  imagePreviewTask = null;
async function getHadithPreview(key) {
  if (imagePreview?.key === key) return imagePreview.png;
  if (imagePreviewTask) await imagePreviewTask.catch(() => {});
  if (imagePreview?.key === key) return imagePreview.png;
  imagePreviewTask = renderHadithImage({
    BrowserWindow,
    hadith: hadithEngine.getExportHadith(key),
    baseDir: app.getAppPath(),
  });
  try {
    const png = await imagePreviewTask;
    imagePreview = { key, png };
    return png;
  } finally {
    imagePreviewTask = null;
  }
}
ipcMain.handle('hadith:preview-image', async (_, key) => ({
  dataUrl: 'data:image/png;base64,' + (await getHadithPreview(key)).toString('base64'),
}));
ipcMain.handle('hadith:copy-image', async (_, key) => {
  clipboard.writeImage(nativeImage.createFromBuffer(await getHadithPreview(key)));
  return { copied: true };
});

app.whenReady().then(() => {
  localSync.load().catch(error => console.warn("[Mihrab local sync]", error.code || error.name));
  resources.attachSession(require('electron').session.defaultSession);
  createMainWindow();
  createSystemTray();
  if (
    !globalShortcut.register('CommandOrControl+Shift+Space', () =>
      toggleMini().catch(reportNotificationError),
    )
  )
    console.warn('[Mini] Shortcut unavailable: Ctrl+Shift+Space');
  updateTimer = setInterval(() => getUpdateEngine().tick(), 60000);

  // Enable open-at-login startup.
  try {
    if (!app.commandLine.hasSwitch('user-data-dir'))
      app.setLoginItemSettings({
        openAtLogin: storage.getConfig().startup?.enabled !== false,
        openAsHidden: false,
      });
  } catch (startupErr) {
    console.warn('[Startup] LoginItemSettings warning:', startupErr.message);
  }

  const tick = () => {
    samplePreparationActivity();
    scheduler.tick(getAppNow());
  };
  tick();
  schedulerTimer = setInterval(() => { tick(); updateLocationAutomatically(); }, 1000);
  powerMonitor.on('suspend', () => {
    preparationSuspended = true;
    preparation.observe(Date.now(), Infinity, true);
  });
  powerMonitor.on('resume', () => {
    const now = Date.now();
    preparationSuspended = false;
    preparation.observe(now, Infinity, true);
    if (!preparationSession) return;
    if (now >= preparationSession.endsAt) closePrayerLockWindow();
    else if (!preparationSession.preview && preparationSession.shownAt) preparationSession.active = true;
  });
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => {
      notificationCenter.reflow();
      syncPreparationDisplays();
    });
  }

  setTimeout(()=>queueCityVerification(),3000);
  updateLocationAutomatically();

  const themesDir = path.join(resourcesDir, 'themes');
  if (fs.existsSync(themesDir)) {
    fs.watch(themesDir, { persistent: false }, () => {
      const updatedTheme = themeEngine.getActiveThemeState();
      if (mainWindow && !mainWindow.isDestroyed() && updatedTheme) {
        mainWindow.webContents.send('theme:live-reloaded', updatedTheme);
      }
      updateAuxiliaryWindowThemes(updatedTheme);
    });
  }
});

app.on('before-quit', (event) => {
  if (preparationSession && !preparationSession.preview) {
    event.preventDefault();
    return;
  }
  app.isQuitting = true;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (!quitAudioRestored && audioManager.needsRestore) {
    event.preventDefault();
    if (!quitAudioPending) {
      quitAudioPending = true;
      closePrayerLockWindow().finally(() => {
        quitAudioRestored = true;
        app.quit();
      });
    }
    return;
  }
  closePrayerLockWindow();
  closeNotificationPopup();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  // Keep the tray process alive after all windows close.
  if (app.isQuitting) {
    closeNotificationPopup();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});
