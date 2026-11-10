const Geography = require('./prayer-times-engine');
const Policy = require('./notification-settings');
const MINUTE = 60000;
const TYPES = {
  hadith: { title: 'تذكير بالحديث', body: 'حان موعد قراءة حديث.', tabId: 'tab-hadith' },
  adhkar: { title: 'تذكير بالأذكار', body: 'حان موعد أذكارك.', tabId: 'tab-adhkar' },
  video: { title: 'تذكير بالدرس', body: 'حان موعد متابعة درس.', tabId: 'tab-youtube' },
};

function validate(rows) {
  if (!Array.isArray(rows) || rows.length > 8) throw Error('يمكن حفظ ثمانية تذكيرات مخصّصة.');
  if (rows.filter(row => row?.mode === 'interval').length > 5) throw Error('يمكن حفظ خمسة تذكيرات تكرارية.');
  const ids = new Set();
  for (const row of rows) {
    if (!row || !/^[\w-]{8,64}$/.test(row.id || '') || ids.has(row.id) ||
        !Object.hasOwn(TYPES, row.type) || !Number.isFinite(row.start))
      throw Error('بيانات التذكير غير صالحة.');
    ids.add(row.id);
    if (row.durationSeconds != null && (!Number.isInteger(row.durationSeconds) || row.durationSeconds < 5 || row.durationSeconds > 60))
      throw Error('اختر مدة عرض من 5 إلى 60 ثانية.');
    if (row.mode === 'interval') {
      if (!Number.isInteger(row.hours) || row.hours < 2 || row.hours > 168)
        throw Error('اختر مدة من ساعتين إلى 168 ساعة.');
    } else if (row.mode === 'fixed') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.clock)) throw Error('اختر ساعة صحيحة.');
    } else if (row.mode === 'prayer') {
      if (!Policy.PRAYERS.includes(row.prayer) || !Number.isInteger(row.offset) || row.offset < 0 || row.offset > 240)
        throw Error('اختر صلاة ومدة من صفر إلى 240 دقيقة.');
    } else throw Error('اختر نمط تذكير صحيحاً.');
  }
}

function fixedTime(date, zone, clock) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock || '')) return NaN;
  const [hour, minute] = clock.split(':').map(Number);
  const asUTC = (parts, h, m) => Date.UTC(+parts.year, +parts.month - 1, +parts.day, h, m);
  const wall = asUTC(Geography.dateParts(date, zone), hour, minute);
  let at = wall;
  for (let i = 0; i < 3; i++) {
    const actual = Geography.dateParts(new Date(at), zone);
    at += wall - asUTC(actual, Number(actual.hour) % 24, +actual.minute);
  }
  return at;
}

function plan(rows, config, days, from, until, hasVideo) {
  if (!rows?.length || !days.length) return [];
  validate(rows);
  const occupied = new Set();
  const candidates = [];
  const reserve = (at) => { if (Number.isFinite(at)) occupied.add(Math.floor(at / MINUTE)); };
  for (const { date, data } of days) {
    const zone = data.location?.effectiveTimeZone || data.location?.timeZone || config.location?.timeZone;
    const times = new Map((data.prayers || []).filter(prayer => prayer.time)
      .map(prayer => [prayer.id, Math.floor(+new Date(prayer.time) / MINUTE) * MINUTE]));
    for (const id of Policy.PRAYERS) {
      const at = times.get(id);
      if (Policy.prayerAllowed(config, id, data.isFriday)) reserve(at);
      const pre = Policy.prePrayer(config, id, data.isFriday);
      if (pre.enabled) reserve(at - pre.minutes * MINUTE);
      if (config.screenLock?.enabled) {
        const lock = Policy.normalizeConfig(config).screenLock;
        for (let minutes = 0; minutes <= lock.minutesBeforeAdhan + lock.warningMinutes; minutes++)
          reserve(at - minutes * MINUTE);
      }
    }
    const due = (block, prayer, minutes) =>
      block.timingMode === 'fixed' || (block.timingMode == null && block.customTimeEnabled)
        ? fixedTime(date, zone, block.customTime)
        : times.get(block.afterPrayer || block.prayer || prayer) + (block.afterPrayerMinutes ?? block.minutesAfter ?? minutes) * MINUTE;
    const quran = config.quranWird || {};
    const mode = quran.notificationMode || 'both';
    if (['both', 'reading_only'].includes(mode)) reserve(due(quran.reading || {}, 'isha', quran.reading?.afterIshaMinutes ?? 30));
    if (['both', 'hifz_only'].includes(mode)) reserve(due(quran.hifz || {}, 'fajr', quran.hifz?.afterFajrMinutes ?? 30));
    const lesson = Policy.normalizeConfig(config).notifications.lessons;
    if (lesson.enabled && hasVideo) reserve(due(lesson, 'isha', 45));
    for (const row of rows) {
      if (row.mode === 'interval' || (row.type === 'video' && !hasVideo)) continue;
      const at = row.mode === 'fixed' ? fixedTime(date, zone, row.clock) : times.get(row.prayer) + row.offset * MINUTE;
      if (at >= row.start && at >= from - 180 * MINUTE && at < until)
        candidates.push({ row, at });
    }
  }
  for (const row of rows) {
    if (row.mode !== 'interval' || (row.type === 'video' && !hasVideo)) continue;
    const step = row.hours * 60 * MINUTE;
    const anchor = Math.ceil(row.start / MINUTE) * MINUTE;
    const first = Math.max(1, Math.ceil((from - 180 * MINUTE - anchor) / step));
    for (let at = anchor + first * step; at < until; at += step) candidates.push({ row, at });
  }
  candidates.sort((a, b) => a.at - b.at || a.row.id.localeCompare(b.row.id));
  const result = [];
  for (const { row, at } of candidates) {
    let slot = Math.floor(at / MINUTE);
    while (occupied.has(slot) || occupied.has(slot - 1) || occupied.has(slot + 1)) slot++;
    occupied.add(slot);
    const time = slot * MINUTE;
    if (time >= from && time < until) result.push({ id: row.id, type: row.type, time, durationSeconds: row.durationSeconds, ...TYPES[row.type] });
  }
  return result;
}

function unique(rows) {
  const signatures = new Set();
  return rows.filter(row => {
    const signature = JSON.stringify([row.type, row.mode, row.mode === 'interval' ? row.hours :
      row.mode === 'fixed' ? row.clock : [row.prayer, row.offset]]);
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    return true;
  });
}

module.exports = { validate, plan, unique };

