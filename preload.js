const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('mihrabApi', {
  setPerformanceLevel: (level) => ipcRenderer.invoke('performance:set', level),
  getYoutubePage: (options) => ipcRenderer.invoke('youtube:get-page', options),
  saveAccessibility: (value) => ipcRenderer.invoke('accessibility:set', value),
  setInterfaceZoom: (factor) =>
    webFrame.setZoomFactor(Math.max(0.8, Math.min(1.5, Number(factor) || 1))),
  onAccessibilityShortcut: (callback) =>
    ipcRenderer.on('accessibility:shortcut', (_, action) => callback(action)),
  getResourceStats: () => ipcRenderer.invoke('resources:stats'),
  clearResourceCache: () => ipcRenderer.invoke('resources:clear-cache'),
  deleteResourceData: (kind) => ipcRenderer.invoke('resources:delete-data', kind),
  getBootstrapData: () => ipcRenderer.invoke('app:get-bootstrap-data'),

  // Theme API.
  getThemeState: () => ipcRenderer.invoke('theme:get-state'),
  setTheme: (themeId, mode) => ipcRenderer.invoke('theme:set', { themeId, mode }),
  onThemeLiveReloaded: (cb) => ipcRenderer.on('theme:live-reloaded', (_, data) => cb(data)),

  // Prayer times, location and verification API.
  detectLocation: () => ipcRenderer.invoke('prayer:detect-location'),
  verifyOfficialTimings: () => ipcRenderer.invoke('prayer:verify-official'),
  getPrayerTimes: () => ipcRenderer.invoke('prayer:get-times'),
  getCountryCities: (countryCode) => ipcRenderer.invoke('prayer:get-cities', { countryCode }),

  // Hadith and explanation API.
  getNextHadith: () => ipcRenderer.invoke('hadith:next'),
  syncHadeethEncHadiths: (topic) => ipcRenderer.invoke('hadith:sync-hadeethenc', { topic }),

  getHadithLibrary: (options) => ipcRenderer.invoke('hadith:library', options),
  selectStoredHadith: (key) => ipcRenderer.invoke('hadith:select', { key }),
  openHadithSource: (key) => ipcRenderer.invoke('hadith:open-source', { key }),
  copyHadith: (key) => ipcRenderer.invoke('hadith:copy', { key }),
  exportHadithImage: (key) => ipcRenderer.invoke('hadith:export-image', { key }),
  getHadithDetails: (key, force = false) => ipcRenderer.invoke('hadith:details', { key, force }),

  // YouTube channel and RSS API.
  addYoutubeChannel: (payload) => ipcRenderer.invoke('youtube:add-channel', payload),
  removeYoutubeChannel: (channelId) => ipcRenderer.invoke('youtube:remove-channel', { channelId }),
  getYoutubeState: () => ipcRenderer.invoke('youtube:get-state'),
  refreshYoutubeFeeds: (contextId) => ipcRenderer.invoke('youtube:refresh-feeds', { contextId }),
  openExternalUrl: (url) => ipcRenderer.invoke('youtube:open-external', { url }),

  openBugReport: (payload) => ipcRenderer.invoke('report:open-draft', payload),
  getUpdateStatus: () => ipcRenderer.invoke('updates:status'),
  checkForUpdate: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('updates:status', (_, data) => cb(data)),
  toggleMiniPrayer: () => ipcRenderer.invoke('mini:toggle'),
  getMiniPrayer: () => ipcRenderer.invoke('mini:get'),
  hideMiniPrayer: () => ipcRenderer.invoke('mini:hide'),
  resizeMiniPrayer: (expanded) => ipcRenderer.invoke('mini:resize', expanded),
  openMiniMain: () => ipcRenderer.invoke('mini:open-main'),
  saveMiniRegion: (value) => ipcRenderer.invoke('mini:save-region', value),
  onRegionUpdated: (cb) => ipcRenderer.on('app:region-updated', (_, config) => cb(config)),
  onMiniPrayer: (cb) => ipcRenderer.on('mini:state', (_, data) => cb(data)),
  getChannelAvatar: (id) => ipcRenderer.invoke('youtube:avatar', id),
  previewHadithImage: (key) => ipcRenderer.invoke('hadith:preview-image', key),
  copyHadithImage: (key) => ipcRenderer.invoke('hadith:copy-image', key),
  getProjectInfo: () => ipcRenderer.invoke('project:get-info'),
  getBankSupport: () => ipcRenderer.invoke('project:get-bank-support'),
  copyBankField: (key) => ipcRenderer.invoke('project:copy-bank-field', key),
  openProjectContact: (kind) => ipcRenderer.invoke('project:open-contact', kind),
  toggleQuranNotification: (kind) => ipcRenderer.invoke('quran:toggle-notification', kind),

  // Quran portion API.
  advanceQuranProgress: (type) => ipcRenderer.invoke('quran:advance-progress', { type }),
  rollRandomQuranReading: () => ipcRenderer.invoke('quran:roll-random'),
  getQuranStatus: () => ipcRenderer.invoke('quran:get-status'),

  // Settings and preparation screen API.
  saveSettings: (newConfig) => ipcRenderer.invoke('settings:save', newConfig),
  snoozeScreenLock: (minutes) => ipcRenderer.invoke('lockscreen:snooze', { minutes }),
  previewPreLockWarning: () => ipcRenderer.invoke('lockscreen:preview-warning'),
  previewScreenLock: (options) =>
    ipcRenderer.invoke(
      'lockscreen:preview-lock',
      typeof options === 'number' ? { durationMinutes: options } : options || {},
    ),
  forceCloseLockscreen: () => ipcRenderer.invoke('lockscreen:force-close'),

  // In-app notification window API.
  notificationPopupAction: (action) => ipcRenderer.invoke('notification-popup:action', { action }),
  onNavigateTo: (cb) => ipcRenderer.on('app:navigate', (_, target) => cb(target)),
  onAutomationStatus: (cb) => ipcRenderer.on('app:automation-status', (_, data) => cb(data)),
  onNotificationError: (cb) => ipcRenderer.on('app:notification-error', (_, data) => cb(data)),
  reportNotificationAudioStatus: (status) =>
    ipcRenderer.send('notification-popup:audio-status', status),
  closeNotificationPopup: () => ipcRenderer.invoke('notification-popup:close'),
  onNotificationPopupData: (cb) => ipcRenderer.on('notification-popup:data', (_, data) => cb(data)),

  // Live notification and settings update events.
  onNotification: (cb) => ipcRenderer.on('app:notification', (_, data) => cb(data)),
  onPreLockWarning: (cb) => ipcRenderer.on('app:pre-lock-warning', (_, data) => cb(data)),
  onPrayerScheduleChanged: (cb) => ipcRenderer.on('app:prayer-schedule', (_, data) => cb(data)),
  onPrayerReached: (cb) => ipcRenderer.on('app:prayer-reached', (_, data) => cb(data)),
  onConfigUpdated: (cb) => ipcRenderer.on('app:config-updated', (_, data) => cb(data)),

  // Full-screen preparation window events.
  onLockscreenInit: (cb) => ipcRenderer.on('lockscreen:init', (_, data) => cb(data)),
  onLockscreenThemeUpdated: (cb) =>
    ipcRenderer.on('lockscreen:theme-updated', (_, data) => cb(data)),
  onLockscreenClosed: (cb) => ipcRenderer.on('lockscreen:closed', (_, result) => cb(result)),
});
