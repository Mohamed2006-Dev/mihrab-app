const Geography = require('./prayer-times-engine');
const { allowed } = require('./resource-engine');

/** One verified timetable per place, method and local calendar day. */
class PrayerAutomation {
  constructor({storage, prayerEngine, onUpdated = () => {}, onError = () => {}, online = () => true}) {
    Object.assign(this, {storage, prayerEngine, onUpdated, onError, online});
    this.inflight = null;
    this.retryAfter = new Map();
  }
  enabled(config = this.storage.getConfig()) {
    return (config.automation?.verifyPrayerTimes ?? config.officialSync?.enabled !== false)
      && allowed(config, 'prayer') && this.online();
  }
  key(now) {
    const loc = this.prayerEngine.getLocation();
    return Geography.locationKey(loc) + ':' + Geography.dateKey(now, loc.timeZone);
  }
  valid(report, now) {
    const loc = this.prayerEngine.getLocation();
    return report?.autoApplied && report.locationKey === Geography.locationKey(loc)
      && report.dateKey === Geography.dateKey(now, loc.timeZone)
      && ['verified_online','verified_cached','alternative_updated'].includes(report.status);
  }
  async tick(now = new Date(), {retry = false} = {}) {
    const config = this.storage.getConfig();
    if (!this.enabled(config)) return null;
    const key = this.key(now);
    if (this.inflight) return this.inflight;
    if (this.valid(config.officialSync?.lastSuccessfulReport, now)) return null;
    const cached = this.prayerEngine.restoreLocationSettings(this.prayerEngine.getLocation(), now);
    if (this.valid(cached?.officialSync?.lastSuccessfulReport, now)) {
      // Restore the daily provider record only; never replace manual user offsets.
      this.storage.saveConfig({officialSync:{...config.officialSync,lastSuccessfulReport:cached.officialSync.lastSuccessfulReport,lastDiscrepancyReport:cached.officialSync.lastSuccessfulReport,lastSyncTime:cached.officialSync.lastSyncTime}});
      await this.onUpdated(cached.officialSync.lastSuccessfulReport);
      return cached.officialSync.lastSuccessfulReport;
    }
    if (!retry && Date.now() < (this.retryAfter.get(key) || 0)) return null;
    this.retryAfter.set(key, Date.now() + 10 * 60000);
    if (this.retryAfter.size > 30) this.retryAfter = new Map([[key, Date.now()+10*60000]]);
    this.inflight = (async () => {
      try {
        const report = await this.prayerEngine.verifyWithOfficialAwqafApi({date:now,origin:'automatic',bypassCache:false,throwOnError:true});
        if (this.key(now) === key && this.valid(report, now) && this.enabled()) await this.onUpdated(report);
        return report;
      } catch (error) { this.onError(error); return null; }
      finally { this.inflight = null; }
    })();
    return this.inflight;
  }
}
module.exports = PrayerAutomation;
