const { test } = require('node:test');
const assert = require('node:assert/strict');
const Display = require('./src/ui/prayer-display');
const at = (value) => new Date('2026-11-02T' + value + 'Z');
const prayers = [
  ['fajr', '05:00:00'],
  ['sunrise', '06:30:00'],
  ['dhuhr', '12:00:00'],
  ['asr', '15:00:00'],
  ['maghrib', '18:00:00'],
  ['isha', '19:30:00'],
].map(([id, time]) => ({ id, name: id, time: at(time) }));
const data = { prayers, nextPrayer: prayers[3] };
test('prayer presentation changes from countdown to elapsed time at the exact adhan', () => {
  assert.equal(Display.select(data, at('11:59:59')).mode, 'upcoming');
  const current = Display.select(data, at('12:00:00'));
  assert.equal(current.mode, 'elapsed');
  assert.equal(current.prayer.id, 'dhuhr');
  assert.equal(current.seconds, 0);
  assert.equal(Display.select(data, at('12:19:59')).seconds, 1199);
});
test('the twenty-minute boundary switches immediately to the real next prayer', () => {
  const next = Display.select(data, at('12:20:00'));
  assert.equal(next.mode, 'upcoming');
  assert.equal(next.prayer.id, 'asr');
  assert.equal(next.seconds, 9600);
  assert.equal(data.nextPrayer, prayers[3]);
  assert.equal(Display.clock(1199), '00:19:59');
});
test('sunrise never starts an elapsed-adhan window and stale nextPrayer is ignored', () => {
  assert.equal(
    Display.select({ ...data, nextPrayer: prayers[0] }, at('06:30:01')).prayer.id,
    'dhuhr',
  );
  assert.equal(
    Display.select({ ...data, nextPrayer: prayers[2] }, at('12:25:00')).prayer.id,
    'asr',
  );
});
test('an isha near midnight remains visible across a date change without replacing nextPrayer', () => {
  const previousPrayer = { id: 'isha', name: 'العشاء', time: new Date('2026-11-01T23:55:00Z') };
  const next = Display.select({ ...data, previousPrayer, nextPrayer: prayers[0] }, at('00:10:00'));
  assert.equal(next.mode, 'elapsed');
  assert.equal(next.seconds, 900);
  assert.equal(
    Display.select({ ...data, previousPrayer, nextPrayer: prayers[0] }, at('00:15:00')).prayer.id,
    'fajr',
  );
});
test('Friday and invalid/missing entries retain the correct prayer identity', () => {
  const friday = { ...prayers[2], name: 'صلاة الجمعة', isFridaySpecial: true };
  assert.equal(
    Display.select(
      {
        prayers: [friday, { id: 'sunrise', time: at('12:01:00') }, { id: 'invalid', time: 'bad' }],
      },
      at('12:05:00'),
    ).prayer.name,
    'صلاة الجمعة',
  );
  assert.equal(Display.select(null), null);
  assert.equal(Display.select({ prayers: [{ id: 'bad', time: null }] }), null);
});
test('engine supplies a previous prayer before dawn while leaving the next-prayer result intact', () => {
  const Prayer = require('./src/engines/prayer-engine');
  const config = {
    location: {
      city: 'مكة المكرمة',
      countryCode: 'SA',
      lat: 21.4225,
      lng: 39.8262,
      timeZone: 'Asia/Riyadh',
      calculationMethod: 'UmmAlQura',
    },
    prayerAdjustments: {},
  };
  const engine = new Prayer({ getConfig: () => config });
  const result = engine.calculateLocalPrayerTimes(new Date('2026-11-02T00:10:00+03:00'));
  assert.equal(result.previousPrayer.id, 'isha');
  assert(result.previousPrayer.time < result.prayers[0].time);
  assert.equal(result.nextPrayer.id, 'fajr');
  assert.deepEqual(
    result.nextPrayer,
    engine.computeNextPrayer(result.prayers, new Date('2026-11-02T00:10:00+03:00')),
  );
});
