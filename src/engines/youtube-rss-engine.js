const { allowed: networkAllowed } = require('./resource-engine');
const path = require('path');
const fs = require('fs/promises');
const nativeFs = require('fs');
const { randomUUID } = require('crypto');
const CLASSIFIER_VERSION = 'atomic-weights-v1';
const GENERAL = { id: 'ctx_general', title: 'دروس ومختارات عامة' };

function normalizeArabic(value = '') {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىی]/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function hasWords(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

const CHANNEL_ID = /^UC[a-zA-Z0-9_-]{22}$/;
const CHANNEL_HELP =
  'تعذر العثور على القناة؛ يرجى التأكد من إدخال Channel ID الصريح الذي يبدأ بـ UC أو رابط القناة المباشر';

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
      if (code[0] !== '#')
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
      const point =
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .trim();
}

function xmlText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

/** Load YouTube RSS without API keys, resolve watch URLs, exclude Shorts, classify new videos and cache their identities. */
class YouTubeRssEngine {
  constructor(storageEngine, baseDir, fetchFn = null, options = {}) {
    this.storage = storageEngine;
    this.baseDir = baseDir;
    this.fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    this.contextsPath = path.join(baseDir, 'data', 'youtube-contexts.json');
    this.cachePath =
      storageEngine.youtubeCachePath ||
      path.join(storageEngine.dataDir || path.join(baseDir, 'data'), 'youtube-cache.json');
    this.requestTimeoutMs = options.requestTimeoutMs ?? 12000;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.metadata = null;
    this.compiledContexts = null;
    this.videoCache = null;
    this.cacheRevision = 0;
    this.persistedRevision = 0;
    this.pendingWrite = null;
    this.cacheError = null;
    this.readOnly = options.readOnly === true;
    this.onCacheError =
      options.onCacheError || ((error) => console.error('[YouTubeCache]', error.message));
    // Native storage uses asynchronous, atomic disk writes. Custom storage adapters may supply their own writer.
    this.writeCache =
      options.writeCache ||
      (storageEngine.writableDir
        ? async (document) => {
            await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
            const temporary = `${this.cachePath}.${process.pid}.${randomUUID()}.tmp`;
            try {
              await fs.writeFile(temporary, JSON.stringify(document, null, 2), 'utf8');
              await fs.rename(temporary, this.cachePath);
            } catch (error) {
              await fs.unlink(temporary).catch(() => {});
              throw error;
            }
          }
        : async (document) => {
            if (!(await this.storage.writeJsonSafe(this.cachePath, document)))
              throw new Error('رفض مخزن البيانات عملية الحفظ.');
          });
  }

  releaseMemory() {
    if (this.performancePaged && !this.pendingWrite && !this.refreshTask) this.videoCache = null;
  }

  setFetchFn(fn) {
    this.fetchFn = fn;
  }

  getContextsMetadata() {
    if (!this.metadata) {
      const metadata = this.storage.readJsonSafe(this.contextsPath, {
        contexts: [],
        defaultChannels: [],
        curatedFallbackVideos: [],
      });
      if (
        !Array.isArray(metadata.contexts) ||
        !metadata.contexts.some((context) => context.id !== GENERAL.id) ||
        metadata.contexts.some(
          (context) =>
            !context.id ||
            !context.title ||
            !Array.isArray(context.exactPhrases || context.keywords),
        )
      ) {
        throw new Error(
          'تعذر قراءة سياقات يوتيوب؛ لم تُحفظ تصنيفات افتراضية بدلاً من البيانات المفقودة.',
        );
      }
      this.metadata = {
        ...metadata,
        contexts: [...(metadata.contexts || []).filter((c) => c.id !== GENERAL.id), GENERAL],
      };
    }
    return this.metadata;
  }

  getChannels() {
    const config = this.storage.getConfig();
    const channels = config.youtube?.channels;
    if (Array.isArray(channels)) {
      return channels;
    }
    const meta = this.getContextsMetadata();
    return meta.defaultChannels || [];
  }

  /** Resolve a channel ID or URL to its canonical UC identifier. */
  async requestText(url, accept) {
    if (!this.fetchFn) throw new Error('خدمة الاتصال بالشبكة غير متاحة.');
    const controller = new AbortController();
    let timer;
    try {
      // Bound both the connection and the response body, including injected fetch implementations.
      return await Promise.race([
        (async () => {
          const response = await this.fetchFn(url, {
            signal: controller.signal,
            cache: 'no-store',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
              'Accept': accept,
              'Accept-Language': 'ar,en-US;q=0.8,en;q=0.5',
            },
          });
          const status = Number(response?.status);
          if (status !== 200) {
            const error = new Error(`استجابة خادم يوتيوب برمز HTTP ${status || 'غير معروف'}`);
            error.status = status;
            throw error;
          }
          return await response.text();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('انتهت مهلة الاتصال بيوتيوب؛ تحقق من الإنترنت ثم أعد المحاولة.'));
          }, this.requestTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async getChannelPage(url) {
    const html = await this.requestText(url, 'text/html,application/xhtml+xml');
    // Prefer the page owner's metadata; generic channelId fields may belong to recommendations.
    const metadata = html.match(
      /"channelMetadataRenderer"\s*:\s*\{[\s\S]*?"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"/,
    );
    const canonical = html.match(
      /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})["']/i,
    );
    const feed = html.match(/channel_id=(UC[a-zA-Z0-9_-]{22})(?:[&"'\s<]|$)/);
    const meta = html.match(
      /<meta\b(?=[^>]*\bitemprop=["']channelId["'])[^>]*\bcontent=["'](UC[a-zA-Z0-9_-]{22})["']/i,
    );
    const match = metadata || canonical || feed || meta;
    if (!match)
      throw new Error(
        'تعذر التحقق من هوية القناة من صفحة يوتيوب؛ قد تكون الصفحة محجوبة أو تتطلب الموافقة على ملفات الارتباط.',
      );
    const title = decodeXml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(
      /\s*- YouTube$/,
      '',
    );
    const image = decodeXml(
      html.match(
        /<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*\bcontent=["']([^"']+)["']/i,
      )?.[1] || '',
    );
    let avatarUrl = null;
    try {
      const u = new URL(image);
      if (
        u.protocol === 'https:' &&
        /(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(u.hostname)
      )
        avatarUrl = u.href;
    } catch {}
    return { channelId: match[1], channelTitle: title, avatarUrl };
  }

  async resolveChannelId(input) {
    const raw = String(input || '')
      .trim()
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
    if (!raw) throw new Error(CHANNEL_HELP);
    if (CHANNEL_ID.test(raw)) return raw;
    if (/^UC[\w-]*$/.test(raw)) throw new Error(CHANNEL_HELP);

    let targetUrl = raw;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = /^(?:(?:www|m)\.)?youtube\.com\//i.test(raw)
        ? `https://${raw}`
        : `https://www.youtube.com/${raw.startsWith('@') ? raw : `@${raw}`}`;
    }
    let url;
    try {
      url = new URL(targetUrl);
    } catch {
      throw new Error(CHANNEL_HELP);
    }
    if (
      !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new Error('يرجى إدخال رابط قناة على youtube.com أو معرّف القناة الذي يبدأ بـ UC.');
    }
    const direct = url.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})(?:\/|$)/);
    if (direct) return direct[1];
    if (
      url.pathname === '/feeds/videos.xml' &&
      CHANNEL_ID.test(url.searchParams.get('channel_id') || '')
    ) {
      return url.searchParams.get('channel_id');
    }
    if (!/^\/(?:@[^/]+|(?:c|user)\/[^/]+)(?:\/|$)/.test(url.pathname))
      throw new Error(CHANNEL_HELP);
    url.protocol = 'https:';
    url.hostname = 'www.youtube.com';
    try {
      return (await this.getChannelPage(url.href)).channelId;
    } catch (error) {
      if (error.status === 404) throw new Error(CHANNEL_HELP);
      throw error;
    }
  }

  /** Subscribe by ID or URL and read the channel name from its XML feed. */
  async addChannel({ channelId, customName, category }) {
    const rawInput = String(channelId || '').trim();
    if (!rawInput) {
      throw new Error(
        'تعذر العثور على القناة؛ يرجى التأكد من إدخال Channel ID الصريح الذي يبدأ بـ UC أو رابط القناة المباشر',
      );
    }

    // Sanitize and resolve the supplied identifier before saving it.
    const cleanId = await this.resolveChannelId(rawInput);
    if (!cleanId || !cleanId.startsWith('UC') || cleanId.length !== 24) {
      throw new Error(
        'تعذر العثور على القناة؛ يرجى التأكد من إدخال Channel ID الصريح الذي يبدأ بـ UC أو رابط القناة المباشر',
      );
    }

    const config = this.storage.getConfig();
    const channels = this.getChannels();
    if (channels.some((c) => c.channelId === cleanId)) {
      throw new Error('هذه القناة مضافة مسبقاً في قائمة المتابعة.');
    }

    let resolvedName = String(customName || '').trim();
    let fetchedVideos = [];

    let warning = null;
    try {
      const feedData = await this.fetchChannelRss(cleanId, resolvedName);
      resolvedName ||= feedData.channelTitle;
      fetchedVideos = feedData.videos;
    } catch (feedError) {
      // An RSS failure is not proof that the channel is missing. Confirm its page first.
      let page;
      try {
        page = await this.getChannelPage(`https://www.youtube.com/channel/${cleanId}`);
      } catch (pageError) {
        if (pageError.status === 404) throw new Error(CHANNEL_HELP);
        throw new Error(
          `${feedError.message} تعذر أيضاً التحقق من صفحة القناة: ${pageError.message}`,
        );
      }
      if (page.channelId !== cleanId) throw new Error('هوية صفحة القناة لا تطابق المعرّف المدخل.');
      resolvedName ||= page.channelTitle;
      warning = `تم التحقق من القناة وحفظها، لكن تعذر جلب المقاطع الآن. ${feedError.message} استخدم «تحديث الخلاصات» لاحقاً.`;
    }

    if (!resolvedName) {
      resolvedName = `قناة دعوية (${cleanId.slice(0, 10)})`;
    }

    const newChannel = {
      id: `ch_${Date.now()}`,
      channelId: cleanId,
      name: resolvedName,
      category: category || 'دروس ومحاضرات علمية',
      addedAt: new Date().toISOString(),
    };

    const updatedChannels = [...channels, newChannel];
    this.storage.saveConfig({
      youtube: {
        ...(config.youtube || {}),
        channels: updatedChannels,
      },
    });

    if (fetchedVideos.length > 0) {
      this.mergeVideosIntoCache(fetchedVideos);
      await this.flushCache();
    }

    return { channel: newChannel, channels: updatedChannels, warning };
  }

  /** Remove a channel subscription. */
  removeChannel(channelId) {
    const config = this.storage.getConfig();
    const channels = this.getChannels();
    const target = channels.find((c) => c.channelId === channelId || c.id === channelId);
    const updatedChannels = channels.filter((c) => c.channelId !== channelId && c.id !== channelId);

    this.storage.saveConfig({
      youtube: {
        ...(config.youtube || {}),
        channels: updatedChannels,
      },
    });

    return {
      removedChannel: target || null,
      channels: updatedChannels,
    };
  }

  /** Detect Shorts so they can be excluded from recommendations. */
  isShortVideo(title = '', url = '', description = '') {
    const combined = `${title} ${url} ${description}`.toLowerCase();
    if (url.includes('/shorts/')) return true;
    if (
      combined.includes('#shorts') ||
      combined.includes('#short') ||
      combined.includes('مقطع قصير') ||
      combined.includes('شورتس') ||
      combined.includes('ريلز') ||
      combined.includes('#reels')
    ) {
      return true;
    }
    return false;
  }

  /** Whole-token matching: Arabic cannot use JavaScript's ASCII-centric \b boundary. */
  classifyVideoContext(title = '', description = '') {
    if (!this.compiledContexts) {
      this.compiledContexts = this.getContextsMetadata()
        .contexts.filter((c) => c.id !== GENERAL.id)
        .map((context) => {
          const legacy = context.keywords || [];
          const exact = [
            ...new Set(
              (context.exactPhrases || legacy.filter((k) => normalizeArabic(k).includes(' ')))
                .map(normalizeArabic)
                .filter(Boolean),
            ),
          ];
          const partial = [
            ...new Set(
              (context.partialKeywords || legacy.filter((k) => !normalizeArabic(k).includes(' ')))
                .map(normalizeArabic)
                .filter((k) => k && !exact.includes(k)),
            ),
          ];
          return { ...context, exact, partial };
        });
    }
    const fields = [normalizeArabic(title), normalizeArabic(description)];
    const results = this.compiledContexts
      .map((context) => {
        let score = 0;
        const matches = [];
        fields.forEach((text, field) => {
          const exactMatches = context.exact.filter((phrase) => hasWords(text, phrase));
          // Nested phrases describe the same evidence; only the longest matching phrase counts.
          const phrases = exactMatches.filter(
            (phrase) => !exactMatches.some((other) => other !== phrase && hasWords(other, phrase)),
          );
          for (const phrase of phrases) {
            score += field ? 3 : 10;
            matches.push({
              field: field ? 'description' : 'title',
              keyword: phrase,
              weight: field ? 3 : 10,
            });
          }
          for (const word of context.partial) {
            if (hasWords(text, word) && !phrases.some((phrase) => hasWords(phrase, word))) {
              score += field ? 1 : 4;
              matches.push({
                field: field ? 'description' : 'title',
                keyword: word,
                weight: field ? 1 : 4,
              });
            }
          }
        });
        return { context, score, matches };
      })
      .sort((a, b) => b.score - a.score);
    const winner = results[0];
    const tied = winner && winner.score > 0 && results[1]?.score === winner.score;
    const context = !winner?.score || tied ? GENERAL : winner.context;
    return {
      contextId: context.id,
      contextTitle: context.title,
      classification: {
        version: CLASSIFIER_VERSION,
        score: winner?.score || 0,
        reason: tied ? 'tie' : winner?.score ? 'matched' : 'no_match',
        matches: winner?.score && !tied ? winner.matches : [],
      },
    };
  }

  ensureCache() {
    if (this.videoCache) return;
    let saved;
    try {
      // Do not overwrite a damaged/unreadable file with an apparently successful empty cache.
      saved =
        this.storage.writableDir && nativeFs.existsSync(this.cachePath)
          ? JSON.parse(nativeFs.readFileSync(this.cachePath, 'utf8'))
          : this.storage.readJsonSafe(this.cachePath, { videos: [] });
      if (
        !saved ||
        typeof saved !== 'object' ||
        Array.isArray(saved) ||
        (saved.schemaVersion && ![1, 2].includes(saved.schemaVersion)) ||
        (saved.videosById &&
          (typeof saved.videosById !== 'object' || Array.isArray(saved.videosById))) ||
        (!saved.videosById && saved.videos && !Array.isArray(saved.videos))
      ) {
        throw new Error('بنية ملف المقاطع غير صالحة أو إصداره غير مدعوم.');
      }
    } catch (error) {
      this.cacheError = new Error(
        `تعذر قراءة مخزن مقاطع يوتيوب؛ احتُفظ بالملف دون استبداله: ${error.message}`,
      );
      this.onCacheError(this.cacheError);
      throw this.cacheError;
    }
    this.videoCache = Object.create(null);
    const entries =
      saved.videosById && typeof saved.videosById === 'object'
        ? Object.values(saved.videosById)
        : saved.videos || [];
    let migrated = !saved.videosById;
    for (const video of entries) {
      if (!this.isValidCachedVideo(video)) {
        migrated = true;
        continue;
      }
      const validClassification =
        video.classification?.version === CLASSIFIER_VERSION &&
        video.contextId &&
        video.classifiedAt;
      // Legacy classifications used substring/first-match rules: migrate once, then never rescore this ID.
      this.videoCache[video.videoId] = validClassification
        ? video
        : {
            ...video,
            ...this.classifyVideoContext(video.title, video.description),
            fingerprint: video.videoId,
            pubDate: video.pubDate || video.published || null,
            classifiedTitle: video.title,
            classifiedAt: new Date().toISOString(),
            classificationInput: video.description ? 'title_and_description' : 'title_only_legacy',
          };
      if (!validClassification) migrated = true;
    }
    if (migrated) this.queueCacheWrite();
  }

  isValidCachedVideo(video) {
    return (
      video &&
      /^[a-zA-Z0-9_-]{11}$/.test(video.videoId || '') &&
      !video.url?.includes('search_query=') &&
      !this.isShortVideo(video.title, video.url || '', video.description || '')
    );
  }

  rememberVideo(video) {
    this.ensureCache();
    const previous = this.videoCache[video.videoId];
    const classification = previous
      ? {
          contextId: previous.contextId,
          contextTitle: previous.contextTitle,
          classification: previous.classification,
          classifiedTitle: previous.classifiedTitle,
          classifiedAt: previous.classifiedAt,
          classificationInput: previous.classificationInput,
        }
      : {
          ...this.classifyVideoContext(video.title, video.description),
          classifiedTitle: video.title,
          classifiedAt: new Date().toISOString(),
          classificationInput: 'title_and_description',
        };
    const result = {
      ...previous,
      ...video,
      ...classification,
      fingerprint: video.videoId,
      pubDate: video.pubDate || video.published || previous?.pubDate || previous?.published || null,
      thumbnailUrl:
        video.thumbnailUrl ||
        previous?.thumbnailUrl ||
        `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`,
    };
    this.videoCache[video.videoId] = result;
    this.queueCacheWrite();
    return result;
  }

  visibleVideos() {
    this.ensureCache();
    const followed = new Set(this.getChannels().map((channel) => channel.channelId));
    return this.interleaveVideosByChannel(
      Object.values(this.videoCache)
        .filter((video) => followed.has(video.channelId))
        .sort(
          (a, b) =>
            (Date.parse(b.published || b.pubDate) || 0) -
            (Date.parse(a.published || a.pubDate) || 0),
        ),
    ).slice(0, 80);
  }

  queueCacheWrite() {
    if (this.readOnly) return;
    this.cacheRevision++;
    this.startCacheWrite();
  }

  startCacheWrite() {
    if (this.pendingWrite) return this.pendingWrite;
    this.pendingWrite = Promise.resolve()
      .then(async () => {
        while (this.persistedRevision !== this.cacheRevision) {
          const revision = this.cacheRevision;
          const document = {
            schemaVersion: 2,
            classifierVersion: CLASSIFIER_VERSION,
            videosById: { ...this.videoCache },
            // Compatibility view for older consumers; classification always uses videosById, including archived IDs.
            videos: this.visibleVideos(),
            lastUpdated: new Date().toISOString(),
          };
          await this.writeCache(document);
          this.persistedRevision = revision;
          this.cacheError = null;
        }
      })
      .catch((error) => {
        this.cacheError = new Error(
          `تعذر حفظ مقاطع يوتيوب في مجلد بيانات المستخدم: ${error.message}`,
        );
        this.onCacheError(this.cacheError);
      })
      .finally(() => {
        this.pendingWrite = null;
      });
    return this.pendingWrite;
  }

  async flushCache() {
    this.ensureCache();
    if (!this.pendingWrite && this.persistedRevision !== this.cacheRevision) this.startCacheWrite();
    if (this.pendingWrite) await this.pendingWrite;
    if (this.cacheError) throw this.cacheError;
  }

  /** Parse Atom entries from a channel feed and extract direct video links. */
  async fetchChannelRss(channelId, fallbackChannelName = '') {
    const cleanId = String(channelId || '').trim();
    if (!CHANNEL_ID.test(cleanId)) throw new Error(CHANNEL_HELP);
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(cleanId)}`;
    let lastError;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        const xml = await this.requestText(
          rssUrl,
          'application/atom+xml, application/xml, text/xml, */*',
        );
        return this.parseChannelFeed(xml, cleanId, fallbackChannelName);
      } catch (error) {
        lastError = error;
        if (error.code === 'NETWORK_DISABLED') break;
        if (error.status && ![404, 408, 429].includes(error.status) && error.status < 500) break;
        if (attempt + 1 < this.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
        }
      }
    }
    const failure = new Error(
      `تعذر جلب خلاصة يوتيوب بعد المحاولة (${lastError.message}). قد تكون الخلاصة غير متاحة مؤقتاً.` +
        (lastError.status === 404
          ? ' خادم الخلاصات أعاد 404؛ هذا وحده لا يعني حذف القناة. احتُفظ بالمقاطع المخزنة.'
          : ''),
    );
    failure.status = lastError.status;
    failure.code = lastError.code;
    throw failure;
  }

  parseChannelFeed(xml, channelId, fallbackChannelName = '') {
    if (!/<feed(?:\s|>)/i.test(xml) || !/<\/feed\s*>/i.test(xml)) {
      throw new Error('الاستجابة ليست خلاصة Atom صالحة.');
    }
    const header = xml.split(/<entry(?:\s|>)/i)[0];
    const identity =
      xmlText(header, 'yt:channelId') || xmlText(header, 'id').replace(/^yt:channel:/, '');
    const normalizedIdentity = identity.startsWith('UC') ? identity : `UC${identity}`;
    // /xml/feeds/videos.xml is a static hub document, not a channel's video feed.
    if (identity && normalizedIdentity !== channelId) throw new Error('الخلاصة تخص قناة أخرى.');
    if (
      !identity &&
      !xml.includes(`/channel/${channelId}`) &&
      !xml.includes(`channel_id=${channelId}`)
    ) {
      throw new Error('لم تتضمن الاستجابة هوية خلاصة القناة.');
    }
    const channelTitle = xmlText(header, 'title') || fallbackChannelName;
    const videos = [];
    for (const match of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/gi)) {
      const entry = match[1];
      const videoId =
        xmlText(entry, 'yt:videoId') || xmlText(entry, 'id').replace(/^yt:video:/, '');
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) continue;
      const title = xmlText(entry, 'title');
      const description = xmlText(entry, 'media:description');
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const originalUrl = entry.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || url;
      if (this.isShortVideo(title, originalUrl, description)) continue;
      const thumb = entry.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["']/i)?.[1];
      videos.push(
        this.rememberVideo({
          videoId,
          title,
          description,
          channelName: channelTitle,
          channelId,
          published: xmlText(entry, 'published') || new Date().toISOString(),
          url,
          thumbnailUrl: thumb
            ? decodeXml(thumb)
            : `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          durationEstimate: 'درس كامل',
          isShort: false,
        }),
      );
    }
    // A valid channel may have no public uploads yet.
    return { channelTitle, videos };
  }

  /** Interleave videos round-robin: one item per channel on each pass. */
  interleaveVideosByChannel(videos) {
    if (!Array.isArray(videos) || videos.length <= 1) return videos || [];

    const channelMap = new Map();
    for (const v of videos) {
      const chKey = v.channelId || v.channelName || 'general';
      if (!channelMap.has(chKey)) {
        channelMap.set(chKey, []);
      }
      channelMap.get(chKey).push(v);
    }

    const interleaved = [];
    const queues = Array.from(channelMap.values());
    let hasMore = true;
    let idx = 0;

    while (hasMore) {
      hasMore = false;
      for (const queue of queues) {
        if (idx < queue.length) {
          interleaved.push(queue[idx]);
          hasMore = true;
        }
      }
      idx++;
    }

    return interleaved;
  }

  mergeVideosIntoCache(newVideos) {
    this.ensureCache();
    for (const video of newVideos) if (this.isValidCachedVideo(video)) this.rememberVideo(video);
    this.queueCacheWrite();
    return this.visibleVideos();
  }

  /** Refresh feeds for all subscribed channels. */
  async refreshFeeds(selectedContextId = 'all') {
    if (!networkAllowed(this.storage.getConfig(), 'youtube'))
      return this.getFeedState(selectedContextId, [
        {
          name: 'إعدادات الشبكة',
          error: 'تحديث الخلاصات وإشعارات الدروس متوقفان لأن اتصال يوتيوب ممنوع.',
        },
      ]);
    if (!this.refreshTask)
      this.refreshTask = this.performRefresh('all').finally(() => {
        this.refreshTask = null;
      });
    const result = await this.refreshTask;
    return this.getFeedState(selectedContextId, result.networkErrors || []);
  }
  async performRefresh(selectedContextId = 'all') {
    const channels = this.getChannels();
    const collected = [];
    const errors = [];

    for (const ch of channels) {
      try {
        const { videos } = await this.fetchChannelRss(ch.channelId, ch.name);
        collected.push(...videos);
      } catch (err) {
        errors.push({ channelId: ch.channelId, name: ch.name, error: err.message, status: err.status });
      }
    }

    const allVideos = this.mergeVideosIntoCache(collected);
    await this.flushCache();
    return this.getFeedState(selectedContextId, errors, allVideos);
  }

  getLessonById(videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return null;
    return this.getFeedState().videos.find(video => video.videoId === videoId) || null;
  }

  getAnotherLesson(excluded) {
    const seen = new Set(Array.isArray(excluded) ? excluded.slice(0, 500) : []);
    return this.getFeedState().videos.find(video => !seen.has(video.videoId)) || null;
  }

  getFeedState(selectedContextId = 'all', errors = [], cachedVideos = null) {
    const { contexts } = this.getContextsMetadata();
    const channels = this.getChannels();
    const followed = new Set(channels.map((channel) => channel.channelId));
    const allVideos = (cachedVideos || this.visibleVideos()).filter((video) =>
      followed.has(video.channelId),
    );

    const filtered =
      selectedContextId && selectedContextId !== 'all'
        ? allVideos.filter((v) => v.contextId === selectedContextId)
        : allVideos;

    const dailyRecommendation = filtered[0] || allVideos[0] || null;
    const countsByChannel = new Map();
    for (const video of allVideos) {
      if (!video.contextId) continue;
      if (!countsByChannel.has(video.channelId)) countsByChannel.set(video.channelId, new Map());
      const counts = countsByChannel.get(video.channelId);
      counts.set(video.contextId, (counts.get(video.contextId) || 0) + 1);
    }
    const contextCounts = Array.from(countsByChannel).flatMap(([channelId, counts]) =>
      Array.from(counts, ([contextId, count]) => ({ channelId, contextId, count })));


    return {
      contexts,
      channels,
      videos: allVideos,
      filteredVideos: filtered,
      allVideosCount: allVideos.length,
      contextCounts,
      dailyRecommendation,
      networkErrors: this.cacheError
        ? [...errors, { name: 'التخزين المحلي', error: this.cacheError.message }]
        : errors,
    };
  }
}

module.exports = YouTubeRssEngine;
