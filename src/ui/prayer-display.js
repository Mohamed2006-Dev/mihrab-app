/* Presentation only: notification scheduling always keeps the real nextPrayer. */
(function (scope) {
  const GRACE_MS = 20 * 60 * 1000;
  function select(data, now = Date.now()) {
    const at = Number(new Date(now));
    if (!data || !Number.isFinite(at)) return null;
    const prayers = [...(data.prayers || []), data.previousPrayer, data.nextPrayer].filter(
      (prayer) =>
        prayer &&
        prayer.id !== 'sunrise' &&
        prayer.isPrayer !== false &&
        prayer.time &&
        Number.isFinite(Number(new Date(prayer.time))),
    );
    const recent = prayers
      .filter((prayer) => Number(new Date(prayer.time)) <= at)
      .sort((a, b) => Number(new Date(b.time)) - Number(new Date(a.time)))[0];
    if (recent && at - Number(new Date(recent.time)) < GRACE_MS) {
      return {
        mode: 'elapsed',
        prayer: recent,
        seconds: Math.floor((at - Number(new Date(recent.time))) / 1000),
      };
    }
    const next = prayers
      .filter((prayer) => Number(new Date(prayer.time)) > at)
      .sort((a, b) => Number(new Date(a.time)) - Number(new Date(b.time)))[0];
    return next
      ? {
          mode: 'upcoming',
          prayer: next,
          seconds: Math.max(0, Math.floor((Number(new Date(next.time)) - at) / 1000)),
        }
      : null;
  }
  function clock(seconds) {
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }
  const api = { select, clock, GRACE_MS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.MihrabPrayerDisplay = api;
})(globalThis);
