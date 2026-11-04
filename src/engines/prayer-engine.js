const path = require('path');
const adhan = require('adhan');
const Geography = require('./prayer-times-engine');
const HabousSyncEngine = require('./habous-sync-engine');

/** Prayer calculations, network location discovery and official timetable verification. */
class PrayerEngine {
  constructor(storageEngine, fetchFn = null) {
    this.storage = storageEngine;
    this.fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    const baseDir = path.resolve(__dirname, '..', '..');
    this.geography = new Geography(this.storage, storageEngine.baseDir || baseDir);
    this.habousSyncEngine = new HabousSyncEngine(this.storage, baseDir, this.fetchFn);
  }

  setFetchFn(fn) {
    this.fetchFn = fn;
    if (this.habousSyncEngine) {
      this.habousSyncEngine.setFetchFn(fn);
    }
  }

  /** Localize common country and city names for Arabic display. */
  translateGeoNames(city, country, countryCode) {
    const code = (countryCode || '').toUpperCase();
    const cityMap = {
      'tangier': 'طنجة',
      'tanger': 'طنجة',
      'casablanca': 'الدار البيضاء',
      'rabat': 'الرباط',
      'marrakech': 'مراكش',
      'fes': 'فاس',
      'fez': 'فاس',
      'agadir': 'أكادير',
      'tetouan': 'تطوان',
      'oujda': 'وجدة',
      'mequinez': 'مكناس',
      'meknes': 'مكناس',
      'cairo': 'القاهرة',
      'alexandria': 'الإسكندرية',
      'giza': 'الجيزة',
      'riyadh': 'الرياض',
      'jeddah': 'جدة',
      'mecca': 'مكة المكرمة',
      'makkah': 'مكة المكرمة',
      'medina': 'المدينة المنورة',
      'madinah': 'المدينة المنورة',
      'dammam': 'الدمام',
      'dubai': 'دبي',
      'abu dhabi': 'أبو ظبي',
      'kuwait': 'مدينة الكويت',
      'doha': 'الدوحة',
      'amman': 'عمّان',
      'jerusalem': 'القدس',
      'damascus': 'دمشق',
      'baghdad': 'بغداد',
      'algiers': 'الجزائر',
      'tunis': 'تونس',
      'istanbul': 'إسطنبول',
    };

    const countryMap = {
      'MA': 'المملكة المغربية',
      'SA': 'المملكة العربية السعودية',
      'EG': 'جمهورية مصر العربية',
      'AE': 'الإمارات العربية المتحدة',
      'KW': 'دولة الكويت',
      'QA': 'دولة قطر',
      'BH': 'مملكة البحرين',
      'OM': 'سلطنة عمان',
      'JO': 'المملكة الأردنية الهاشمية',
      'PS': 'فلسطين',
      'SY': 'الجمهورية العربية السورية',
      'IQ': 'جمهورية العراق',
      'DZ': 'الجمهورية الجزائرية',
      'TN': 'الجمهورية التونسية',
      'TR': 'تركيا',
      'YE': 'الجمهورية اليمنية',
      'LY': 'دولة ليبيا',
      'SD': 'جمهورية السودان',
    };

    const cleanCityKey = String(city || '')
      .toLowerCase()
      .trim();
    const arabicCity = cityMap[cleanCityKey] || city || 'مدينة غير معروفة';
    const arabicCountry = countryMap[code] || this.geography.country(code)?.name || country || '';

    return { city: arabicCity, country: arabicCountry };
  }

  /** Try the configured IP geolocation providers in order. */
  async detectLocationOnline({ throwOnError = false, dryRun = false } = {}) {
    const caller = this.fetchFn || fetch;
    const providers = [
      {
        url: 'https://ipwho.is/',
        parse: (d) => ({
          city: d.city,
          country: d.country,
          countryCode: d.country_code,
          lat: d.latitude,
          lng: d.longitude,
        }),
      },
      {
        url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,city,lat,lon',
        parse: (d) => ({
          city: d.city,
          country: d.country,
          countryCode: d.countryCode,
          lat: d.lat,
          lng: d.lon,
        }),
      },
      {
        url: 'https://freeipapi.com/api/json',
        parse: (d) => ({
          city: d.cityName,
          country: d.countryName,
          countryCode: d.countryCode,
          lat: d.latitude,
          lng: d.longitude,
        }),
      },
      {
        url: 'https://ipapi.co/json/',
        parse: (d) => ({
          city: d.city,
          country: d.country_name,
          countryCode: d.country_code,
          lat: d.latitude,
          lng: d.longitude,
        }),
      },
    ];

    let lastError = null;

    for (const p of providers) {
      try {
        const res = await caller(p.url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
          },
        });

        if (res && res.ok) {
          const raw = await res.json();
          const parsed = p.parse(raw);
          if (parsed && parsed.lat != null && parsed.lng != null) {
            const { city, country } = this.translateGeoNames(
              parsed.city,
              parsed.country,
              parsed.countryCode,
            );
            const method = this.inferMethodFromCountry(parsed.countryCode);

            const location = this.geography.normalizeLocation({
              autoDetect: true,
              city,
              country,
              countryCode: (parsed.countryCode || '').toUpperCase(),
              lat: Number(parsed.lat),
              lng: Number(parsed.lng),
              calculationMethod: method,
              calculationMethodSelection: 'auto',
            });

            // Persist discoveries only outside isolated dry-run requests.
            if (!dryRun) {
              const previous = this.geography.normalizeLocation(
                this.storage.getConfig().location || {},
              );
              const changed = Geography.locationKey(previous) !== Geography.locationKey(location);
              this.storage.saveConfig({
                location,
                ...(changed
                  ? {
                      prayerAdjustments: {
                        fajr: 0,
                        sunrise: 0,
                        dhuhr: 0,
                        asr: 0,
                        maghrib: 0,
                        isha: 0,
                      },
                      officialSync: {
                        lastSyncTime: null,
                        lastDiscrepancyReport: null,
                        lastSuccessfulReport: null,
                      },
                    }
                  : {}),
              });
            }

            return {
              success: true,
              dryRun: Boolean(dryRun),
              location,
              source: p.url,
              provider: p.url,
            };
          }
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (throwOnError) {
      throw new Error(
        `فشلت جميع خدمات تحديد الموقع عبر IP: ${lastError ? lastError.message : 'استجابة غير صالحة'}`,
      );
    }

    const config = this.storage.getConfig();
    return {
      success: false,
      location: config.location,
      source: 'offline-cached',
      error: lastError ? lastError.message : 'No internet or provider rate limited',
    };
  }

  inferMethodFromCountry(countryCode) {
    const country = this.geography.country(countryCode);
    return this.geography.methodForCountry(country?.code || countryCode);
  }

  getCalculationParams(methodName) {
    return Geography.calculationParams(
      methodName ||
        this.geography.normalizeLocation(this.storage.getConfig().location).calculationMethod,
    );
  }

  getCountries() {
    return this.geography.countries();
  }
  getCities(code) {
    return this.geography.cities(code);
  }
  rememberLocationSettings(config, date) {
    return new (require('./city-prayer-cache'))(this.storage).remember(config, date);
  }
  restoreLocationSettings(location, date) {
    return new (require('./city-prayer-cache'))(this.storage).restore(location, date);
  }
  getLocation() {
    return this.geography.normalizeLocation(this.storage.getConfig().location || {});
  }
  getDateKey(date) {
    return Geography.dateKey(date, this.getLocation().timeZone);
  }

  /** Calculate an astronomical baseline without manual minute adjustments. */
  calculateRawPrayerTimes(date = new Date()) {
    const config = this.storage.getConfig();
    const loc = this.geography.normalizeLocation(config.location || {});
    const lat = loc.lat;
    const lng = loc.lng;
    const calculationMethod = loc.calculationMethod || 'Habous';

    const coordinates = new adhan.Coordinates(lat, lng);
    const params = this.getCalculationParams(calculationMethod);
    params.adjustments.fajr = 0;
    params.adjustments.sunrise = 0;
    params.adjustments.dhuhr = 0;
    params.adjustments.asr = 0;
    params.adjustments.maghrib = 0;
    params.adjustments.isha = 0;

    return Geography.prayerTimesForDate(
      coordinates,
      Geography.calendarDate(date, loc.timeZone),
      params,
      loc.timeZone,
    );
  }

  /** Calculate prayer times offline using the selected coordinates. */
  calculateLocalPrayerTimes(date = new Date()) {
    const config = this.storage.getConfig();
    const loc = this.geography.normalizeLocation(config.location || {});
    const lat = loc.lat;
    const lng = loc.lng;
    const calculationMethod = loc.calculationMethod || 'UmmAlQura';
    const city = loc.city || 'مكة المكرمة';
    const country = loc.country || '';

    const manual = config.prayerAdjustments || {};
    const report = config.officialSync?.lastSuccessfulReport;
    const keys = ['fajr','sunrise','dhuhr','asr','maghrib','isha'];
    // Older releases stored provider corrections in the manual fields. Do not double them.
    const legacy = !config.officialSync?.adjustmentsSeparated && report?.autoApplied &&
      keys.every(key => Number(manual[key] || 0) === Number(report.discrepanciesInMinutes?.[key] || 0));
    const adj = legacy ? {} : {...manual};
    if (config.officialSync?.autoApplyDiscrepancy !== false && report?.autoApplied &&
        report.locationKey === Geography.locationKey(loc) && report.dateKey === Geography.dateKey(date,loc.timeZone)) {
      for (const key of keys) adj[key] = Number(adj[key] || 0) + Number(report.discrepanciesInMinutes?.[key] || 0);
    }

    const coordinates = new adhan.Coordinates(lat, lng);
    const params = this.getCalculationParams(calculationMethod);

    params.adjustments.fajr = Number(adj.fajr) || 0;
    params.adjustments.sunrise = Number(adj.sunrise) || 0;
    params.adjustments.dhuhr = Number(adj.dhuhr) || 0;
    params.adjustments.asr = Number(adj.asr) || 0;
    params.adjustments.maghrib = Number(adj.maghrib) || 0;
    params.adjustments.isha = Number(adj.isha) || 0;

    const calendar = Geography.calendarDate(date, loc.timeZone);
    const prayerTimes = Geography.prayerTimesForDate(coordinates, calendar, params, loc.timeZone);
    const isFriday = calendar.getDay() === 5;

    const displayedMinute = (value) =>
      Number.isFinite(value?.getTime())
        ? new Date(Math.floor(value.getTime() / 60000) * 60000)
        : null;
    for (const key of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'])
      prayerTimes[key] = displayedMinute(prayerTimes[key]);

    const formatTime24 = (value) => Geography.formatTime(value, loc.timeZone);
    const formatTime12 = (value) => {
      const clock = formatTime24(value);
      if (clock === '--:--') return 'غير متاح';
      const [hours, minutes] = clock.split(':').map(Number);
      return (
        (hours % 12 || 12) + ':' + String(minutes).padStart(2, '0') + (hours >= 12 ? ' م' : ' ص')
      );
    };

    const prayersList = [
      {
        id: 'fajr',
        name: 'صلاة الفجر',
        shortName: 'الفجر',
        time: prayerTimes.fajr,
        time24: formatTime24(prayerTimes.fajr),
        time12: formatTime12(prayerTimes.fajr),
        adjustment: params.adjustments.fajr,
        isFastingCritical: true,
      },
      {
        id: 'sunrise',
        name: 'الشروق',
        shortName: 'الشروق',
        time: prayerTimes.sunrise,
        time24: formatTime24(prayerTimes.sunrise),
        time12: formatTime12(prayerTimes.sunrise),
        adjustment: params.adjustments.sunrise,
        isPrayer: false,
      },
      {
        id: 'dhuhr',
        name: isFriday ? 'صلاة الجمعة' : 'صلاة الظهر',
        shortName: isFriday ? 'الجمعة' : 'الظهر',
        time: prayerTimes.dhuhr,
        time24: formatTime24(prayerTimes.dhuhr),
        time12: formatTime12(prayerTimes.dhuhr),
        adjustment: params.adjustments.dhuhr,
        isFridaySpecial: isFriday,
      },
      {
        id: 'asr',
        name: 'صلاة العصر',
        shortName: 'العصر',
        time: prayerTimes.asr,
        time24: formatTime24(prayerTimes.asr),
        time12: formatTime12(prayerTimes.asr),
        adjustment: params.adjustments.asr,
      },
      {
        id: 'maghrib',
        name: 'صلاة المغرب',
        shortName: 'المغرب',
        time: prayerTimes.maghrib,
        time24: formatTime24(prayerTimes.maghrib),
        time12: formatTime12(prayerTimes.maghrib),
        adjustment: params.adjustments.maghrib,
        isFastingCritical: true,
      },
      {
        id: 'isha',
        name: 'صلاة العشاء',
        shortName: 'العشاء',
        time: prayerTimes.isha,
        time24: formatTime24(prayerTimes.isha),
        time12: formatTime12(prayerTimes.isha),
        adjustment: params.adjustments.isha,
      },
    ];

    // Presentation metadata only; nextPrayer and scheduler timing remain unchanged.
    let previousPrayer =
      [...prayersList]
        .reverse()
        .find((prayer) => prayer.id !== 'sunrise' && prayer.time && prayer.time <= date) || null;
    if (!previousPrayer) {
      const yesterday = new Date(calendar);
      yesterday.setDate(yesterday.getDate() - 1);
      const lastIsha = displayedMinute(
        Geography.prayerTimesForDate(coordinates, yesterday, params, loc.timeZone).isha,
      );
      if (lastIsha && lastIsha <= date)
        previousPrayer = {
          id: 'isha',
          name: 'صلاة العشاء',
          shortName: 'العشاء',
          time: lastIsha,
          time24: formatTime24(lastIsha),
          time12: formatTime12(lastIsha),
        };
    }
    const nextPrayerInfo = this.computeNextPrayer(prayersList, date);

    return {
      dateIso: date.toISOString(),
      isFriday,
      dateKey: Geography.dateKey(date, loc.timeZone),
      location: {
        city,
        country,
        countryCode: loc.countryCode,
        lat,
        lng,
        calculationMethod,
        timeZone: loc.timeZone,
        effectiveTimeZone: Geography.effectiveTimeZone(loc.timeZone, date),
      },
      lastTimingUpdate: (() => {
        const r =
          config.officialSync?.lastSuccessfulReport || config.officialSync?.lastDiscrepancyReport;
        return r?.locationKey === Geography.locationKey(loc) && r.autoApplied ? r : null;
      })(),
      verification:
        config.officialSync?.lastDiscrepancyReport?.locationKey === Geography.locationKey(loc) &&
        config.officialSync.lastDiscrepancyReport.dateKey === Geography.dateKey(date, loc.timeZone)
          ? config.officialSync.lastDiscrepancyReport
          : null,
      calculationWarning: prayersList.some((prayer) => !prayer.time)
        ? 'تعذر تحديد بعض المواقيت لهذا الموقع في هذا اليوم؛ يرجى مراجعة الجهة المحلية.'
        : null,
      prayers: prayersList,
      previousPrayer,
      nextPrayer: nextPrayerInfo,
    };
  }

  computeNextPrayer(prayersList, now = new Date()) {
    const obligatory = prayersList.filter((p) => p.id !== 'sunrise' && p.time);
    for (const p of obligatory) {
      if (p.time.getTime() > now.getTime()) {
        const diffMs = p.time.getTime() - now.getTime();
        return {
          ...p,
          remainingSeconds: Math.floor(diffMs / 1000),
          remainingMinutes: Math.ceil(diffMs / 60000),
        };
      }
    }

    const tomorrow = Geography.calendarDate(now, this.getLocation().timeZone);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const config = this.storage.getConfig();
    const loc = this.geography.normalizeLocation(config.location || {});
    const coordinates = new adhan.Coordinates(loc.lat, loc.lng);
    const params = this.getCalculationParams(loc.calculationMethod);
    params.adjustments.fajr = Number(config.prayerAdjustments?.fajr) || 0;
    const tomorrowPrayers = Geography.prayerTimesForDate(
      coordinates,
      tomorrow,
      params,
      loc.timeZone,
    );
    if (!Number.isFinite(tomorrowPrayers.fajr.getTime())) return null;
    tomorrowPrayers.fajr = new Date(Math.floor(tomorrowPrayers.fajr.getTime() / 60000) * 60000);
    const diffMs = tomorrowPrayers.fajr.getTime() - now.getTime();

    return {
      id: 'fajr',
      name: 'صلاة الفجر (غداً)',
      shortName: 'الفجر',
      time: tomorrowPrayers.fajr,
      remainingSeconds: Math.max(0, Math.floor(diffMs / 1000)),
      remainingMinutes: Math.max(0, Math.ceil(diffMs / 60000)),
    };
  }

  /** Compare local times with the official Moroccan provider and apply verified offsets. */
  async verifyWithOfficialAwqafApi({
    throwOnError = false,
    dryRun = false,
    date = new Date(),
    bypassCache = true,
    origin = 'manual',
  } = {}) {
    return await this.habousSyncEngine.syncOfficialTimings(date, {
      throwOnError,
      dryRun,
      bypassCache,
      origin,
    });
  }
}

module.exports = PrayerEngine;
