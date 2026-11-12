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
      // Keep a full range on the wire for older linked clients.
      if (kind === 'hifz') Object.assign(block, { rangeStart: 1, rangeEnd: total });
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
  limits(unit, metadata = this.metadata) {
    const total = metadata.units[unit]?.length;
    if (!total) throw Error('وحدة الورد غير مدعومة.');
    return { min: 1, max: total, total };
  }
  assignment(unit, start, end, metadata = this.metadata) {
    if (unit === 'surah') {
      const a = metadata.surahs[start - 1],
        b = metadata.surahs[end - 1];
      return start === end ? 'سورة ' + a.name : 'من سورة ' + a.name + ' إلى سورة ' + b.name;
    }
    return start === end
      ? (unit === 'page' ? 'صفحة رقم ' : LABELS[unit] + ' رقم ') + start
      : 'من ' + LABELS[unit] + ' ' + start + ' إلى ' + LABELS[unit] + ' ' + end;
  }
  formatWirdAssignment(block = {}, isHifz = false, metadata = this.metadata) {
    const unit = block.unit || 'juz';
    const { min, max, total } = this.limits(unit, metadata);
    const amount = clamp(block.amount || 1, 1, max - min + 1);
    const maxStart = max - amount + 1;
    // Sequential assignments may have a shorter last portion after advancing.
    let start = clamp(block.currentPosition?.[FIELDS[unit]] ?? min, min, max),
      random = null;
    if (!isHifz && block.mode === 'random') {
      const old = block.randomDailyWird,
        riwaya = metadata.riwaya;
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
          : this.generateRandomWirdData(unit, amount, metadata);
      start = random.startNumber;
      if (random !== old && metadata.riwaya === this.getSettings().riwaya) {
        const qw = this.storage.getConfig().quranWird || {};
        this.storage.saveConfig({
          quranWird: { ...qw, reading: { ...qw.reading, randomDailyWird: random } },
        });
      }
    }
    const end = Math.min(max, start + amount - 1);
    const rows = metadata.units[unit];
    const mark = this.bookmarkPoint(metadata, block.bookmark);
    const bookmark = mark && mark.verseIndex >= rows[start - 1].start.verseIndex &&
      mark.verseIndex <= rows[end - 1].end.verseIndex ? mark : null;
    const markUnit = bookmark ? rows[this.unitAt(metadata, unit, bookmark.verseIndex) - 1] : null;
    const rangeDescription = isHifz ? 'ورد الحفظ والمراجعة (القرآن الكريم كاملاً)'
      : random ? 'نمط تجديد يومي عشوائي' : 'ختمة تلاوة مستمرة (القرآن الكريم كاملاً)';
    return {
      unit,
      amount,
      mode: block.mode || 'sequential',
      unitLabel: LABELS[unit],
      currentAssignment: this.assignment(unit, start, end, metadata),
      maxStart,
      bookmark,
      rangeDescription,
      position: { ...block.currentPosition, [FIELDS[unit]]: start },
      startNumber: start,
      endNumber: end,
      boundaries: { start: rows[start - 1].start, end: rows[end - 1].end },
      riwaya: metadata.riwaya,
      progress: {
        current: start,
        min,
        max,
        startPercentage: (start - 1) * 100 / total,
        endPercentage: end * 100 / total,
        bookmarkPercentage: markUnit ? (
          markUnit.number - 1 + (bookmark.verseIndex - markUnit.start.verseIndex + 0.5) /
            (markUnit.end.verseIndex - markUnit.start.verseIndex + 1)
        ) * 100 / total : null,
      },
    };
  }
  generateRandomWirdData(unit = 'juz', amount = 1, metadata = this.metadata) {
    const { total } = this.limits(unit, metadata);
    amount = clamp(amount, 1, total);
    const start = Math.floor(Math.random() * (total - amount + 1)) + 1;
    return this.randomAssignment(unit, amount, start, metadata);
  }
  randomAssignment(unit, amount, startNumber, metadata = this.metadata) {
    const endNumber = startNumber + amount - 1;
    return {
      date: this.getTodayDateString(), riwaya: metadata.riwaya, unit, amount, startNumber, endNumber,
      unitLabel: LABELS[unit], assignment: this.assignment(unit, startNumber, endNumber, metadata),
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
  advanceWirdProgress(type = 'reading', expected = null) {
    if (!['reading', 'hifz'].includes(type)) throw Error('نوع الورد غير صالح.');
    const qw = structuredClone(this.storage.getConfig().quranWird || {}),
      target = qw[type] || {};
    const summary = this.formatWirdAssignment(target, type === 'hifz');
    if (expected && ['unit', 'startNumber', 'endNumber', 'riwaya'].some(key => expected[key] !== summary[key]))
      throw Error('تغيّر نطاق الورد. أغلق المصحف وافتح الورد الحالي من جديد.');
    if (type === 'reading' && target.mode === 'random') {
      this.storage.saveConfig({ quranWird: { reading: { bookmark: null,
        randomDailyWird: this.generateRandomWirdData(summary.unit, summary.amount) } } });
      return this.getFullStatus();
    }
    const { min, max } = this.limits(summary.unit);
    const next = summary.endNumber >= max ? min : summary.endNumber + 1;
    qw[type] = {
      ...target,
      bookmark: summary.endNumber >= max ? null : target.bookmark,
      currentPosition: { ...target.currentPosition, [FIELDS[summary.unit]]: next },
    };
    this.storage.saveConfig({ quranWird: qw });
    return this.getFullStatus();
  }


  unitAt(metadata, unit, verseIndex) {
    return metadata.units[unit].find(row => row.start.verseIndex <= verseIndex &&
      row.end.verseIndex >= verseIndex)?.number;
  }

  bookmarkPoint(metadata, bookmark) {
    if (bookmark?.riwaya !== metadata.riwaya) return null;
    const surah = metadata.units.surah[bookmark.surah - 1];
    if (!surah || !Number.isInteger(bookmark.ayah) || bookmark.ayah < 1) return null;
    const verseIndex = surah.start.verseIndex + bookmark.ayah - 1;
    if (verseIndex > surah.end.verseIndex) return null;
    return { ...bookmark, verseIndex, surahName: surah.start.surahName };
  }

  convertSettings(previous, next) {
    const before = this.getSettings(previous);
    const after = this.getSettings(next);
    const source = this.getMetadata(before.riwaya);
    const target = this.getMetadata(after.riwaya);
    const rank = { juz: 0, hizb: 1, rub: 2, page: 3 };
    const translate = index => {
      if (source === target) return index;
      const number = this.unitAt(source, 'surah', index);
      const oldSurah = source.units.surah[number - 1];
      const newSurah = target.units.surah[number - 1];
      return Math.min(newSurah.end.verseIndex, newSurah.start.verseIndex + index - oldSurah.start.verseIndex);
    };
    for (const kind of ['reading', 'hifz']) {
      const old = before[kind];
      const block = after[kind];
      const oldUnit = old.unit || 'juz';
      const newUnit = block.unit || 'juz';
      if (!target.units[newUnit]) throw Error('وحدة الورد غير مدعومة.');
      const isHifz = kind === 'hifz';
      if (oldUnit === newUnit) {
        const limitsChanged = block.amount !== old.amount;
        if (limitsChanged) {
          const { min, max } = this.limits(newUnit, target);
          const amount = clamp(block.amount, 1, max - min + 1);
          const start = clamp(block.currentPosition?.[FIELDS[newUnit]] ?? min, min, max - amount + 1);
          block.currentPosition = { ...block.currentPosition, [FIELDS[newUnit]]: start };
        }
        continue;
      }
      const summary = this.formatWirdAssignment(old, isHifz, source);
      const useBookmark = oldUnit === 'surah' || newUnit === 'surah' || rank[newUnit] > rank[oldUnit];
      const anchor = useBookmark && summary.bookmark ? summary.bookmark.verseIndex : summary.boundaries.start.verseIndex;
      const { min, max } = this.limits(newUnit, target);
      block.amount = clamp(block.amount, 1, max - min + 1);
      const start = clamp(this.unitAt(target, newUnit, translate(anchor)), min, max - block.amount + 1);
      block.currentPosition = { ...block.currentPosition, [FIELDS[newUnit]]: start };
      if (kind === 'reading' && block.mode === 'random') {
        block.randomDailyWird = this.randomAssignment(newUnit, block.amount, start, target);
      }
    }
    return after;
  }

  saveBookmark(kind, bookmark, migrate = false) {
    if (!['reading', 'hifz'].includes(kind)) throw Error('نوع الورد غير صالح.');
    const settings = this.getSettings();
    if (migrate && settings[kind].bookmark !== undefined) return;
    const { riwaya, surah, ayah, rangeStart, rangeEnd, spreadStart } = bookmark || {};
    const metadata = this.getMetadata(riwaya);
    if (!['hafs', 'warsh'].includes(riwaya) ||
        !this.bookmarkPoint(metadata, { riwaya, surah, ayah }))
      throw Error('موضع الآية غير صالح.');
    const number = value => Number.isInteger(value) && value >= 0 && value < 6236 ? value : null;
    this.storage.saveConfig({ quranWird: { [kind]: {
      bookmark: { riwaya, surah: Number(surah), ayah, rangeStart: number(rangeStart),
        rangeEnd: number(rangeEnd), spreadStart: number(spreadStart) },
    } } });
  }

  setPosition(kind, requested) {
    if (!['reading', 'hifz'].includes(kind)) throw Error('نوع الورد غير صالح.');
    const settings = this.getSettings();
    const block = settings[kind];
    const summary = this.formatWirdAssignment(block, kind === 'hifz');
    const { min, max } = summary.progress;
    if (!Number.isInteger(requested) || requested < min || requested > max)
      throw Error(`أدخل رقمًا صحيحًا بين ${min} و${max}.`);
    const start = Math.min(requested, summary.maxStart);
    const patch = { currentPosition: { [FIELDS[summary.unit]]: start } };
    if (kind === 'reading' && block.mode === 'random')
      patch.randomDailyWird = this.randomAssignment(summary.unit, summary.amount, start);
    this.storage.saveConfig({ quranWird: { [kind]: patch } });
    return start !== requested ? `الحد الأعلى للبداية هو ${start}. قلّل مقدار الورد لتبدأ بعده.` : '';
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
