const path = require('path');
const fs = require('fs');
const adhan = require('adhan');
const Geography = require('./prayer-times-engine');

/** Compare Habous timings from habous.gov.ma for all six daily events; apply official-minus-local minute offsets. Automatic checks run before dawn on Monday and Thursday. */
class HabousSyncEngine {
  constructor(storageEngine, baseDir, fetchFn = null) {
    this.storage = storageEngine;
    if (typeof baseDir === 'function') {
      this.fetchFn = baseDir;
      this.baseDir = path.resolve(__dirname, '..', '..');
    } else {
      this.baseDir = baseDir || path.resolve(__dirname, '..', '..');
      this.fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    }
    this.cacheDir = this.storage.dataDir || path.join(this.baseDir, 'data');
    this.geography = new Geography(this.storage, this.storage.baseDir || this.baseDir);

    // City aliases reconcile spelling differences between the interface and official tables.
    this.cityAliases = {
      'طنجة': 'طنجة',
      'تطوان': 'تطوان',
      'الدار البيضاء': 'الدار البيضاء',
      'كازابلانكا': 'الدار البيضاء',
      'الرباط': 'الرباط',
      'سلا': 'سلا',
      'فاس': 'فاس',
      'مراكش': 'مراكش',
      'أكادير': 'أكادير',
      'وجدة': 'وجدة',
      'الناظور': 'الناظور',
      'الحسيمة': 'الحسيمة',
      'القنيطرة': 'القنيطرة',
      'مكناس': 'مكناس',
      'المحمدية': 'المحمدية',
      'الجديدة': 'الجديدة',
      'آسفي': 'آسفي',
      'الصويرة': 'الصويرة',
      'بني ملال': 'بني ملال',
      'خريبكة': 'خريبكة',
      'سطات': 'سطات',
      'تازة': 'تازة',
      'بركان': 'بركان',
      'العرائش': 'العرائش',
      'خنيفرة': 'خنيفرة',
      'إفران': 'إفران',
      'ورزازات': 'ورزازات',
      'الرشيدية': 'الرشيدية',
      'تارودانت': 'تارودانت',
      'شفشاون': 'شفشاون',
      'كلميم': 'كلميم',
      'العيون': 'العيون',
      'الداخلة': 'الداخلة',
    };
  }

  setFetchFn(fn) {
    this.fetchFn = fn;
  }

  async requestJson(url) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          let response;
          try {
            response = await (this.fetchFn || fetch)(url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0',
                Accept: 'application/json',
              },
            });
          } catch (error) {
            error.networkFailure = true;
            throw error;
          }
          if (!response?.ok)
            throw new Error(
              'تعذر الحصول على المواقيت من المزود (HTTP ' +
                (response?.status || 'غير معروف') +
                ').',
            );
          try {
            return await response.json();
          } catch {
            throw new Error('بيانات المواقيت المستلمة غير صالحة.');
          }
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const error = new Error('انتهت مهلة الاتصال بمزود المواقيت.');
            error.networkFailure = true;
            reject(error);
          }, 8000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchHabousMonthlyData(year, month, bypassCache = false, { dryRun = false } = {}) {
    const filename = 'habous-horaires-' + year + '-' + String(month).padStart(2, '0') + '.json';
    const cacheFile = path.join(this.cacheDir, filename);
    if (!bypassCache && fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached?.villes) && cached.villes.length >= 30)
        return { ...cached, _fromCache: true };
    }
    const json = await this.requestJson(
      'https://www.habous.gov.ma/data/horaires-' +
        year +
        '-' +
        String(month).padStart(2, '0') +
        '.json',
    );
    if (!Array.isArray(json?.villes) || !json.villes.length)
      throw new Error('جدول الأوقاف المستلم غير مكتمل.');
    if (!dryRun && json.villes.length >= 30) {
      try {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        await fs.promises.writeFile(cacheFile, JSON.stringify(json), 'utf8');
      } catch (error) {
        json._cacheWarning = 'تعذر حفظ نسخة جدول الأوقاف: ' + error.message;
        console.error('[PrayerCache]', json._cacheWarning);
      }
    }
    return json;
  }

  matchCity(villes, userCityName) {
    const normalize = (text) =>
      String(text || '')
        .replace(/[\u064b-\u065f\u0670]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .trim();
    const raw = normalize(userCityName);
    const mapped = normalize(this.cityAliases[userCityName] || userCityName);
    // Never silently replace an unknown Moroccan city with Rabat or another city's schedule.
    return (
      villes.find((city) => normalize(city.nom) === raw) ||
      villes.find((city) => normalize(city.nom) === mapped) ||
      null
    );
  }

  async syncOfficialTimings(
    date = new Date(),
    { throwOnError = false, bypassCache = true, dryRun = false, origin = 'manual' } = {},
  ) {
    const config = this.storage.getConfig();
    const loc = this.geography.normalizeLocation(config.location || {});
    const parts = Geography.dateParts(date, loc.timeZone);
    const day = Geography.dateKey(date, loc.timeZone);
    const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const base = {
      origin,
      syncedAt: new Date().toISOString(),
      cityName: loc.city,
      dateKey: day,
      timeZone: loc.timeZone,
      locationKey: Geography.locationKey(loc),
      dryRun: Boolean(dryRun),
      autoApplied: false,
    };
    let officialError = null;
    const validateClock = (value) => {
      const clock = String(value || '').split(' ')[0];
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock))
        throw new Error('يتضمن جدول المزود وقتاً مفقوداً أو غير صالح: ' + String(value));
      return clock;
    };
    const finish = (timings, status, provider, warning = null) => {
      const raw = Geography.prayerTimesForDate(
        new adhan.Coordinates(loc.lat, loc.lng),
        Geography.calendarDate(date, loc.timeZone),
        Geography.calculationParams(loc.calculationMethod),
        loc.timeZone,
      );
      const calculatedTimings = {},
        discrepanciesInMinutes = {},
        officialTimings = {};
      const toMinute = (clock) => {
        const [h, m] = clock.split(':').map(Number);
        return h * 60 + m;
      };
      for (const key of keys) {
        officialTimings[key] = validateClock(timings[key]);
        calculatedTimings[key] = validateClock(Geography.formatTime(raw[key], loc.timeZone));
        const delta = toMinute(officialTimings[key]) - toMinute(calculatedTimings[key]);
        discrepanciesInMinutes[key] = ((((delta + 720) % 1440) + 1440) % 1440) - 720;
      }
      const message =
        status === 'verified_online'
          ? Geography.OFFICIAL_MESSAGE
          : status === 'alternative_updated'
            ? Geography.ALTERNATIVE_MESSAGE
            : 'عُرضت مواقيت من آخر جدول رسمي محفوظ؛ لم يتم التحقق عبر الإنترنت الآن.';
      const report = {
        ...base,
        status,
        provider,
        providerKind: status === 'alternative_updated' ? 'alternative' : 'official',
        message,
        fastingSafetyNote: message,
        officialTimings,
        calculatedTimings,
        discrepanciesInMinutes,
        autoApplied: !dryRun,
        error: null,
        officialError: officialError?.message || null,
        warning,
      };
      if (
        !dryRun &&
        Geography.locationKey(
          this.geography.normalizeLocation(this.storage.getConfig().location),
        ) !== Geography.locationKey(loc)
      )
        throw Error('تغيرت المدينة أثناء التحقق؛ لم تطبق مواقيت المدينة السابقة.');
      if (!dryRun)
        this.storage.saveConfig({
          prayerAdjustments: discrepanciesInMinutes,
          officialSync: {
            ...(config.officialSync || {}),
            lastSyncTime: report.syncedAt,
            lastDiscrepancyReport: report,
            lastSuccessfulReport: report,
          },
        });
      if (!dryRun)
        new (require('./city-prayer-cache'))(this.storage).remember(this.storage.getConfig(), date);
      return report;
    };
    if (loc.countryCode === 'MA') {
      try {
        const data = await this.fetchHabousMonthlyData(
          Number(parts.year),
          Number(parts.month),
          bypassCache,
          { dryRun },
        );
        const city = this.matchCity(data.villes, loc.city);
        if (!city)
          throw new Error(
            'المدينة غير موجودة بالاسم نفسه في جدول الأوقاف؛ لن تُستخدم مواقيت مدينة أخرى.',
          );
        const record = city.horaires?.find((item) => item.date === day);
        if (!record) throw new Error('لا يتضمن جدول الأوقاف مواقيت اليوم المختار.');
        const report = finish(
          {
            fajr: record.Fajr,
            sunrise: record.Chorouq,
            dhuhr: record.Dhuhr,
            asr: record.Asr,
            maghrib: record.Maghrib,
            isha: record.Ishae,
          },
          data._fromCache ? 'verified_cached' : 'verified_online',
          'وزارة الأوقاف والشؤون الإسلامية المغربية — habous.gov.ma',
          data._cacheWarning,
        );
        report.cityName = city.nom;
        return report;
      } catch (error) {
        officialError = error;
      }
    }
    try {
      const methodId = Geography.API_METHODS[loc.calculationMethod];
      if (methodId == null) throw new Error('طريقة الحساب المختارة غير مدعومة لدى المزود البديل.');
      const url = new URL(
        'https://api.aladhan.com/v1/timings/' + parts.day + '-' + parts.month + '-' + parts.year,
      );
      for (const [key, value] of Object.entries({
        latitude: loc.lat,
        longitude: loc.lng,
        method: methodId,
        timezonestring: loc.timeZone,
        school: 0,
        iso8601: true,
      }))
        url.searchParams.set(key, String(value));
      const json = await this.requestJson(url.href);
      if (json.code !== 200 || !json.data?.timings || !json.data?.date?.gregorian?.date)
        throw new Error('استجابة المزود البديل ناقصة.');
      if (json.data.date.gregorian.date !== parts.day + '-' + parts.month + '-' + parts.year)
        throw new Error('تاريخ المواقيت المستلمة لا يطابق تاريخ المدينة.');
      if (json.data.meta?.method?.id != null && Number(json.data.meta.method.id) !== methodId)
        throw new Error('طريقة حساب المواقيت المستلمة لا تطابق اختيارك.');
      if (
        json.data.meta?.timezone &&
        new Intl.DateTimeFormat('en', { timeZone: json.data.meta.timezone }).resolvedOptions()
          .timeZone !==
          new Intl.DateTimeFormat('en', { timeZone: loc.timeZone }).resolvedOptions().timeZone
      )
        throw new Error('المنطقة الزمنية للمواقيت المستلمة لا تطابق المدينة.');
      const timings = json.data.timings;
      const localClock = (value) => {
        if (
          !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            String(value),
          )
        )
          throw new Error('لم يتضمن الوقت المستلم إزاحة زمنية صريحة؛ لم تُطبق فروق تخمينية.');
        const instant = new Date(value);
        if (!Number.isFinite(instant.getTime()))
          throw new Error('يتضمن جدول المزود وقتاً غير صالح.');
        return Geography.formatTime(instant, loc.timeZone);
      };
      const normalized = {
        fajr: localClock(timings.Fajr),
        sunrise: localClock(timings.Sunrise),
        dhuhr: localClock(timings.Dhuhr),
        asr: localClock(timings.Asr),
        maghrib: localClock(timings.Maghrib),
        isha: localClock(timings.Isha),
      };
      if (Geography.dateKey(new Date(timings.Dhuhr), loc.timeZone) !== day)
        throw new Error('تاريخ أوقات الصلاة الفعلي لا يطابق تاريخ المدينة.');
      return finish(normalized, 'alternative_updated', 'AlAdhan — المزود العالمي البديل');
    } catch (error) {
      const offline = Boolean(
        error.networkFailure && (!officialError || officialError.networkFailure),
      );
      const message = offline
        ? Geography.OFFLINE_MESSAGE
        : 'تعذر تحديث المواقيت الآن؛ يرجى المحاولة لاحقاً.';
      const report = {
        ...base,
        status: offline ? 'offline_fallback' : 'sync_failed',
        provider: 'AlAdhan',
        providerKind: null,
        officialTimings: null,
        calculatedTimings: null,
        discrepanciesInMinutes: null,
        warning: null,
        message,
        fastingSafetyNote: message,
        error: error.message,
        officialError: officialError?.message || null,
      };
      if (
        !dryRun &&
        Geography.locationKey(
          this.geography.normalizeLocation(this.storage.getConfig().location),
        ) === Geography.locationKey(loc)
      )
        this.storage.saveConfig({
          officialSync: { ...(config.officialSync || {}), lastDiscrepancyReport: report },
        });
      if (throwOnError) {
        const failure = new Error(message + ' ' + error.message);
        failure.report = report;
        throw failure;
      }
      return report;
    }
  }
}
module.exports = HabousSyncEngine;
