function preferences(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    autoDownload: raw.autoDownload === true,
    prerelease: raw.prerelease === true,
  };
}
class UpdateEngine {
  constructor({
    updater,
    storage,
    supported,
    busy = () => false,
    allowed = () => true,
    emit = () => {},
    version,
  }) {
    Object.assign(this, { updater, storage, supported, busy, allowed, emit });
    this.state = {
      phase: supported ? 'idle' : 'unsupported',
      version,
      message: supported
        ? 'جاهز للتحقق.'
        : 'التحديث الداخلي متاح في نسخة Windows المثبتة؛ لا يعمل في npm start أو النسخة المحمولة.',
    };
    this.state.lastChecked = storage.getConfig().updates?.lastChecked || null;
    this.checking = false;
    this.downloading = false;
    this.available = false;
    this.ready = false;
    this.epoch = 0;
    this.lastAttempt = 0;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.setFeedURL({ provider: 'github', owner: 'Mohamed2006-Dev', repo: 'mihrab-app' });
    updater.on('error', (e) => this.set({ phase: 'error', message: 'تعذر التحديث: ' + e.message }));
    updater.on('download-progress', (p) =>
      this.set({
        phase: 'downloading',
        percent: Math.min(100, Math.max(0, p.percent)),
        message: 'جارٍ تنزيل التحديث…',
      }),
    );
    updater.on('update-downloaded', (info) => {
      this.ready = true;
      this.set({
        phase: 'downloaded',
        nextVersion: info.version,
        percent: 100,
        message: 'التحديث جاهز. ثبّته عندما يناسبك.',
      });
    });
  }
  set(patch) {
    Object.assign(this.state, patch);
    this.emit(this.status());
  }
  status() {
    return { ...this.state, preferences: preferences(this.storage.getConfig().updates) };
  }
  configure() {
    this.epoch++;
    this.available = false;
    const p = preferences(this.storage.getConfig().updates);
    this.updater.allowPrerelease = p.prerelease;
    this.updater.allowDowngrade = false;
    if (!this.ready)
      this.set({
        phase: this.supported ? 'idle' : 'unsupported',
        nextVersion: null,
        message: this.supported
          ? 'حُفظت الخيارات؛ تحقق لقراءة القناة المختارة.'
          : this.state.message,
      });
  }
  ensure() {
    if (!this.supported) throw Error(this.state.message);
    if (!this.allowed()) throw Error('التحديثات متوقفة بسبب إعدادات اتصال الإنترنت.');
  }
  async check() {
    this.ensure();
    if (this.checking || this.downloading || this.ready) return this.status();
    const epoch = this.epoch;
    this.checking = true;
    this.lastAttempt = Date.now();
    this.set({ phase: 'checking', message: 'جارٍ التحقق من إصدارات GitHub…' });
    this.updater.allowPrerelease = preferences(this.storage.getConfig().updates).prerelease;
    this.updater.allowDowngrade = false;
    try {
      const result = await this.updater.checkForUpdates();
      if (epoch !== this.epoch) return this.status();
      this.token = result?.cancellationToken;
      this.token = result?.cancellationToken;
      const info = result?.updateInfo;
      this.available = !!info && require('semver').gt(info.version, this.state.version);
      const stamp = new Date().toISOString();
      this.storage.saveConfig({ updates: { lastChecked: stamp } });
      this.set({
        phase: this.available ? 'available' : 'current',
        nextVersion: this.available ? info.version : null,
        lastChecked: stamp,
        message: this.available
          ? 'يتوفر إصدار أحدث: ' + info.version
          : 'لديك أحدث إصدار متاح للقناة المختارة.',
      });
      if (this.available && preferences(this.storage.getConfig().updates).autoDownload)
        await this.download();
      return this.status();
    } catch (e) {
      this.set({ phase: 'error', message: 'تعذر التحقق: ' + e.message });
      throw e;
    } finally {
      this.checking = false;
    }
  }
  async download() {
    this.ensure();
    if (this.downloading) return this.status();
    if (!this.available) throw Error('تحقق أولاً من توفر إصدار جديد.');
    this.downloading = true;
    this.set({ phase: 'downloading', percent: 0, message: 'جارٍ تنزيل التحديث…' });
    try {
      await this.updater.downloadUpdate(this.token);
      return this.status();
    } catch (e) {
      this.set({ phase: 'error', message: 'تعذر التنزيل: ' + e.message });
      throw e;
    } finally {
      this.downloading = false;
    }
  }
  cancelNetwork() {
    this.token?.cancel();
    this.available = false;
    this.set({
      phase: 'error',
      message: 'أُوقف التحديث بسبب منع اتصال الإنترنت. تحقق مجدداً بعد السماح به.',
    });
  }
  install() {
    if (!this.supported) throw Error(this.state.message);
    if (!this.ready) throw Error('لم يكتمل تنزيل التحديث.');
    if (this.busy())
      throw Error('التثبيت مؤجل أثناء الأذان أو شاشة التهيئة. أعد المحاولة بعد انتهائهما.');
    this.updater.quitAndInstall(false, true);
  }
  tick() {
    const p = preferences(this.storage.getConfig().updates);
    if (
      this.supported &&
      p.enabled &&
      this.allowed() &&
      Date.now() - this.lastAttempt > 3600000 &&
      Date.now() - Date.parse(this.storage.getConfig().updates?.lastChecked || '1970-01-01') >
        86400000
    )
      this.check().catch(() => {});
  }
}
module.exports = { UpdateEngine, preferences };
