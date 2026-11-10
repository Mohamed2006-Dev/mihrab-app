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
} = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

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
try {
  if (!app.commandLine.hasSwitch('user-data-dir'))
    app.setPath('userData', path.join(app.getPath('appData'), 'mihrab-desktop'));
} catch (_) {}
app.disableHardwareAcceleration();

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
const currentPerformance = () => PerformanceEngine.resolve(storage.getConfig(), deviceHardware);
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
let lockKeepAliveInterval = null;
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
        return { lockAt, message: 'معاينة: تم تمديد عداد هذا الإشعار فقط، دون جدولة قفل فعلي.' };
      }
      return scheduler.snoozeScreenLock(data.snoozeMinutes, data.scheduleId, getAppNow());
    }
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

/** Temporarily show or hide the Windows taskbar through Win32 ShowWindow. */
function setWindowsTaskbarVisibility(visible) {
  if (process.platform !== 'win32') return;
  const cmdFlag = visible ? 5 : 0; // SW_SHOW = 5, SW_HIDE = 0
  const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Taskbar {
  [DllImport("user32.dll")]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")]
  public static extern int ShowWindow(IntPtr hwnd, int nCmdShow);
}
"@
$h1 = [Win32Taskbar]::FindWindow("Shell_TrayWnd", $null)
if ($h1 -ne [IntPtr]::Zero) { [Win32Taskbar]::ShowWindow($h1, ${cmdFlag}) | Out-Null }
$h2 = [Win32Taskbar]::FindWindow("Shell_SecondaryTrayWnd", $null)
if ($h2 -ne [IntPtr]::Zero) { [Win32Taskbar]::ShowWindow($h2, ${cmdFlag}) | Out-Null }
`.replace(/\r?\n/g, '; ');

  exec(`powershell -NoProfile -WindowStyle Hidden -Command "${psScript}"`, () => {});
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
      click: () => {
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
      click: () => {
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

/** Close the preparation screen and restore the taskbar and original audio state. */
function closePrayerLockWindow() {
  if (lockReleaseTimer) {
    clearTimeout(lockReleaseTimer);
    lockReleaseTimer = null;
  }
  if (lockKeepAliveInterval) {
    clearInterval(lockKeepAliveInterval);
    lockKeepAliveInterval = null;
  }

  setWindowsTaskbarVisibility(true);

  const audioRestored = restorePrayerLockAudio();

  const closingWindow = lockWindow;
  lockWindow = null;
  if (closingWindow && !closingWindow.isDestroyed()) {
    closingWindow.allowProgrammaticClose = true;
    try {
      closingWindow.setAlwaysOnTop(false);
      closingWindow.setKiosk(false);
      closingWindow.setFullScreen(false);
    } catch (err) {
      console.error('[LockWindow] Error leaving kiosk mode:', err.message);
    } finally {
      closingWindow.destroy();
    }
  }

  if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting) {
    mainWindow.focus();
    audioRestored.then((result) => {
      if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting)
        mainWindow.webContents.send('lockscreen:closed', result);
    });
  }
  return audioRestored;
}

/** Create the prayer preparation screen. */
function createPrayerLockWindow(lockPayload = {}) {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  if (lockWindow && !lockWindow.isDestroyed()) {
    closePrayerLockWindow();
  }

  const isTestMode = Boolean(lockPayload.isTestMode);
  const untilAdhan = lockPayload.prayerTime
    ? (new Date(lockPayload.prayerTime).getTime() - getAppNow().getTime()) / 1000
    : NaN;
  if (!isTestMode && (!Number.isFinite(untilAdhan) || untilAdhan <= 0)) {
    throw new Error('تعذر فتح شاشة التهيئة: يلزم موعد أذان قادم وصحيح.');
  }
  // Real preparation always lasts until adhan; duration controls are preview-only.
  const totalSeconds = isTestMode
    ? Math.max(1, Math.round(Number(lockPayload.durationSeconds) || 30))
    : untilAdhan;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;

  lockWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    kiosk: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    movable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: true,
    webPreferences: {
      devTools: false,
      preload: path.join(appDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const createdWindow = lockWindow;
  createdWindow.isPrayerLockPreview = isTestMode;
  createdWindow.on('closed', () => {
    if (lockWindow === createdWindow) {
      lockWindow = null;
      closePrayerLockWindow();
    }
  });
  createdWindow.webContents.on('render-process-gone', () => {
    if (lockWindow === createdWindow) closePrayerLockWindow();
  });
  muteSystemAudioIfNeeded(lockPayload.muteSystemAudio);
  setWindowsTaskbarVisibility(false);

  lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  lockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lockWindow.setFullScreen(true);
  lockWindow.setKiosk(true);
  lockWindow.setBounds({ x, y, width, height });

  lockWindow.on('blur', () => {
    if (lockWindow && !lockWindow.isDestroyed() && !lockWindow.allowProgrammaticClose) {
      lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      lockWindow.focus();
      lockWindow.moveTop();
      lockWindow.setFullScreen(true);
      lockWindow.setKiosk(true);
    }
  });

  lockKeepAliveInterval = setInterval(() => {
    if (lockWindow && !lockWindow.isDestroyed() && !lockWindow.allowProgrammaticClose) {
      if (!lockWindow.isFocused()) {
        lockWindow.focus();
      }
      lockWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      lockWindow.moveTop();
    }
  }, 400);

  lockWindow.on('close', (e) => {
    if (lockWindow && !lockWindow.allowProgrammaticClose) {
      e.preventDefault();
    }
  });

  lockWindow.webContents.on('before-input-event', (event, input) => {
    const key = (input.key || '').toLowerCase();
    if (
      (input.alt && key === 'f4') ||
      (input.alt && key === 'tab') ||
      (input.control && key === 'w') ||
      (input.control && key === 'escape') ||
      key === 'escape' ||
      key === 'f11' ||
      key === 'meta' ||
      key === 'super' ||
      key === 'os'
    ) {
      event.preventDefault();
    }
  });

  lockWindow.loadFile(path.join(appDir, 'src', 'ui', 'lockscreen.html')).catch((error) => {
    console.error('[LockWindow] Could not load the lock screen:', error.message);
    if (lockWindow === createdWindow) closePrayerLockWindow();
  });

  lockWindow.webContents.on('did-finish-load', () => {
    if (!lockWindow || lockWindow.isDestroyed()) return;
    const themeState = themeEngine.getActiveThemeState();
    lockWindow.webContents.send('lockscreen:init', {
      ...lockPayload,
      durationSeconds: totalSeconds,
      isTestMode,
      themeState,
    });
  });

  if (lockReleaseTimer) clearTimeout(lockReleaseTimer);
  lockReleaseTimer = setTimeout(() => {
    closePrayerLockWindow();
  }, totalSeconds * 1000);

  return {
    started: true,
    durationSeconds: totalSeconds,
    isTestMode,
  };
}

const scheduler = new SchedulerEngine({
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
      if (!lockEnabled && lockWindow && !lockWindow.isPrayerLockPreview) closePrayerLockWindow();
    },
    onPreLockWarning: (warning) => {
      showCustomNotificationPopup({
        ...warning,
        type: 'lock_warning',
        persistent: true,
        playAudio: false,
        title: `التهيؤ لـ${warning.prayerName}: قفل الشاشة قريباً`,
        body: 'احفظ عملك الآن. يمكنك تمديد موعد القفل مباشرة من هذا الإشعار.',
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
      if (lockWindow || audioManager.needsRestore) await closePrayerLockWindow();
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
ipcMain.handle('theme:get-state', () => themeEngine.getActiveThemeState());
ipcMain.handle('theme:set', (_, { themeId, mode }) => {
  const newState = themeEngine.setTheme(themeId, mode);
  if (lockWindow && !lockWindow.isDestroyed()) {
    lockWindow.webContents.send('lockscreen:theme-updated', newState);
  }
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
ipcMain.handle('report:open-draft', async (_, payload) => {
  const { buildReport } = require('./src/engines/bug-report-engine');
  const issues =
    payload?.channel === 'github' ? projectInfoEngine.readSource()?.['git-issues'] : undefined;
  const draft = buildReport(payload, issues);
  if (draft.copyRequired) clipboard.writeText(draft.text);
  await shell.openExternal(draft.url);
  return { opened: true, copyRequired: draft.copyRequired };
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

ipcMain.handle('quran:advance-progress', (_, { type }) => {
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  quranEngine.advanceWirdProgress(type);
  return quranEngine.getFullStatus(prayerData);
});

ipcMain.handle('quran:roll-random', () => {
  quranEngine.rollRandomReadingWird();
  return quranEngine.getFullStatus(prayerEngine.calculateLocalPrayerTimes(getAppNow()));
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
  getConfig: () => storage.getConfig(),
  applyPatch: async patch => {
    const result = await saveApplicationSettings(patch, true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:sync-applied', {
        config: result.config,
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
  if (newConfig.quranWird)
    patch = {
      ...patch,
      quranWird: quranEngine.validateSettings(
        storage.deepMerge(previous.quranWird || {}, newConfig.quranWird),
      ),
    };
  if (
    newConfig.performance &&
    !['auto', 'eco', 'balanced', 'full'].includes(newConfig.performance.level)
  )
    throw Error('مستوى الأداء غير صالح.');
  if (newConfig.updates && (getUpdateEngine().downloading || getUpdateEngine().ready))
    throw Error('لا يمكن تغيير خيارات التحديث أثناء التنزيل أو بعد تجهيز حزمة للتثبيت.');
  if (patch.notifications?.customReminders !== undefined)
    require('./src/engines/custom-reminders').validate(patch.notifications.customReminders);
  const saved = storage.saveConfig(patch);
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

ipcMain.handle('lockscreen:preview-lock', (_, { durationMinutes, durationSeconds, isTestMode }) => {
  const prayerData = prayerEngine.calculateLocalPrayerTimes(getAppNow());
  const hadithState = hadithEngine.getHadithForPrayer(`preview_${Date.now()}`, true);
  return createPrayerLockWindow({
    prayerName: prayerData.nextPrayer?.name || 'صلاة الجماعة',
    prayerTime12: prayerData.nextPrayer?.time12 || '',
    hadith: hadithState.hadith,
    motivationalQuote: scheduler.getRandomMotivationalQuote(),
    lockDurationMinutes: Number(durationMinutes) || 1,
    durationSeconds: Number(durationSeconds) || 0,
    isTestMode: Boolean(isTestMode),
    muteSystemAudio: Boolean(storage.getConfig().screenLock?.muteSystemAudio),
  });
});

ipcMain.handle('lockscreen:force-close', async () => {
  const result = await closePrayerLockWindow();
  return { closed: true, ...result };
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
  resources.ensure('youtube');
  if (!avatarTasks.has(id)) {
    if (avatarTasks.size > 100) avatarTasks.clear();
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
    baseDir: resourcesDir,
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

  scheduler.tick(getAppNow());
  schedulerTimer = setInterval(() => {scheduler.tick(getAppNow());updateLocationAutomatically();}, 1000);
  screen.on('display-metrics-changed', () => notificationCenter.reflow());

  setTimeout(()=>queueCityVerification(),3000);
  updateLocationAutomatically();

  const themesDir = path.join(resourcesDir, 'themes');
  if (fs.existsSync(themesDir)) {
    fs.watch(themesDir, { persistent: false }, () => {
      const updatedTheme = themeEngine.getActiveThemeState();
      if (mainWindow && !mainWindow.isDestroyed() && updatedTheme) {
        mainWindow.webContents.send('theme:live-reloaded', updatedTheme);
      }
      if (lockWindow && !lockWindow.isDestroyed() && updatedTheme) {
        lockWindow.webContents.send('lockscreen:theme-updated', updatedTheme);
      }
    });
  }
});

app.on('before-quit', (event) => {
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
  setWindowsTaskbarVisibility(true);
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
    setWindowsTaskbarVisibility(true);
    closeNotificationPopup();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});
