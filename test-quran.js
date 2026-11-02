const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const root = process.env.MIHRAB_TEST_ROOT || __dirname,
  Storage = require(path.join(root, 'src/engines/storage-engine')),
  Quran = require(path.join(root, 'src/engines/quran-engine'));
function fixture(t, riwaya = 'hafs') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-quran-'));
  t.after(() => {
    assert.equal(path.dirname(dir), os.tmpdir());
    assert(path.basename(dir).startsWith('mihrab-quran-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const storage = new Storage(root, dir);
  storage.saveConfig({
    quranWird: {
      riwaya,
      notificationMode: 'both',
      reading: {
        unit: 'juz',
        amount: 1,
        mode: 'sequential',
        afterPrayer: null,
        afterPrayerMinutes: null,
      },
      hifz: {
        unit: 'juz',
        amount: 1,
        rangeStart: 29,
        rangeEnd: 30,
        afterPrayer: null,
        afterPrayerMinutes: null,
      },
    },
  });
  return { storage, engine: new Quran(storage, root) };
}
test('both riwayat cover all verses continuously in juz/hizb/rub/surah units', (t) => {
  const { storage, engine } = fixture(t);
  for (const riwaya of ['hafs', 'warsh']) {
    storage.saveConfig({ quranWird: { riwaya } });
    const m = engine.getMetadata();
    assert.equal(m.totalVerses, riwaya === 'hafs' ? 6236 : 6214);
    for (const [unit, count] of Object.entries({ juz: 30, hizb: 60, rub: 240, surah: 114 })) {
      const rows = m.units[unit];
      assert.equal(rows.length, count);
      assert.equal(rows[0].start.verseIndex, 0);
      assert.equal(rows.at(-1).end.verseIndex, m.totalVerses - 1);
      for (let i = 0; i < count; i++) {
        const r = rows[i];
        assert(r.start.text && r.end.text);
        assert(r.end.ayah <= m.surahs[r.end.surahNumber - 1].ayahs);
        if (i) assert.equal(r.start.verseIndex, rows[i - 1].end.verseIndex + 1);
      }
    }
  }
});
test('Hafs and Warsh retain distinct verse numbering and Moroccan partition boundaries', (t) => {
  const { storage, engine } = fixture(t);
  const hafs = engine.metadata;
  assert.equal(hafs.units.rub[1].start.ayah, 26);
  storage.saveConfig({ quranWird: { riwaya: 'warsh' } });
  const warsh = engine.metadata;
  assert.equal(warsh.units.rub[1].start.ayah, 25);
  assert.equal(warsh.units.rub[2].start.ayah, 41);
  assert.notEqual(hafs.units.surah[0].start.text, warsh.units.surah[0].start.text);
  assert.equal(hafs.units.juz[1].start.ayah, 142);
  assert.equal(warsh.units.juz[1].start.ayah, 141);
});
test('each unit returns exact named start and end, with actual verse text', (t) => {
  const { engine } = fixture(t);
  for (const unit of ['juz', 'hizb', 'rub', 'surah']) {
    const summary = engine.formatWirdAssignment({
      unit,
      amount: 2,
      currentPosition: { juzNumber: 1, hizbNumber: 1, rubNumber: 1, surahNumber: 1 },
    });
    assert.equal(summary.startNumber, 1);
    assert.equal(summary.endNumber, 2);
    assert.equal(summary.boundaries.start.surahName, 'الفاتحة');
    assert(summary.boundaries.start.text && summary.boundaries.end.text);
    assert(summary.boundaries.end.verseIndex > summary.boundaries.start.verseIndex);
  }
});
test('the final batch stops at the Quran end and the next completion wraps cleanly', (t) => {
  const { storage, engine } = fixture(t);
  storage.saveConfig({
    quranWird: { reading: { unit: 'juz', amount: 3, currentPosition: { juzNumber: 29 } } },
  });
  const summary = engine.getFullStatus().readingSummary;
  assert.equal(summary.endNumber, 30);
  assert.equal(summary.boundaries.end.surahNumber, 114);
  assert.equal(engine.advanceWirdProgress('reading').readingSummary.startNumber, 1);
});
test('hifz progression respects its range and never changes reading progress', (t) => {
  const { storage, engine } = fixture(t);
  storage.saveConfig({
    quranWird: {
      reading: { currentPosition: { juzNumber: 7 } },
      hifz: { unit: 'juz', rangeStart: 29, rangeEnd: 30, currentPosition: { juzNumber: 30 } },
    },
  });
  const next = engine.advanceWirdProgress('hifz');
  assert.equal(next.hifzSummary.startNumber, 29);
  assert.equal(next.readingSummary.startNumber, 7);
});
test('random daily assignments are stable and regenerate when riwaya changes', (t) => {
  const { storage, engine } = fixture(t);
  storage.saveConfig({ quranWird: { reading: { mode: 'random', unit: 'rub', amount: 4 } } });
  const a = engine.getFullStatus().readingSummary,
    b = engine.getFullStatus().readingSummary;
  assert.equal(a.startNumber, b.startNumber);
  assert.equal(b.endNumber - b.startNumber + 1, 4);
  storage.saveConfig({ quranWird: { riwaya: 'warsh' } });
  const c = engine.getFullStatus();
  assert.equal(c.readingSummary.riwaya, 'warsh');
  assert.equal(c.settings.reading.randomDailyWird.riwaya, 'warsh');
});
test('manual random rotation always stays inside the selected unit', (t) => {
  const { engine } = fixture(t);
  for (const unit of ['juz', 'hizb', 'rub', 'surah'])
    for (let i = 0; i < 20; i++) {
      const r = engine.generateRandomWirdData(unit, 10);
      assert(r.startNumber >= 1);
      assert(r.endNumber <= engine.metadata.units[unit].length);
    }
});
test('new defaults use juz while legacy hizb/page positions remain readable', (t) => {
  const { storage, engine } = fixture(t);
  assert.equal(
    new Storage(root, storage.writableDir).getDefaultConfig().quranWird.reading.unit,
    'juz',
  );
  assert.equal(
    engine.formatWirdAssignment(
      {
        unit: 'hizb',
        amount: 1,
        currentPosition: { hizbNumber: 58 },
        rangeStart: 58,
        rangeEnd: 60,
      },
      true,
    ).currentAssignment,
    'الحزب رقم 58',
  );
  assert.equal(
    engine.formatWirdAssignment(
      {
        unit: 'page',
        amount: 2,
        currentPosition: { pageNumber: 582 },
        rangeStart: 582,
        rangeEnd: 604,
      },
      true,
    ).endNumber,
    583,
  );
});
test('fixed timing ignores prayer offsets; prayer timing ignores the fixed clock', (t) => {
  const { storage, engine } = fixture(t),
    at = new Date('2026-11-01T18:00:00Z'),
    data = {
      location: { timeZone: 'Etc/UTC' },
      prayers: [
        { id: 'isha', time: at },
        { id: 'fajr', time: new Date('2026-11-01T05:00:00Z') },
      ],
    };
  storage.saveConfig({
    quranWird: {
      reading: {
        timingMode: 'fixed',
        customTimeEnabled: false,
        customTime: '20:45',
        afterIshaMinutes: 90,
      },
      hifz: {
        timingMode: 'prayer',
        customTimeEnabled: true,
        customTime: '23:59',
        afterFajrMinutes: 25,
      },
    },
  });
  const s = engine.computeNotificationSchedules(data);
  assert.equal(s.readingNotificationTime, '20:45');
  assert.equal(s.hifzNotificationTime, '05:25');
  const settings = engine.getSettings();
  assert(settings.reading.customTimeEnabled);
  assert(!settings.hifz.customTimeEnabled);
});
test('missing prayer times disable relative notifications while fixed times remain valid', (t) => {
  const { storage, engine } = fixture(t);
  storage.saveConfig({
    quranWird: {
      reading: { timingMode: 'fixed', customTime: '20:45' },
      hifz: { timingMode: 'prayer' },
    },
  });
  const result = engine.computeNotificationSchedules({ prayers: [] });
  assert(result.readingEnabled);
  assert(!result.hifzEnabled);
});
test('invalid settings are rejected before persistence, including inactive versus active timing inputs', (t) => {
  const { engine } = fixture(t);
  for (const patch of [
    { riwaya: 'unknown' },
    { reading: { unit: 'wrong' } },
    { reading: { amount: 31 } },
    { hifz: { unit: 'juz', rangeStart: 30, rangeEnd: 29 } },
    { reading: { timingMode: 'fixed', customTime: '33:20' } },
    { reading: { timingMode: 'prayer', afterIshaMinutes: -1 } },
  ])
    assert.throws(() => engine.validateSettings(patch));
  assert.equal(
    engine.validateSettings({
      reading: { timingMode: 'fixed', customTime: '08:30', afterIshaMinutes: -1 },
    }).reading.timingMode,
    'fixed',
  );
  assert.throws(() => engine.advanceWirdProgress('invalid'));
});
