const fs = require('fs');
const path = require('path');
const Geography = require('./prayer-times-engine');
const FIELDS = {
  juz: 'juzNumber',
  hizb: 'hizbNumber',
  rub: 'rubNumber',
  surah: 'surahNumber',
  page: 'pageNumber',
};
const LABELS = { juz: 'الجزء', hizb: 'الحزب', rub: 'الربع', surah: 'سورة', page: 'صفحة' };
const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.trunc(Number(n)) || min));
class QuranEngine {
  constructor(storage, baseDir) {
    this.storage = storage;
    this.baseDir = baseDir;
    this.datasets = new Map();
    this.geography = new Geography(storage, baseDir);
  }
  getSettings(raw = this.storage.getConfig().quranWird || {}) {
    const normalize = (block = {}) => {
      const timingMode = block.timingMode || (block.customTimeEnabled ? 'fixed' : 'prayer');
      if (!['fixed', 'prayer'].includes(timingMode))
        throw Error('طريقة توقيت ورد القرآن غير صالحة.');
      if (timingMode === 'fixed' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(block.customTime || ''))
        throw Error('يرجى اختيار ساعة صحيحة لإشعار الورد.');
      return { ...block, timingMode, customTimeEnabled: timingMode === 'fixed' };
    };
    return {
      ...raw,
      riwaya: raw.riwaya || 'hafs',
      reading: normalize(raw.reading),
      hifz: normalize(raw.hifz),
    };
  }
  getMetadata(riwaya = this.getSettings().riwaya) {
    if (!['hafs', 'warsh'].includes(riwaya)) throw Error('الرواية المختارة غير مدعومة.');
    if (!this.datasets.has(riwaya)) {
      const file = path.join(this.baseDir, 'data', 'quran-meta-' + riwaya + '.json');
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        throw Error('تعذر قراءة بيانات رواية ' + riwaya + ': ' + error.message);
      }
      if (data.schemaVersion !== 2 || data.riwaya !== riwaya || data.surahs?.length !== 114)
        throw Error('بيانات الرواية غير مكتملة؛ لم تُستخدم رواية أخرى بدلاً منها.');
      for (const [unit, total] of Object.entries({ juz: 30, hizb: 60, rub: 240, surah: 114 })) {
        const rows = data.units?.[unit];
        if (rows?.length !== total) throw Error('حدود ' + unit + ' غير مكتملة.');
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (
            row.number !== i + 1 ||
            !row.start?.text ||
            !row.end?.text ||
            row.start.verseIndex > row.end.verseIndex ||
            (i && row.start.verseIndex !== rows[i - 1].end.verseIndex + 1)
          )
            throw Error('تعارض في حدود الورد؛ يرجى مراجعة ملف الرواية.');
        }
      }
      this.datasets.set(riwaya, data);
    }
    return this.datasets.get(riwaya);
  }
  get metadata() {
    return this.getMetadata();
  }
  validateSettings(raw) {
    const settings = this.getSettings(raw),
      metadata = this.getMetadata(settings.riwaya);
    for (const kind of ['reading', 'hifz']) {
      const block = settings[kind],
        unit = block.unit || 'juz',
        total = metadata.units[unit]?.length;
      if (!total) throw Error('وحدة الورد غير مدعومة.');
      if (
        block.amount != null &&
        (!Number.isInteger(Number(block.amount)) || block.amount < 1 || block.amount > total)
      )
        throw Error('مقدار الورد خارج الحدود المتاحة.');
      if (kind === 'hifz') {
        for (const key of ['rangeStart', 'rangeEnd'])
          if (
            block[key] != null &&
            (!Number.isInteger(Number(block[key])) || block[key] < 1 || block[key] > total)
          )
            throw Error('نطاق الحفظ خارج حدود الوحدة المختارة.');
        if (Number(block.rangeEnd) < Number(block.rangeStart))
          throw Error('يجب ألا تسبق نهاية الحفظ بدايته.');
      }
      const minutes =
        block.afterPrayerMinutes ??
        block[kind === 'reading' ? 'afterIshaMinutes' : 'afterFajrMinutes'];
      if (
        block.afterPrayer &&
        !['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(block.afterPrayer)
      )
        throw Error('اختر صلاة صحيحة لموعد الورد.');
      if (
        block.timingMode === 'prayer' &&
        minutes != null &&
        (!Number.isInteger(Number(minutes)) || minutes < 0 || minutes > 240)
      )
        throw Error('اختر مدة صحيحة بين صفر و240 دقيقة.');
    }
    if (
      settings.notificationMode &&
      !['both', 'reading_only', 'hifz_only', 'none'].includes(settings.notificationMode)
    )
      throw Error('خيار إشعارات الورد غير صالح.');
    return settings;
  }
  getSurahByNumber(number) {
    const surah = this.metadata.surahs.find((s) => s.number === Number(number));
    if (!surah) throw Error('رقم السورة غير صالح.');
    return surah;
  }
  getTodayDateString() {
    return Geography.dateKey(
      new Date(),
      this.geography.normalizeLocation(this.storage.getConfig().location || {}).timeZone,
    );
  }
  limits(unit, isHifz, block = {}) {
    const total = this.metadata.units[unit]?.length;
    if (!total) throw Error('وحدة الورد غير مدعومة.');
    const defaultStart = isHifz ? { juz: 29, hizb: 58, rub: 230, surah: 78, page: 582 }[unit] : 1;
    const min = isHifz ? clamp(block.rangeStart ?? defaultStart, 1, total) : 1;
    const max = isHifz ? clamp(block.rangeEnd ?? total, min, total) : total;
    return { min, max, total };
  }
  assignment(unit, start, end) {
    if (unit === 'surah') {
      const a = this.getSurahByNumber(start),
        b = this.getSurahByNumber(end);
      return start === end ? 'سورة ' + a.name : 'من سورة ' + a.name + ' إلى سورة ' + b.name;
    }
    return start === end
      ? (unit === 'page' ? 'صفحة رقم ' : LABELS[unit] + ' رقم ') + start
      : 'من ' + LABELS[unit] + ' ' + start + ' إلى ' + LABELS[unit] + ' ' + end;
  }
  formatWirdAssignment(block = {}, isHifz = false) {
    const unit = block.unit || 'juz',
      { min, max, total } = this.limits(unit, isHifz, block),
      amount = clamp(block.amount || 1, 1, total);
    let start = clamp(block.currentPosition?.[FIELDS[unit]] ?? min, min, max),
      random = null;
    if (!isHifz && block.mode === 'random') {
      const old = block.randomDailyWird,
        riwaya = this.getSettings().riwaya;
      random =
        old &&
        old.date === this.getTodayDateString() &&
        old.unit === unit &&
        old.amount === amount &&
        old.riwaya === riwaya &&
        Number.isInteger(old.startNumber) &&
        old.startNumber >= 1 &&
        old.startNumber <= Math.max(1, total - amount + 1)
          ? old
          : this.generateRandomWirdData(unit, amount);
      start = random.startNumber;
      if (random !== old) {
        const qw = this.storage.getConfig().quranWird || {};
        this.storage.saveConfig({
          quranWird: { ...qw, reading: { ...qw.reading, randomDailyWird: random } },
        });
      }
    }
    const end = Math.min(max, start + amount - 1),
      rows = this.metadata.units[unit];
    const rangeDescription = isHifz
      ? unit === 'surah'
        ? 'نطاق الحفظ المحدد: من سورة ' +
          this.getSurahByNumber(min).name +
          ' إلى سورة ' +
          this.getSurahByNumber(max).name
        : 'نطاق الحفظ المحدد: من ' + LABELS[unit] + ' ' + min + ' إلى ' + LABELS[unit] + ' ' + max
      : random
        ? 'نمط تجديد يومي عشوائي'
        : 'ختمة تلاوة مستمرة (القرآن الكريم كاملاً)';
    return {
      unit,
      amount,
      mode: block.mode || 'sequential',
      unitLabel: LABELS[unit],
      currentAssignment: this.assignment(unit, start, end),
      rangeDescription,
      position: { ...block.currentPosition, [FIELDS[unit]]: start },
      startNumber: start,
      endNumber: end,
      boundaries: { start: rows[start - 1].start, end: rows[end - 1].end },
      riwaya: this.metadata.riwaya,
      progress: {
        current: start,
        min,
        max,
        percentage: Math.round(((start - min) / (max - min + 1)) * 100),
      },
    };
  }
  generateRandomWirdData(unit = 'juz', amount = 1) {
    const { total } = this.limits(unit, false);
    amount = clamp(amount, 1, total);
    const startNumber = Math.floor(Math.random() * Math.max(1, total - amount + 1)) + 1,
      endNumber = Math.min(total, startNumber + amount - 1);
    return {
      date: this.getTodayDateString(),
      riwaya: this.metadata.riwaya,
      unit,
      amount,
      startNumber,
      endNumber,
      unitLabel: LABELS[unit],
      assignment: this.assignment(unit, startNumber, endNumber),
    };
  }
  rollRandomReadingWird() {
    const qw = this.storage.getConfig().quranWird || {},
      reading = qw.reading || {};
    const randomDailyWird = this.generateRandomWirdData(reading.unit || 'juz', reading.amount || 1);
    this.storage.saveConfig({
      quranWird: { ...qw, reading: { ...reading, mode: 'random', randomDailyWird } },
    });
    return this.getFullStatus();
  }
  advanceWirdProgress(type = 'reading') {
    if (!['reading', 'hifz'].includes(type)) throw Error('نوع الورد غير صالح.');
    const qw = structuredClone(this.storage.getConfig().quranWird || {}),
      target = qw[type] || {};
    if (type === 'reading' && target.mode === 'random') return this.rollRandomReadingWird();
    const summary = this.formatWirdAssignment(target, type === 'hifz'),
      { min, max } = this.limits(summary.unit, type === 'hifz', target);
    const next = summary.endNumber >= max ? min : summary.endNumber + 1;
    qw[type] = {
      ...target,
      currentPosition: { ...target.currentPosition, [FIELDS[summary.unit]]: next },
    };
    this.storage.saveConfig({ quranWird: qw });
    return this.getFullStatus();
  }

  computeNotificationSchedules(prayerData) {
    const config = this.storage.getConfig();
    const qw = this.getSettings();
    const mode = qw.notificationMode || 'both';

    const result = { mode };
    const names = {
      fajr: 'الفجر',
      dhuhr: 'الظهر',
      asr: 'العصر',
      maghrib: 'المغرب',
      isha: 'العشاء',
    };
    for (const kind of ['reading', 'hifz']) {
      const block = qw[kind],
        fixed = block.timingMode === 'fixed';
      const prayerId = block.afterPrayer || (kind === 'reading' ? 'isha' : 'fajr');
      const prayer = prayerData?.prayers?.find((p) => p.id === prayerId);
      const offset = Number(
        block.afterPrayerMinutes ??
          block[kind === 'reading' ? 'afterIshaMinutes' : 'afterFajrMinutes'] ??
          30,
      );
      const due =
        !fixed && prayer?.time
          ? Math.floor(new Date(prayer.time).getTime() / 60000) * 60000 + offset * 60000
          : null;
      const clock = fixed
        ? block.customTime
        : due != null
          ? Geography.formatTime(
              new Date(due),
              prayerData?.location?.timeZone || config.location?.timeZone,
            )
          : null;
      result[kind + 'Enabled'] =
        (mode === 'both' || mode === kind + '_only') && (fixed || due != null);
      result[kind + 'NotificationTime'] = clock;
      result[kind + 'NotificationAt'] = due;
      result[kind + 'TimingDescription'] = !result[kind + 'Enabled']
        ? 'إشعار الورد متوقف'
        : fixed
          ? `موعد مخصص (${clock})`
          : `بعد صلاة ${names[prayerId]} بـ ${offset} دقيقة (${clock})`;
    }
    return result;
  }

  getFullStatus(prayerData = null) {
    const settings = this.getSettings(),
      metadata = this.metadata;
    const readingSummary = this.formatWirdAssignment(settings.reading),
      hifzSummary = this.formatWirdAssignment(settings.hifz, true);
    return {
      settings: {
        ...settings,
        reading: {
          ...settings.reading,
          randomDailyWird: this.storage.getConfig().quranWird?.reading?.randomDailyWird,
        },
      },
      riwaya: metadata.riwaya,
      riwayaTitle: metadata.title,
      readingSummary,
      hifzSummary,
      schedules: this.computeNotificationSchedules(prayerData),
      surahs: metadata.surahs,
      totalJuzs: 30,
      totalHizbs: 60,
      totalRubs: 240,
      totalPages: metadata.totalPages,
    };
  }
}
module.exports = QuranEngine;
