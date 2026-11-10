const path = require('path');

class NotificationCenter {
  constructor({
    BrowserWindow,
    getWorkArea,
    appDir,
    getConfig,
    getTheme,
    onAction,
    onAudioStatus,
    onError,
    getPrayerHadith,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    Object.assign(this, {
      BrowserWindow,
      getWorkArea,
      appDir,
      getConfig,
      getTheme,
      onAction,
      onAudioStatus,
      onError,
      getPrayerHadith,
      setTimer,
      clearTimer,
    });
    this.entries = new Map();
  }

  key(payload) {
    return (
      payload.id ||
      `${payload.type || 'notice'}:${payload.scheduleId || payload.prayerId || 'general'}`
    );
  }
  entryForSender(sender) {
    return [...this.entries.values()].find((entry) => entry.win.webContents === sender);
  }
  priority(type) {
    return { prayer_time: 4, lock_warning: 3, pre_prayer: 2 }[type] || 1;
  }

  show(payload) {
    if (payload.type === 'prayer_time') {
      this.closeWhere(
        (data) =>
          ['pre_prayer', 'lock_warning'].includes(data.type) &&
          (!payload.prayerId || !data.prayerId || data.prayerId === payload.prayerId),
      );
    }
    const key = this.key(payload);
    this.close(key);
    const area = this.getWorkArea();
    const width = Math.min(580, area.width - 32);
    const height = Math.min(330, area.height - 32);
    const soundEnabled = this.getConfig().notifications?.playAdhanAudio !== false;
    const playAudio = payload.type === 'prayer_time' && payload.playAudio !== false && soundEnabled;
    const persistent = ['pre_prayer', 'lock_warning'].includes(payload.type);
    const data = {
      ...payload,
      playAudio,
      soundEnabled,
      persistent,
      autoCloseMs: persistent ? null : playAudio ? 14700 :
        payload.type === 'custom_reminder' ? (payload.durationSeconds ?? 15) * 1000 : 10500,
    };
    if (['pre_prayer', 'lock_warning', 'prayer_time'].includes(data.type) && this.getPrayerHadith) {
      try {
        data.hadith = this.getPrayerHadith();
      } catch (error) {
        data.hadithError = error.message;
        this.onError?.(error);
      }
    }
    const win = new this.BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      useContentSize: true,
      movable: false,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(this.appDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
      },
    });
    const entry = {
      key,
      win,
      data,
      width,
      height,
      ready: false,
      shown: false,
      expiry: null,
      watchdog: null,
    };
    this.entries.set(key, entry);
    win.on('closed', () => {
      this.clearTimer(entry.expiry);
      this.clearTimer(entry.watchdog);
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        this.reflow();
      }
    });
    win.webContents.on('did-finish-load', () => {
      if (this.entries.get(key) !== entry || win.isDestroyed()) return;
      this.clearTimer(entry.watchdog);
      entry.ready = true;
      win.webContents.setAudioMuted(false);
      this.send(entry);
      this.reflow();
    });
    entry.watchdog = this.setTimer(() => {
      this.close(key);
      this.onError?.(new Error('انتهت مهلة تحميل نافذة التنبيه.'));
    }, 30000);
    win.loadFile(path.join(this.appDir, 'src', 'ui', 'notification-popup.html')).catch((error) => {
      if (this.entries.get(key) === entry) this.close(key);
      this.onError?.(error);
    });
    return key;
  }

  send(entry) {
    entry.win.webContents.send('notification-popup:data', {
      ...entry.data,
      themeState: this.getTheme(),
    });
    // Measure real wrapped text after fonts load, instead of leaving a fixed-height empty popup.
    if (typeof entry.win.webContents.executeJavaScript === 'function') {
      entry.win.webContents
        .executeJavaScript(
          `(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Math.ceil(document.getElementById('popup-card').scrollHeight + 22);
      })()`,
        )
        .then((height) => {
          if (
            entry.win.isDestroyed() ||
            this.entries.get(entry.key) !== entry ||
            !Number.isFinite(height)
          )
            return;
          entry.height = Math.min(Math.max(170, height), this.getWorkArea().height - 32, 640);
          this.reflow();
        })
        .catch((error) => {
          if (!entry.win.isDestroyed()) this.onError?.(error);
        });
    }
  }

  reflow() {
    const area = this.getWorkArea();
    const entries = [...this.entries.values()]
      .filter((entry) => entry.ready && !entry.win.isDestroyed())
      .sort((a, b) => this.priority(b.data.type) - this.priority(a.data.type));
    let bottom = area.y + area.height - 16;
    for (const entry of entries) {
      const y = bottom - entry.height;
      if (y < area.y + 12) {
        entry.win.hide();
        continue;
      }
      entry.win.setBounds({
        width: entry.width,
        height: entry.height,
        x: Math.round(area.x + area.width - entry.width - 16),
        y: Math.round(y),
      });
      entry.win.showInactive();
      bottom = y - 12;
      if (!entry.shown) {
        entry.shown = true;
        if (entry.data.autoCloseMs)
          entry.expiry = this.setTimer(() => this.close(entry.key), entry.data.autoCloseMs);
      }
    }
  }

  close(key = null) {
    if (key === null) {
      for (const id of [...this.entries.keys()]) this.close(id);
      return;
    }
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.clearTimer(entry.expiry);
    this.clearTimer(entry.watchdog);
    if (!entry.win.isDestroyed()) entry.win.destroy();
    this.reflow();
  }

  closeWhere(predicate) {
    for (const entry of [...this.entries.values()])
      if (predicate(entry.data)) this.close(entry.key);
  }

  closeFromSender(sender) {
    const entry = this.entryForSender(sender);
    if (!entry) throw new Error('نافذة التنبيه لم تعد متاحة.');
    this.close(entry.key);
  }

  async action(sender, action) {
    const entry = this.entryForSender(sender);
    if (!entry) throw new Error('نافذة التنبيه لم تعد متاحة.');
    if (action === 'snooze' && entry.data.type !== 'lock_warning')
      throw new Error('التمديد متاح في تنبيه قفل الشاشة فقط.');
    if (action === 'open_lessons' && entry.data.type !== 'daily_video')
      throw new Error('هذا التنبيه لا يحتوي درساً.');
    if (action === 'open_reminder' && entry.data.type !== 'custom_reminder')
      throw new Error('هذا الإجراء خاص بالتذكيرات المخصصة.');
    if (!['snooze', 'open_lessons', 'open_reminder'].includes(action)) throw new Error('إجراء تنبيه غير معروف.');
    const result = await this.onAction(entry.data, action);
    if (action === 'open_lessons' || action === 'open_reminder') this.close(entry.key);
    else if (this.entries.get(entry.key) === entry) {
      entry.data = { ...entry.data, ...result, body: result.message || entry.data.body };
      this.send(entry);
    }
    return result;
  }

  reportAudio(sender, data) {
    const entry = this.entryForSender(sender);
    if (!entry || !['playing', 'ended', 'error', 'disabled'].includes(data?.status)) return;
    if (data.status === 'playing' && !entry.data.playAudio) {
      this.onError?.(new Error('حاول تنبيه غير صوتي تشغيل الأذان.'));
      return;
    }
    if (
      data.status === 'playing' &&
      Number.isFinite(data.duration) &&
      data.duration > 0 &&
      data.duration < 120
    ) {
      this.clearTimer(entry.expiry);
      entry.expiry = this.setTimer(
        () => this.close(entry.key),
        Math.max(14700, data.duration * 1000 + 1000),
      );
    }
    this.onAudioStatus?.({
      status: data.status,
      message: String(data.message || '').slice(0, 500),
    });
  }
}

module.exports = NotificationCenter;
