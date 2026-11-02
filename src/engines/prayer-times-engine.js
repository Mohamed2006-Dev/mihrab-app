const fs = require('fs');
const path = require('path');
const adhan = require('adhan');

const COUNTRY_METHODS = Object.freeze(
  Object.fromEntries([
    ...['MA'].map((code) => [code, 'Habous']),
    ...['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'YE'].map((code) => [code, 'UmmAlQura']),
    ...['EG', 'SD', 'SY', 'PS', 'JO', 'LB', 'DZ', 'TN', 'LY', 'MR'].map((code) => [
      code,
      'Egyptian',
    ]),
    ...['TR', 'AL', 'BA', 'BG', 'GR', 'XK', 'ME', 'MK', 'RO', 'RS', 'HR', 'SI'].map((code) => [
      code,
      'Turkey',
    ]),
    ...['US', 'CA'].map((code) => [code, 'NorthAmerica']),
    ...['PK', 'IN', 'BD', 'AF'].map((code) => [code, 'Karachi']),
  ]),
);
const API_METHODS = Object.freeze({
  Habous: 21,
  Morocco: 21,
  UmmAlQura: 4,
  Egyptian: 5,
  MuslimWorldLeague: 3,
  NorthAmerica: 2,
  Karachi: 1,
  Turkey: 13,
  Dubai: 16,
  Kuwait: 9,
  Qatar: 10,
});
const OFFLINE_MESSAGE = 'قد يكون التوقيت غير دقيق لعدم توفر اتصال بالإنترنت حالياً';
const OFFICIAL_MESSAGE = 'تمت المطابقة والتحقق من التوقيت الرسمي بنجاح';
const ALTERNATIVE_MESSAGE = 'تم تحديث المواقيت عبر المزود البديل';
const formatters = new Map();
function effectiveTimeZone(timeZone, date = new Date()) {
  // Electron's bundled tzdata predates the Moroccan legal-time change of 20 September 2026.
  // Official notice: https://www.cg.gov.ma/en/node/13036 (02:00 old local time = 01:00 UTC).
  if (
    ['Africa/Casablanca', 'Africa/El_Aaiun'].includes(timeZone) &&
    date.getTime() >= Date.parse('2026-09-20T01:00:00Z')
  )
    return 'Etc/UTC';
  return timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function formatter(timeZone, clock = false, date = new Date()) {
  const zone = effectiveTimeZone(timeZone, date);
  const key = zone + ':' + clock;
  if (!formatters.has(key))
    formatters.set(
      key,
      new Intl.DateTimeFormat(
        'en-GB',
        clock
          ? { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
          : {
              timeZone: zone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            },
      ),
    );
  return formatters.get(key);
}
function dateParts(date, timeZone) {
  return Object.fromEntries(
    formatter(timeZone, false, date)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}
function dateKey(date, timeZone) {
  const p = dateParts(date, timeZone);
  return p.year + '-' + p.month + '-' + p.day;
}
function calendarDate(date, timeZone) {
  const p = dateParts(date, timeZone);
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day), 12);
}
function formatTime(date, timeZone) {
  return date && Number.isFinite(new Date(date).getTime())
    ? formatter(timeZone, true, new Date(date)).format(new Date(date))
    : '--:--';
}
function calculationParams(method = 'MuslimWorldLeague') {
  let params;
  if (method === 'Habous' || method === 'Morocco') {
    params = new adhan.CalculationParameters('Habous', 19, 17);
    params.methodAdjustments.dhuhr = 5;
  } else {
    const fn = adhan.CalculationMethod[method];
    if (typeof fn !== 'function' || !(method in API_METHODS))
      throw new Error('طريقة حساب المواقيت غير مدعومة.');
    params = fn();
  }
  params.madhab = adhan.Madhab.Shafi;
  return params;
}
function coordinate(value, fallback, limit) {
  const number = value === '' || value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > limit)
    throw new Error('يرجى إدخال إحداثيات صالحة للمدينة.');
  return number;
}
function locationKey(location) {
  return JSON.stringify([
    Number(location.lat),
    Number(location.lng),
    location.calculationMethod,
    location.timeZone,
  ]);
}
function shiftDay(date, days, timeZone) {
  const p = dateParts(date, timeZone);
  const target = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + days, 12);
  let instant = new Date(target);
  for (let i = 0; i < 3; i++) {
    const actual = dateParts(instant, timeZone);
    const value = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
    );
    instant = new Date(instant.getTime() + target - value);
  }
  return instant;
}
function prayerTimesForDate(coordinates, calendar, params, timeZone) {
  let result = new adhan.PrayerTimes(coordinates, calendar, params);
  // Some Pacific zones use the next civil day relative to their longitude (e.g. Kiritimati).
  // Align the astronomical date by solar noon, while retaining actual UTC instants for alarms.
  if (Number.isFinite(result.dhuhr?.getTime())) {
    const actual = dateParts(result.dhuhr, timeZone);
    const targetDay = Date.UTC(calendar.getFullYear(), calendar.getMonth(), calendar.getDate());
    const actualDay = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day));
    const delta = Math.round((targetDay - actualDay) / 86400000);
    if (delta)
      result = new adhan.PrayerTimes(
        coordinates,
        new Date(calendar.getFullYear(), calendar.getMonth(), calendar.getDate() + delta, 12),
        params,
      );
  }
  return result;
}

/** Geographic catalog and calculation rules shared by local times and remote verification. */
class PrayerTimesEngine {
  constructor(storage, baseDir) {
    this.storage = storage;
    this.baseDir = baseDir;
    this.directory = path.join(baseDir, 'data', 'geography');
    this.countryCache = null;
    this.cityCache = new Map();
    this.locationCache = new Map();
  }
  countries() {
    if (!this.countryCache) {
      const data = JSON.parse(fs.readFileSync(path.join(this.directory, 'countries.json'), 'utf8'));
      if (!Array.isArray(data) || data.length < 200)
        throw new Error('تعذر تحميل قائمة الدول العالمية.');
      this.countryCache = data
        .map((country) => ({ ...country, method: this.methodForCountry(country.code) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    return this.countryCache;
  }
  country(value = '') {
    const raw = String(value).trim();
    const input = ['IL', 'ISRAEL', 'إسرائيل', 'اسرائيل'].includes(raw.toUpperCase()) ? 'PS' : raw;
    return this.countries().find(
      (country) =>
        country.code === input.toUpperCase() ||
        country.name === input ||
        country.aliases.some((alias) => alias.toLowerCase() === input.toLowerCase()),
    );
  }
  methodForCountry(code) {
    return COUNTRY_METHODS[String(code || '').toUpperCase()] || 'MuslimWorldLeague';
  }
  cities(code) {
    const country = this.country(code);
    if (!country) throw new Error('يرجى اختيار دولة صحيحة من القائمة.');
    if (!this.cityCache.has(country.code)) {
      const data = JSON.parse(
        fs.readFileSync(path.join(this.directory, country.code + '.json'), 'utf8'),
      );
      if (!Array.isArray(data)) throw new Error('تعذر تحميل مدن الدولة المختارة.');
      this.cityCache.set(
        country.code,
        data.map((city) => ({
          ...city,
          country: country.name,
          countryCode: country.code,
          method: country.method,
        })),
      );
    }
    return this.cityCache.get(country.code);
  }
  normalizeLocation(location = {}) {
    const key = JSON.stringify(location);
    if (this.locationCache.has(key)) return this.locationCache.get(key);
    const country = this.country(location.country) || this.country(location.countryCode);
    const lat = coordinate(location.lat, 21.4225, 90),
      lng = coordinate(location.lng, 39.8262, 180);
    let timeZone = location.timeZone;
    if (!timeZone && country) {
      const cities = this.cities(country.code);
      const nearest = cities.reduce((best, city) => {
        const distance =
          (city.lat - lat) ** 2 + ((city.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
        return !best || distance < best.distance ? { distance, city } : best;
      }, null);
      timeZone = nearest?.city.timeZone;
    }
    timeZone ||= Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      formatter(timeZone);
    } catch {
      throw new Error('يرجى اختيار منطقة زمنية صحيحة للمدينة.');
    }
    const result = {
      ...location,
      countryCode: country?.code || location.countryCode || '',
      country: country?.name || location.country || '',
      lat,
      lng,
      timeZone,
      calculationMethod: location.calculationMethod || this.methodForCountry(country?.code),
    };
    calculationParams(result.calculationMethod);
    if (this.locationCache.size > 20) this.locationCache.clear();
    this.locationCache.set(key, result);
    return result;
  }
}
Object.assign(PrayerTimesEngine, {
  COUNTRY_METHODS,
  API_METHODS,
  OFFLINE_MESSAGE,
  OFFICIAL_MESSAGE,
  ALTERNATIVE_MESSAGE,
  dateParts,
  dateKey,
  calendarDate,
  formatTime,
  calculationParams,
  locationKey,
  shiftDay,
  prayerTimesForDate,
  effectiveTimeZone,
});
module.exports = PrayerTimesEngine;
