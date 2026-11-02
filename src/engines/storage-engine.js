const NotificationSettings = require('./notification-settings');
const fs = require('fs');
const path = require('path');

/** Local JSON storage for offline-first settings and application data. */
class StorageEngine {
  constructor(baseDir, writableDir = null) {
    this.baseDir = baseDir;
    this.writableDir = writableDir || baseDir;
    this.dataDir = path.join(this.writableDir, 'data');
    this.seedDataDir = path.join(this.baseDir, 'data');
    this.userConfigPath = path.join(this.dataDir, 'user-config.json');
    this.hadithCachePath = path.join(this.dataDir, 'hadith-cache.json');
    this.youtubeCachePath = path.join(this.dataDir, 'youtube-cache.json');
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch (_) {}
    }
    // Copy seed files only when writable user data does not already exist.
    const seedFiles = [
      'cities.json',
      'youtube-contexts.json',
      'seed-hadiths.json',
      'quran-metadata.json',
      'user-config.json',
    ];
    for (const f of seedFiles) {
      const src = path.join(this.seedDataDir, f);
      const dest = path.join(this.dataDir, f);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.copyFileSync(src, dest);
        } catch (_) {}
      }
    }
  }

  getDefaultConfig() {
    const youtubeContexts = this.readJsonSafe(path.join(this.dataDir, 'youtube-contexts.json'), {
      defaultChannels: [],
    });
    return {
      location: {
        autoDetect: true,
        city: 'مكة المكرمة',
        country: 'المملكة العربية السعودية',
        lat: 21.4225,
        lng: 39.8262,
        calculationMethod: 'UmmAlQura',
      },
      prayerAdjustments: {
        fajr: 0,
        sunrise: 0,
        dhuhr: 0,
        asr: 0,
        maghrib: 0,
        isha: 0,
      },
      officialSync: {
        enabled: true,
        autoApplyDiscrepancy: true,
        lastSyncTime: null,
        lastDiscrepancyReport: null,
      },
      notifications: {
        prePrayerMinutes: 15,
        fridayPrePrayerMinutes: 60, // Friday defaults to 60 minutes, with a minimum of 30.
        dailyVideoAfterIshaMinutes: 45,
        playAdhanAudio: true,
      },
      quranWird: {
        riwaya: 'hafs',
        notificationMode: 'both', // 'reading_only' | 'hifz_only' | 'both' | 'none'
        reading: {
          mode: 'sequential', // 'sequential' | 'random'
          unit: 'juz', // 'hizb' | 'rub' | 'surah' | 'page'
          amount: 1,
          currentPosition: {
            juzNumber: 1,
            surahNumber: 1,
            hizbNumber: 1,
            rubNumber: 1,
            pageNumber: 1,
          },
          randomDailyWird: null,
          afterIshaMinutes: 30,
          customTimeEnabled: false,
          customTime: '20:30',
        },
        hifz: {
          unit: 'juz', // 'hizb' | 'rub' | 'surah' | 'page'
          amount: 1,
          rangeStart: 29, // Interpret the range using the selected unit.
          rangeEnd: 30,
          currentPosition: {
            juzNumber: 29,
            surahNumber: 78,
            hizbNumber: 58,
            rubNumber: 231,
            pageNumber: 582,
          },
          afterFajrMinutes: 30,
          customTimeEnabled: false,
          customTime: '05:45',
        },
      },
      screenLock: {
        enabled: false,
        minutesBeforeAdhan: 15, // The preparation screen requires at least 15 minutes of lead time.
        warningMinutes: 1,
        snoozeMinutes: 3, // Emergency postponement interval.
        muteSystemAudio: true,
      },

      youtube: {
        channels: youtubeContexts.defaultChannels || [],
        preferredContextIds: ['ctx_01', 'ctx_02', 'ctx_03', 'ctx_04', 'ctx_05', 'ctx_10'],
      },
    };
  }

  readJsonSafe(filePath, fallback = {}) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error(`[StorageEngine] Error reading ${filePath}:`, err.message);
    }
    return fallback;
  }

  writeJsonSafe(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error(`[StorageEngine] Error writing ${filePath}:`, err.message);
      return false;
    }
  }

  getConfig() {
    const defaults = this.getDefaultConfig();
    if (!fs.existsSync(this.userConfigPath)) {
      this.writeJsonSafe(this.userConfigPath, defaults);
      return NotificationSettings.normalizeConfig(defaults);
    }
    const saved = this.readJsonSafe(this.userConfigPath, {});
    return NotificationSettings.normalizeConfig(this.deepMerge(defaults, saved));
  }

  saveConfig(partialOrFullConfig) {
    const current = this.getConfig();
    const updated = this.deepMerge(current, partialOrFullConfig);
    delete updated.screenLock.lockDurationMinutes;
    NotificationSettings.validateConfig(updated);
    if (!this.writeJsonSafe(this.userConfigPath, updated))
      throw new Error('تعذر حفظ الإعدادات على القرص.');
    return updated;
  }

  deepMerge(target, source) {
    if (typeof target !== 'object' || target === null) return source;
    if (typeof source !== 'object' || source === null) return target;
    const output = Array.isArray(target) ? [...target] : { ...target };
    for (const key of Object.keys(source)) {
      if (Array.isArray(source[key])) {
        output[key] = [...source[key]];
      } else if (typeof source[key] === 'object' && source[key] !== null && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }
}

module.exports = StorageEngine;
