const fs = require('fs'),
  path = require('path'),
  Geography = require('./prayer-times-engine');
class CityPrayerCache {
  constructor(storage) {
    this.storage = storage;
    this.file = path.join(storage.dataDir, 'city-prayer-cache.json');
  }
  read() {
    return this.storage.readJsonSafe(this.file, { cities: {} });
  }
  key(location, date) {
    return Geography.locationKey(location) + ':' + Geography.dateKey(date, location.timeZone);
  }
  remember(config, date = new Date()) {
    const location = config.location;
    if (!location?.timeZone) return;
    const db = this.read(),
      key = this.key(location, date);
    db.cities[key] = {
      location,
      adjustments: config.prayerAdjustments,
      officialSync: config.officialSync,
      savedAt: new Date().toISOString(),
    };
    const cutoff = Date.now() - 35 * 86400000;
    for (const [k, v] of Object.entries(db.cities))
      if (new Date(v.savedAt).getTime() < cutoff) delete db.cities[k];
    if (!this.storage.writeJsonSafe(this.file, db)) throw Error('تعذر حفظ مواقيت المدينة السابقة.');
  }
  restore(location, date = new Date()) {
    const row = this.read().cities[this.key(location, date)];
    if (!row) return null;
    return { prayerAdjustments: row.adjustments, officialSync: row.officialSync };
  }
}
module.exports = CityPrayerCache;
