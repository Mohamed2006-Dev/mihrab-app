// Shared policy for persisted settings, scheduling and dismissing disabled notices.
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const IDS = [...PRAYERS, 'friday'];
const number = (value, fallback, min, max) =>
  Math.min(
    max,
    Math.max(min, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback),
  );
function normalizeConfig(config) {
  const n = config.notifications || {},
    lock = { ...config.screenLock },
    lessons = n.lessons || {};
  delete lock.lockDurationMinutes;
  const overrides = Object.fromEntries(
    PRAYERS.map((id) => [
      id,
      {
        enabled: n.prePrayerOverrides?.[id]?.enabled !== false,
        minutes:
          n.prePrayerOverrides?.[id]?.minutes == null
            ? null
            : number(n.prePrayerOverrides[id].minutes, 15, 1, 240),
      },
    ]),
  );
  return {
    ...config,
    notifications: {
      ...n,
      prayerEnabled: n.prayerEnabled !== false,
      prayers: Object.fromEntries(IDS.map((id) => [id, n.prayers?.[id] !== false])),
      prePrayerEnabled: n.prePrayerEnabled !== false,
      prePrayerMinutes: number(n.prePrayerMinutes, 15, 1, 240),
      prePrayerOverrides: overrides,
      fridayPrePrayerEnabled: n.fridayPrePrayerEnabled !== false,
      fridayPrePrayerMinutes: number(n.fridayPrePrayerMinutes, 60, 30, 240),
      lessons: {
        enabled: lessons.enabled !== false,
        timingMode: lessons.timingMode || 'prayer',
        prayer: lessons.prayer || 'isha',
        minutesAfter: number(lessons.minutesAfter ?? n.dailyVideoAfterIshaMinutes, 45, 0, 240),
        customTime: lessons.customTime || '20:45',
      },
    },
    screenLock: {
      ...lock,
      minutesBeforeAdhan: number(lock.minutesBeforeAdhan, 15, 15, 120),
      warningMinutes: number(lock.warningMinutes, 1, 1, 60),
      snoozeMinutes: number(lock.snoozeMinutes, 3, 1, 10),
    },
  };
}
function validateConfig(config) {
  const check = (v, min, max, label) => {
    if (!Number.isInteger(Number(v)) || Number(v) < min || Number(v) > max)
      throw Error(label + `: اختر قيمة بين ${min} و${max}.`);
  };
  const n = config.notifications || {},
    l = config.screenLock || {};
  check(n.prePrayerMinutes, 1, 240, 'تنبيه الصلاة');
  check(n.fridayPrePrayerMinutes, 30, 240, 'تنبيه الجمعة');
  for (const id of PRAYERS)
    if (n.prePrayerOverrides?.[id]?.minutes != null)
      check(n.prePrayerOverrides[id].minutes, 1, 240, 'التنبيه المخصص');
  check(l.minutesBeforeAdhan, 15, 120, 'موعد شاشة التهيئة');
  check(l.warningMinutes, 1, 60, 'تنبيه شاشة التهيئة');
  check(l.snoozeMinutes, 1, 10, 'مدة التمديد');
  const lesson = n.lessons;
  if (lesson) {
    if (!['prayer', 'fixed'].includes(lesson.timingMode)) throw Error('اختر طريقة توقيت الدروس.');
    if (!PRAYERS.includes(lesson.prayer)) throw Error('اختر صلاة صحيحة لموعد الدروس.');
    if (lesson.timingMode === 'prayer') check(lesson.minutesAfter, 0, 240, 'موعد الدروس');
    if (lesson.timingMode === 'fixed' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(lesson.customTime))
      throw Error('اختر ساعة صحيحة لموعد الدروس.');
  }
}
function prayerKey(id, isFriday) {
  return id === 'dhuhr' && isFriday ? 'friday' : id;
}
function prayerAllowed(config, id, isFriday) {
  const n = config.notifications || {};
  return n.prayerEnabled !== false && n.prayers?.[prayerKey(id, isFriday)] !== false;
}
function prePrayer(config, id, isFriday) {
  const n = config.notifications || {},
    friday = prayerKey(id, isFriday) === 'friday',
    override = n.prePrayerOverrides?.[id];
  return {
    enabled:
      !config.screenLock?.enabled &&
      n.prePrayerEnabled !== false &&
      (friday ? n.fridayPrePrayerEnabled !== false : override?.enabled !== false),
    minutes: friday
      ? number(n.fridayPrePrayerMinutes, 60, 30, 240)
      : number(override?.minutes ?? n.prePrayerMinutes, 15, 1, 240),
  };
}
function allowsNotice(config, data, isFriday = false) {
  if (data.preview) return true;
  if (data.type === 'prayer_time') return prayerAllowed(config, data.prayerId, isFriday);
  if (data.type === 'pre_prayer') return prePrayer(config, data.prayerId, isFriday).enabled;
  if (data.type === 'lock_warning') return Boolean(config.screenLock?.enabled);
  if (data.type === 'daily_video')
    return (
      config.notifications?.lessons?.enabled !== false &&
      require('./resource-engine').allowed(config, 'youtube')
    );
  if (data.type === 'quran_reading')
    return ['both', 'reading_only'].includes(config.quranWird?.notificationMode || 'both');
  if (data.type === 'quran_hifz')
    return ['both', 'hifz_only'].includes(config.quranWird?.notificationMode || 'both');
  return true;
}
module.exports = {
  PRAYERS,
  normalizeConfig,
  validateConfig,
  prayerKey,
  prayerAllowed,
  prePrayer,
  allowsNotice,
};
