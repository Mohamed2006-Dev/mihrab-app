const fs = require('fs'),
  path = require('path');
const CATEGORIES = ['youtube', 'hadith', 'prayer', 'location', 'other'];
function policy(config) {
  const n = config.network || {};
  return {
    enabled: n.enabled !== false,
    showChart: n.showChart !== false,
    categories: Object.fromEntries(CATEGORIES.map((k) => [k, n.categories?.[k] !== false])),
  };
}
function allowed(config, category) {
  const n = policy(config);
  return n.enabled && n.categories[category] !== false;
}
function categoryFor(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (
      /(^|\.)(youtube\.com|youtu\.be|ytimg\.com|googlevideo\.com|youtube-nocookie\.com|ggpht\.com)$/.test(
        h,
      )
    )
      return 'youtube';
    if (h === 'hadeethenc.com' || h.endsWith('.hadeethenc.com')) return 'hadith';
    if (h === 'habous.gov.ma' || h.endsWith('.habous.gov.ma') || h === 'api.aladhan.com')
      return 'prayer';
    if (['ipwho.is', 'ip-api.com', 'freeipapi.com', 'ipapi.co'].includes(h)) return 'location';
    return 'other';
  } catch {
    return 'other';
  }
}
class ResourceEngine {
  constructor(storage) {
    this.storage = storage;
    this.file = path.join(storage.dataDir, 'network-usage.json');
    this.usage = storage.readJsonSafe(this.file, {
      since: new Date().toISOString(),
      days: {},
      unknownResponses: 0,
    });
    this.usage.hours ||= {};
    this.usage.hourlySince ||= new Date().toISOString();
    this.pendingUrls = new Map();
    this.omitIds = new Set();
    this.timer = null;
    this.pending = Promise.resolve();
    this.controllers = new Map();
  }
  ensure(category) {
    if (!allowed(this.storage.getConfig(), category)) {
      const error = Error('الاتصال بهذه الخدمة متوقف من إعدادات استهلاك الإنترنت.');
      error.code = 'NETWORK_DISABLED';
      throw error;
    }
  }
  record(category, bytes, unknown = false) {
    const day = new Date().toISOString().slice(0, 10);
    const row = (this.usage.days[day] ||= {});
    row[category] = (row[category] || 0) + Math.max(0, Number(bytes) || 0);
    const hour = new Date().toISOString().slice(0, 13);
    const hourly = (this.usage.hours[hour] ||= {});
    hourly[category] = (hourly[category] || 0) + Math.max(0, Number(bytes) || 0);
    if (unknown) this.usage.unknownResponses++;
    const cutoff = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
    for (const key of Object.keys(this.usage.days)) if (key < cutoff) delete this.usage.days[key];
    for (const key of Object.keys(this.usage.hours))
      if (key.slice(0, 10) < cutoff) delete this.usage.hours[key];
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush().catch((e) => console.error('[Usage]', e.message));
      }, 400);
  }
  async flush() {
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        const temp = this.file + '.tmp';
        await fs.promises.writeFile(temp, JSON.stringify(this.usage));
        await fs.promises.rename(temp, this.file);
      });
    return this.pending;
  }
  async fetch(fetcher, url, options = {}) {
    const category = categoryFor(String(url));
    this.ensure(category);
    const key = String(url),
      controller = new AbortController();
    this.controllers.set(controller, category);
    this.pendingUrls.set(key, (this.pendingUrls.get(key) || 0) + 1);
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    try {
      const response = await fetcher(url, { ...options, signal });
      const bytes = await response.arrayBuffer();
      this.record(category, bytes.byteLength);
      this.ensure(category);
      const result = new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(result, 'url', { value: response.url });
      return result;
    } catch (error) {
      this.record(category, 0, true);
      throw error;
    } finally {
      this.controllers.delete(controller);
      const count = this.pendingUrls.get(key) - 1;
      if (count) this.pendingUrls.set(key, count);
      else this.pendingUrls.delete(key);
    }
  }
  attachSession(session) {
    session.webRequest.onBeforeRequest((details, cb) => {
      if (!/^https?:/.test(details.url)) {
        cb({});
        return;
      }
      const category = categoryFor(details.url);
      if (!allowed(this.storage.getConfig(), category)) {
        cb({ cancel: true });
        return;
      }
      if (this.pendingUrls.has(details.url)) this.omitIds.add(details.id);
      cb({});
    });
    session.webRequest.onCompleted((details) => {
      if (this.omitIds.delete(details.id) || !/^https?:/.test(details.url) || details.fromCache)
        return;
      const headers = details.responseHeaders || {};
      const header = Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-length');
      const value = header?.[1]?.[0];
      this.record(categoryFor(details.url), Number(value) || 0, !value);
    });
    session.webRequest.onErrorOccurred((details) => {
      this.omitIds.delete(details.id);
    });
    this.session = session;
  }
  async applyPolicy() {
    for (const [controller, category] of this.controllers)
      if (!allowed(this.storage.getConfig(), category)) controller.abort();
    if (this.session) await this.session.closeAllConnections();
  }
  async bytes(dir, excluded = new Set()) {
    let sum = 0;
    for (const item of await fs.promises.readdir(dir, { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    })) {
      const file = path.join(dir, item.name);
      if (excluded.has(file) || item.isSymbolicLink()) continue;
      sum += item.isDirectory()
        ? await this.bytes(file, excluded)
        : (await fs.promises.stat(file)).size;
    }
    return sum;
  }
  async stats(appDir, profileDir, memory) {
    await this.flush();
    const data = await this.bytes(this.storage.dataDir);
    const code = await this.bytes(appDir, new Set([this.storage.dataDir]));
    const profile =
      profileDir && path.resolve(profileDir) !== path.resolve(appDir)
        ? await this.bytes(profileDir, new Set([this.storage.dataDir]))
        : 0;
    return {
      disk: { application: code, data, profile, total: code + data + profile },
      memory,
      since: this.usage.since,
      hourlySince: this.usage.hourlySince,
      days: this.usage.days,
      hours: this.usage.hours,
      unknownResponses: this.usage.unknownResponses,
      network: policy(this.storage.getConfig()),
    };
  }
  async clearCache() {
    if (this.session) await this.session.clearCache();
  }
  async deleteData(kind) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
    const files = {
      youtube: ['youtube-cache.json'],
      cities: ['city-prayer-cache.json'],
      history: ['network-usage.json'],
      hadith: ['hadith-cache.json'],
    }[kind];
    if (!files) throw Error('نوع البيانات غير مسموح.');
    for (const name of files)
      await fs.promises.rm(path.join(this.storage.dataDir, name), { force: true });
    if (kind === 'history') {
      this.usage = {
        since: new Date().toISOString(),
        hourlySince: new Date().toISOString(),
        days: {},
        hours: {},
        unknownResponses: 0,
      };
      await this.flush();
    }
  }
}
module.exports = { ResourceEngine, allowed, policy, categoryFor };
