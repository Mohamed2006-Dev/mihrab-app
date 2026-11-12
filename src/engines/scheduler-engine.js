const { allowed: networkAllowed } = require('./resource-engine');
const NoticePolicy = require('./notification-settings');
const Custom = require('./custom-reminders');
const Geography = require('./prayer-times-engine');
/** Scheduling uses the same local minute shown in the prayer cards. */
class SchedulerEngine {
  constructor({ storage, prayerEngine, hadithEngine, quranEngine, youtubeEngine, preparation, callbacks }) {
    Object.assign(this, { storage, prayerEngine, hadithEngine, quranEngine, youtubeEngine });
    this.callbacks = callbacks || {};
    this.preparation = preparation;
    this.preparationDelays = new Map();
    this.firedEventsToday = new Set();
    this.lastDateKey = '';
    this.lockPlans = new Map();
    this.prayerCache = new Map();
    this.quranScheduleCache = new Map();
    this.lastLockEnabled = null;
    this.lastNow = null;
    this.motivationalQuotes = [
      '«قم لصلاتك، عملك سينتظرك.. أما الوقت فإنه يمضي إلى الله»',
      '«أرحنا بها يا بلال — اجعل صلاتك واحة سكينة لقلبك وسط زحام العمل»',
      '«أول ما يحاسب به العبد يوم القيامة من عمله صلاته، فإن صلحت فقد أفلح وأنجح»',
      '«ما نقص وقتٌ اقتُطع للوقوف بين يدي الله، بل يبارك الله في بقية يومك»',
    ];
  }

  dayKey(date) {
    if (this.prayerEngine.getDateKey) return this.prayerEngine.getDateKey(date);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  displayedTime(time) {
    const date = new Date(time);
    date.setSeconds(0, 0);
    return date.getTime();
  }
  getRandomMotivationalQuote() {
    return this.motivationalQuotes[Math.floor(Math.random() * this.motivationalQuotes.length)];
  }

  invoke(name, payload) {
    try {
      const result = this.callbacks[name]?.(payload);
      if (result?.catch) result.catch((error) => this.reportError(error));
    } catch (error) {
      this.reportError(error);
    }
  }

  reportError(error) {
    if (this.callbacks.onError) this.callbacks.onError(error);
    else console.error('[Scheduler]', error);
  }

  prayerData(now, config) {
    const key = `${this.dayKey(now)}:${JSON.stringify([config.location, config.prayerAdjustments, config.officialSync?.lastSuccessfulReport])}`;
    if (!this.prayerCache.has(key)) {
      if (this.prayerCache.size > 3) this.prayerCache.clear();
      this.prayerCache.set(key, this.prayerEngine.calculateLocalPrayerTimes(now));
    }
    return this.prayerCache.get(key);
  }

  tick(now = new Date()) {
    this.lastNow = now;
    const nowMs = now.getTime();
    const dateKey = this.dayKey(now);
    if (this.lastDateKey !== dateKey) {
      this.firedEventsToday.clear();
      this.lockPlans.clear();
      this.preparationDelays.clear();
      this.lastDateKey = dateKey;
    }
    const config = this.storage.getConfig();
    const lockEnabled = Boolean(config.screenLock?.enabled);
    if (this.lastLockEnabled !== lockEnabled) {
      this.lockPlans.clear();
      for (const key of this.firedEventsToday) {
        if (key.startsWith('pre_prayer_') || key.startsWith('lock_'))
          this.firedEventsToday.delete(key);
      }
      this.lastLockEnabled = lockEnabled;
      this.invoke('onModeChanged', { lockEnabled });
    }
    const lockTiming = NoticePolicy.normalizeConfig(config).screenLock;
    const lockTimingKey = JSON.stringify([
      lockTiming.minutesBeforeAdhan,
      config.screenLock?.warningMinutes,
    ]);
    if (this.lastLockTimingKey !== lockTimingKey) {
      this.lastLockTimingKey = lockTimingKey;
      this.lockPlans.clear();
      for (const key of this.firedEventsToday)
        if (key.startsWith('lock_warn_')) this.firedEventsToday.delete(key);
    }
    const data = this.prayerData(now, config);
    const scheduleKey = `${dateKey}:${JSON.stringify([config.location, config.prayerAdjustments, config.officialSync?.lastSuccessfulReport])}`;
    if (this.lastScheduleKey !== scheduleKey) {
      this.lastScheduleKey = scheduleKey;
      this.lockPlans.clear();
      this.firedEventsToday.clear();
      this.invoke('onPrayerScheduleChanged', data);
    }
    const zone = data.location?.timeZone || config.location?.timeZone;
    const currentHm = Geography.formatTime(now, zone);
    const calendar = Geography.calendarDate(now, zone);

    for (const prayer of data.prayers.filter((prayer) => prayer.id !== 'sunrise' && prayer.time)) {
      const at = this.displayedTime(prayer.time);
      const id = `${dateKey}:${prayer.id}`;
      const adhanKey = `adhan_${prayer.id}_${dateKey}`;
      // Never round the difference: 12:59:30 is still before a 13:00 adhan.
      if (nowMs >= at && nowMs < at + 60000 && !this.firedEventsToday.has(adhanKey)) {
        this.firedEventsToday.add(adhanKey);
        let hadithState = null;
        try {
          hadithState = this.hadithEngine.getHadithForPrayer(`${prayer.id}_${dateKey}`, true);
        } catch (error) {
          this.reportError(error);
        }
        this.invoke('onPrayerTimeReached', {
          prayer: { ...prayer, time: new Date(at) },
          hadithState,
          notify: NoticePolicy.prayerAllowed(config, prayer.id, data.isFriday),
        });
      }
      if (nowMs >= at) continue;

      if (!lockEnabled) {
        const preference = NoticePolicy.prePrayer(config, prayer.id, data.isFriday);
        if (!preference.enabled) continue;
        const preMinutes = preference.minutes;
        const key = `pre_prayer_${prayer.id}_${dateKey}`;
        if (nowMs >= at - preMinutes * 60000 && !this.firedEventsToday.has(key)) {
          this.firedEventsToday.add(key);
          this.emitNotification({
            type: 'pre_prayer',
            prayerId: prayer.id,
            scheduleId: id,
            prayerName: prayer.name,
            prayerTime: new Date(at).toISOString(),
            playAudio: false,
            persistent: true,
            title: `اقترب موعد ${prayer.name}`,
            body: `موعد ${prayer.name} عند ${prayer.time12 || prayer.time24}. تهيأ بالوضوء والسكينة. يبقى هذا التنبيه حتى إغلاقه أو حلول الأذان.`,
          });
        }
      } else {
        const { minutesBeforeAdhan } = lockTiming;
        const initialAt = at - minutesBeforeAdhan * 60000;
        const preparationId = prayer.id + ':' + at;
        const recorded = this.preparation?.prayer(preparationId);
        if (recorded?.ended || this.firedEventsToday.has(`lock_activate_${prayer.id}_${dateKey}`)) continue;
        const delayedUntil = recorded?.delayedUntil ?? this.preparationDelays.get(preparationId);
        let plan = this.lockPlans.get(id);
        if (!plan || plan.initialAt !== initialAt) {
          plan = {
            id,
            preparationId,
            prayerAt: at,
            initialAt,
            lockAt: delayedUntil ? Math.max(initialAt, delayedUntil) : initialAt,
            canDelay: minutesBeforeAdhan > 10 && !delayedUntil,
            activated: false,
          };
          this.lockPlans.set(id, plan);
        }
        const warningKey = `lock_warn_${prayer.id}_${dateKey}`;
        if (
          !plan.activated &&
          nowMs >=
            plan.lockAt -
              Math.max(1, Math.min(60, Number(config.screenLock?.warningMinutes) || 1)) * 60000 &&
          nowMs < plan.lockAt &&
          !this.firedEventsToday.has(warningKey)
        ) {
          this.firedEventsToday.add(warningKey);
          this.triggerPreLockWarning(prayer, plan);
        }
        if (
          !plan.activated &&
          nowMs >= plan.lockAt &&
          nowMs < plan.lockAt + 60000 &&
          nowMs <= plan.prayerAt - 5 * 60000 + 1000
        ) {
          plan.activated = true;
          this.firedEventsToday.add(`lock_activate_${prayer.id}_${dateKey}`);
          this.triggerScreenLock(prayer, plan);
        }
      }
    }

    // Relative reminders retain their actual date when a prayer offset crosses midnight.
    const days = [data];
    if (Number(Geography.dateParts(now, zone).hour) < 4)
      days.push(this.prayerData(Geography.shiftDay(now, -1, zone), config));
    for (const [dayIndex, day] of days.entries()) {
      const quranKey = JSON.stringify([
        config.quranWird,
        day.prayers.map((p) => [p.id, p.time]),
        day.location,
      ]);
      if (!this.quranScheduleCache.has(quranKey)) {
        if (this.quranScheduleCache.size > 3) this.quranScheduleCache.clear();
        this.quranScheduleCache.set(quranKey, this.quranEngine.getFullStatus(day));
      }
      const { schedules, readingSummary, hifzSummary } = this.quranScheduleCache.get(quranKey);
      for (const [kind, summary] of [
        ['reading', readingSummary],
        ['hifz', hifzSummary],
      ]) {
        const due = schedules[kind + 'NotificationAt'],
          clock = schedules[kind + 'NotificationTime'];
        const matches =
          due != null ? nowMs >= due && nowMs < due + 60000 : dayIndex === 0 && currentHm === clock;
        const key = `quran_${kind}_${due ?? dateKey}`;
        if (schedules[kind + 'Enabled'] && matches && !this.firedEventsToday.has(key)) {
          this.firedEventsToday.add(key);
          this.emitNotification({
            type: `quran_${kind}`,
            title: kind === 'reading' ? 'موعد ورد القراءة اليومي' : 'موعد ورد الحفظ والمراجعة',
            body: `حان موعد وردك: ${summary.currentAssignment}.`,
            playAudio: false,
          });
        }
      }
    }
    const lesson = NoticePolicy.normalizeConfig(config).notifications.lessons;
    if (lesson.enabled && networkAllowed(config, 'youtube'))
      for (const [index, day] of days.entries()) {
        const prayer = day.prayers.find((p) => p.id === lesson.prayer);
        const due =
          lesson.timingMode === 'prayer' && prayer?.time
            ? this.displayedTime(prayer.time) + lesson.minutesAfter * 60000
            : null;
        const matches =
          lesson.timingMode === 'fixed'
            ? index === 0 && currentHm === lesson.customTime
            : due != null && nowMs >= due && nowMs < due + 60000;
        const key = `daily_video_${due ?? dateKey}`;
        if (matches && !this.firedEventsToday.has(key)) {
          this.firedEventsToday.add(key);
          this.triggerDailyVideoNotification().catch((error) => this.reportError(error));
        }
      }
    this.tickCustomReminders(now, config, data, scheduleKey);
    this.automation ||= new (require('./prayer-automation'))({
      storage:this.storage,prayerEngine:this.prayerEngine,
      onUpdated:report=>{this.prayerCache.clear();this.quranScheduleCache.clear();this.invoke('onOfficialSyncCompleted',report);},
      onError:error=>this.invoke('onAutomationError',error),
    });
    this.automation.tick(now).catch(error=>this.reportError(error));
  }

  tickCustomReminders(now, config, data, scheduleKey) {
    const rows = config.notifications?.customReminders;
    if (!rows?.length) return;
    const hour = Math.floor(+now / 3600000) * 3600000;
    const key = JSON.stringify([hour, scheduleKey, config.notifications, config.quranWird, config.screenLock, config.youtube]);
    if (this.customReminderKey !== key) {
      const zone = data.location?.effectiveTimeZone || data.location?.timeZone;
      const days = [-1, 0, 1].map(offset => {
        const date = Geography.shiftDay(now, offset, zone);
        return { date, data: offset === 0 ? data : this.prayerEngine.calculateLocalPrayerTimes(date) };
      });
      const video = rows.some(row => row.type === 'video')
        ? this.youtubeEngine.getFeedState('all').dailyRecommendation : null;
      this.customReminderPlan = Custom.plan(rows, config, days, hour, hour + 3600000, Boolean(video))
        .map(item => item.type === 'video' ? { ...item, body: video.title, lesson: true, videoId: video.videoId } : item);
      this.customReminderKey = key;
    }
    for (const item of this.customReminderPlan) {
      const key = 'custom_' + item.id + '_' + item.time;
      if (+now < item.time || +now >= item.time + 60000 || this.firedEventsToday.has(key)) continue;
      this.firedEventsToday.add(key);
      this.invoke('onCustomReminder', item);
    }
  }

  async triggerAutomaticOfficialSync(date = this.lastNow || new Date()) {
    this.automation ||= new (require('./prayer-automation'))({storage:this.storage,prayerEngine:this.prayerEngine,onUpdated:report=>{this.prayerCache.clear();this.quranScheduleCache.clear();this.invoke('onOfficialSyncCompleted',report);},onError:error=>this.invoke('onAutomationError',error)});
    return this.automation.tick(date,{retry:true});
  }

  emitNotification(payload) {
    this.invoke('onNotification', payload);
  }

  triggerPreLockWarning(prayer, plan = null) {
    const now = this.lastNow || new Date();
    const previewSeconds =
      Math.max(1, Math.min(60, Number(this.storage.getConfig().screenLock?.warningMinutes) || 1)) *
      60;
    // Preview warnings are isolated and never register a real lock plan.
    this.invoke('onPreLockWarning', {
      type: 'lock_warning',
      prayerId: prayer?.id,
      prayerName: prayer?.name || 'الصلاة القادمة',
      scheduleId: plan?.id || 'preview',
      preview: !plan,
      lockAt: new Date(plan?.lockAt || now.getTime() + previewSeconds * 1000).toISOString(),
      prayerTime: plan ? new Date(plan.prayerAt).toISOString() : null,
      snoozeMinutes: !plan || plan.canDelay
        ? NoticePolicy.normalizeConfig(this.storage.getConfig()).screenLock.snoozeMinutes : 0,
      secondsRemaining: plan
        ? Math.max(0, Math.ceil((plan.lockAt - now.getTime()) / 1000))
        : previewSeconds,
    });
  }

  snoozeScreenLock(minutes = 3, scheduleId, now = this.lastNow || new Date()) {
    const plan = this.lockPlans.get(scheduleId);
    const { enabled, minutesBeforeAdhan, snoozeMinutes } =
      NoticePolicy.normalizeConfig(this.storage.getConfig()).screenLock;
    if (!enabled || minutesBeforeAdhan <= 10 || !plan?.canDelay || plan.activated || +now >= plan.lockAt)
      throw new Error('التمديد متاح مرة واحدة قبل ظهور شاشة التهيئة، عندما تُضبط قبل الأذان بأكثر من عشر دقائق.');
    const requested = Math.trunc(Number(minutes));
    const duration = Math.max(1, Math.min(snoozeMinutes, requested || snoozeMinutes));
    const lockAt = Math.min(plan.prayerAt - 5 * 60000, plan.lockAt + duration * 60000);
    if (this.preparation) this.preparation.record(plan.preparationId, { delayedUntil: lockAt });
    else this.preparationDelays.set(plan.preparationId, lockAt);
    plan.lockAt = lockAt;
    plan.canDelay = false;
    return {
      scheduleId,
      lockAt: new Date(lockAt).toISOString(),
      snoozeMinutes: 0,
      message: `تأجّل ظهور شاشة التهيئة ${duration} دقائق.`,
    };
  }

  triggerScreenLock(prayer, plan = null) {
    const config = this.storage.getConfig();
    const hadithState = this.hadithEngine.getHadithForPrayer(
      `lock_${prayer?.id}_${Date.now()}`,
      true,
    );
    this.invoke('onActivateScreenLock', {
      prayerId: prayer?.id,
      scheduleId: plan?.id,
      preparationId: plan?.preparationId,
      prayerName: prayer?.name || 'صلاة الجماعة',
      prayerTime12: prayer?.time12 || '',
      prayerTime: plan ? new Date(plan.prayerAt).toISOString() : null,
      hadith: hadithState.hadith,
      motivationalQuote: this.getRandomMotivationalQuote(),
      muteSystemAudio: Boolean(config.screenLock?.muteSystemAudio),
    });
  }

  async triggerDailyVideoNotification() {
    if (!networkAllowed(this.storage.getConfig(), 'youtube')) return;
    if (!this.youtubeEngine.getChannels().length) return;
    const feeds = await this.youtubeEngine.refreshFeeds('all');
    this.youtubeEngine.releaseMemory?.();
    if (feeds.networkErrors?.length)
      this.reportError(
        new Error(feeds.networkErrors.map((error) => `${error.name}: ${error.error}`).join('\n')),
      );
    const rec = feeds.dailyRecommendation;
    if (
      /^[A-Za-z0-9_-]{11}$/.test(rec?.videoId || '') &&
      feeds.channels?.some(channel => channel.channelId === rec.channelId) &&
      networkAllowed(this.storage.getConfig(), 'youtube') &&
      this.storage.getConfig().notifications?.lessons?.enabled !== false
    )
      this.emitNotification({
        type: 'daily_video',
        title: `درس الليلة المقترح (${rec.contextTitle})`,
        body: `${rec.title} — ${rec.channelName}`,
        video: rec,
        action: 'open_lessons',
        playAudio: false,
      });
  }
}
module.exports = SchedulerEngine;
