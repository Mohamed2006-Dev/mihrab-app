const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

/** Fetch and cache HadeethEnc content; SHA-256 fingerprints prevent repeat selections. */
class HadithEngine {
  constructor(storageEngine, baseDir, fetchFn = null) {
    this.storage = storageEngine;
    this.baseDir = baseDir;
    this.fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    this.seedPath = path.join(baseDir, 'data', 'seed-hadiths.json');
    this.cachePath =
      storageEngine.hadithCachePath ||
      path.join(storageEngine.dataDir || path.join(baseDir, 'data'), 'hadith-cache.json');

    this.initializeLocalDatabase();
  }

  normalizeSharhText(value = '') {
    return String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
        const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
      })
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&laquo;|&raquo;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/^\s*قال\s+(?:رسول\s+الله|النبي)\s*(?:ﷺ|صلى الله عليه وسلم)?\s*[:：]?\s*/, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\u0621-\u064a0-9a-z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  sharhKeys(hadith) {
    const keys = new Set();
    // The full text and one complete quoted matn; never an arbitrary substring or a topic.
    const texts = [hadith.text, hadith.hadith_text, hadith.hadeeth, hadith.matn].filter(
      (value) => typeof value === 'string' && value.trim(),
    );
    for (const value of texts) {
      const normalized = this.normalizeSharhText(value);
      if (normalized) keys.add(normalized);
      const quoted = [...value.matchAll(/«([^»]+)»/g)];
      if (quoted.length === 1) {
        const prefix = this.normalizeSharhText(value.slice(0, quoted[0].index));
        const matn = this.normalizeSharhText(quoted[0][1]);
        if (
          (!prefix || /^(?:عن |قال |قالت |سمعت |ان |أن )/.test(prefix)) &&
          matn.length >= 24 &&
          matn.split(' ').length >= 4 &&
          !/\.\.\.|…/.test(quoted[0][1])
        )
          keys.add(matn);
      }
    }
    return keys;
  }

  cleanSharh(value, source, sourceUrl = '') {
    if (typeof value === 'string') value = { explanation: value };
    if (!value || typeof value !== 'object') return null;
    const clean = (text) =>
      String(text || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();
    const explanation = clean(value.explanation || value.text || value.sharh);
    const vocabulary = (
      Array.isArray(value.vocabulary || value.words_meanings)
        ? value.vocabulary || value.words_meanings
        : []
    )
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({ word: clean(item.word), meaning: clean(item.meaning) }))
      .filter((item) => item.word && item.meaning);
    const benefits = (
      Array.isArray(value.benefits || value.hints) ? value.benefits || value.hints : []
    )
      .filter((item) => typeof item === 'string')
      .map(clean)
      .filter(Boolean);
    if (!explanation && !vocabulary.length && !benefits.length) return null;
    const url = String(value.source_url || sourceUrl || '');
    return {
      explanation,
      vocabulary,
      benefits,
      source,
      sourceUrl: /^https:\/\/(?:hadeethenc\.com|hadeethenc\.com)\//.test(url) ? url : '',
      related: value.related === true,
      explainedText: clean(value.explainedText),
    };
  }

  loadSharhIndex() {
    const userFile = path.join(
      this.storage.dataDir || path.dirname(this.cachePath),
      'local-hadith-sharh.json',
    );
    const file = fs.existsSync(userFile)
      ? userFile
      : path.join(this.baseDir, 'data', 'local-hadith-sharh.json');
    if (!fs.existsSync(file)) {
      this.sharhWarning = null;
      return this.sharhIndex || new Map();
    }
    try {
      const stat = fs.statSync(file),
        signature = file + ':' + stat.mtimeMs + ':' + stat.size;
      if (this.sharhSignature === signature) return this.sharhIndex || new Map();
      this.sharhSignature = signature;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        !data ||
        typeof data !== 'object' ||
        (data.schemaVersion && (!data.hadiths || typeof data.hadiths !== 'object'))
      )
        throw new Error('بنية قاعدة الشروح غير صالحة.');
      const records = Array.isArray(data) ? data : Object.values(data.hadiths || data);
      const index = new Map();
      for (const row of records) {
        if (!row || typeof row !== 'object' || !row.id) continue;
        const sharh = this.cleanSharh(
          row,
          'HadeethEnc',
          row.id ? 'https://hadeethenc.com/ar/browse/hadith/' + row.id : '',
        );
        if (!sharh) continue;
        for (const key of this.sharhKeys(row)) {
          const prior = index.get(key);
          if (prior && prior.id !== String(row.id)) index.set(key, { ambiguous: true });
          else if (!prior) index.set(key, { id: String(row.id), sharh, row });
        }
      }
      this.sharhIndex = index;
      this.sharhWarning = null;
    } catch (error) {
      this.sharhWarning = 'تعذر قراءة قاعدة الشروح المحلية: ' + error.message;
      console.error('[HadithSharh]', this.sharhWarning);
    }
    return this.sharhIndex || new Map();
  }

  resolveHadithSharh(hadith) {
    if (!hadith) return null;
    for (const value of [
      hadith.sharh,
      hadith.explanationData,
      { explanation: hadith.explanation, vocabulary: hadith.vocabulary, benefits: hadith.benefits },
    ]) {
      const direct = this.cleanSharh(
        value,
        hadith.sharhSource || value?.source || 'HadeethEnc',
        value?.sourceUrl || hadith.sourceUrl,
      );
      if (direct) return direct;
    }
    const index = this.loadSharhIndex(),
      matches = new Map();
    for (const key of this.sharhKeys(hadith)) {
      const candidate = index.get(key);
      if (candidate?.ambiguous) return null;
      if (candidate) matches.set(candidate.id, candidate.sharh);
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  buildState(db) {
    const valid = new Set(db.hadiths.map((item) => item.fingerprint)),
      shown = new Set((db.shownFingerprints || []).filter((key) => valid.has(key)));
    const hadith = this.getHadithDetails(db.currentHadith);
    return {
      hadith,
      totalStored: db.hadiths.length,
      shownCount: shown.size,
      remainingCount: Math.max(0, db.hadiths.length - shown.size),
      sharhWarning: this.sharhWarning || null,
    };
  }

  getHadithLibrary({ query = '', offset = 0, limit = 24 } = {}) {
    const db = this.getDatabase(),
      needle = this.normalizeSharhText(String(query).slice(0, 300));
    const filtered = db.hadiths.filter(
      (item) =>
        !needle ||
        this.normalizeSharhText([item.text, item.rawi, item.book, item.topic].join(' ')).includes(
          needle,
        ),
    );
    offset = Math.max(0, Math.trunc(Number(offset)) || 0);
    limit = Math.max(1, Math.min(48, Math.trunc(Number(limit)) || 24));
    return {
      items: filtered.slice(offset, offset + limit).map((item) => ({
        id: item.id,
        fingerprint: item.fingerprint,
        text: item.text,
        grade: item.grade,
        book: item.book,
        topic: item.topic,
        hasSharh: !!this.resolveHadithSharh(item),
      })),
      total: filtered.length,
      offset,
      nextOffset: offset + limit < filtered.length ? offset + limit : null,
    };
  }

  selectStoredHadith(key) {
    const db = this.getDatabase(),
      selected = db.hadiths.find((item) => item.fingerprint === key || item.id === key);
    if (!selected) throw new Error('الحديث المطلوب غير موجود في المكتبة.');
    db.currentHadith = selected;
    db.shownFingerprints ||= [];
    if (!db.shownFingerprints.includes(selected.fingerprint))
      db.shownFingerprints.push(selected.fingerprint);
    this.saveDatabase(db);
    return this.buildState(db);
  }

  formatHadithMarkdown(key, includeSharh = true) {
    const hadith = this.getExportHadith(key);
    const sharh = includeSharh ? this.resolveHadithSharh(hadith) : null;
    const lines = [
      '# حديث نبوي',
      '',
      hadith.text,
      '',
      '- الراوي: ' + (hadith.rawi || 'غير مسجل'),
      '- الدرجة: ' + (hadith.grade || 'غير مسجلة'),
      '- المصدر: ' + (hadith.book || 'غير مسجل'),
      '- المحدث: ' + (hadith.mohdith || 'غير مسجل'),
      '',
      'الناشر والمصدر: موسوعة الأحاديث النبوية — HadeethEnc.com',
      this.getHadithSourceUrl(hadith.id),
    ];
    if (sharh) {
      if (sharh.vocabulary.length) {
        lines.push('', '## معاني الكلمات', '');
        for (const item of sharh.vocabulary) lines.push('- ' + item.word + ': ' + item.meaning);
      }
      if (sharh.explanation) lines.push('', '## الشرح والمعنى الإجمالي', '', sharh.explanation);
      if (sharh.benefits.length)
        lines.push('', '## الفوائد', '', ...sharh.benefits.map((item) => '- ' + item));
      lines.push('', 'مصدر الشرح: ' + sharh.source, ...(sharh.sourceUrl ? [sharh.sourceUrl] : []));
    }
    return lines.join('\n') + '\n';
  }

  isMissingDetail(value) {
    return (
      !value ||
      /^(?:-|غير مسجل[ة]?|غير مذكور في المصدر|لم يذكره المصدر)$/.test(String(value).trim())
    );
  }

  findLocalHadith(hadith) {
    const index = this.loadSharhIndex(),
      matches = new Map();
    for (const key of this.sharhKeys(hadith)) {
      const candidate = index.get(key);
      if (candidate?.ambiguous) return null;
      if (candidate) matches.set(candidate.id, candidate);
    }
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  getHadithDetails(hadith) {
    if (!hadith) return null;
    const local = this.findLocalHadith(hadith),
      row = local?.row;
    const result = { ...hadith };
    if (row) {
      if (this.isMissingDetail(result.grade) && row.grade) {
        result.grade = row.grade;
        result.gradeSource = 'موسوعة الأحاديث النبوية — HadeethEnc';
      }
      if (this.isMissingDetail(result.book) && row.attribution) result.book = row.attribution;
      for (const field of ['rawi', 'mohdith'])
        if (this.isMissingDetail(result[field]) && row[field]) result[field] = row[field];
    }
    result.sharh = this.resolveHadithSharh(hadith);
    return result;
  }

  getHadithSourceUrl(key) {
    const hadith = this.getExportHadith(key);
    const id = String(hadith.id).match(/^hadeethenc_(\d+)$/)?.[1];
    if (!id) throw Error('معرّف مصدر الحديث غير صالح.');
    return 'https://hadeethenc.com/ar/browse/hadith/' + id;
  }

  getExportHadith(key) {
    const db = this.getDatabase(),
      hadith = key
        ? db.hadiths.find((item) => item.fingerprint === key || item.id === key)
        : db.currentHadith;
    if (!hadith) throw new Error('الحديث المطلوب غير موجود في المكتبة.');
    return this.getHadithDetails(hadith);
  }

  async enrichStoredHadith(key, { force = false, lookupSharh = true } = {}) {
    this.detailRequests ||= new Map();
    if (this.detailRequests.has(key)) return this.detailRequests.get(key);
    const work = this.enrichStoredHadithOnce(key, { force, lookupSharh }).finally(() =>
      this.detailRequests.delete(key),
    );
    this.detailRequests.set(key, work);
    return work;
  }

  async enrichStoredHadithOnce(key, { force = false } = {}) {
    const previous = this.getExportHadith(key);
    if (force) {
      const id = previous.id.replace(/^hadeethenc_/, '');
      const response = await (this.fetchFn || fetch)(
        'https://hadeethenc.com/api/v1/hadeeths/multiple/?language=ar&ids=' +
          encodeURIComponent(id),
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response?.ok) throw Error('HTTP ' + response?.status);
      const payload = await response.json(),
        row = Array.isArray(payload) ? payload.find((row) => String(row.id) === id) : null;
      const fresh = row && this.fromHadeethEnc(row);
      if (!fresh) throw Error('لم تتوفر تفاصيل مكتملة للحديث.');
      const db = this.getDatabase(),
        stored = db.hadiths.find((row) => row.id === previous.id);
      if (!stored) throw Error('الحديث غير موجود.');
      fresh.fingerprint = stored.fingerprint;
      Object.assign(stored, fresh);
      if (db.currentHadith?.id === stored.id) db.currentHadith = stored;
      this.saveDatabase(db);
    }
    return this.buildState(this.getDatabase());
  }

  async syncFromHadeethEncApi(customTopic = null) {
    const query = String(customTopic || '').trim();
    if (!query) throw Error('اكتب عبارة للبحث في موسوعة الأحاديث النبوية.');
    const get = async (url) => {
      const r = await (this.fetchFn || fetch)(url, { signal: AbortSignal.timeout(20000) });
      if (!r?.ok) throw Error('HTTP ' + r?.status);
      return r.json();
    };
    const response = await get(
      'https://hadeethenc.com/api/v1/hadeeths/search/?language=ar&phrase=' +
        encodeURIComponent(query),
    );
    const rows = Array.isArray(response)
      ? response
      : response?.suggestions?.id === null
        ? []
        : null;
    if (!rows) throw Error('استجابة البحث غير صالحة.');
    const ids = [...new Set(rows.map((r) => r.id).filter(Boolean))].slice(0, 40);
    if (!ids.length) throw Error('لم يُعثر على أحاديث لهذه العبارة.');
    const details = await get(
      'https://hadeethenc.com/api/v1/hadeeths/multiple/?language=ar&ids=' + ids.join(','),
    );
    if (!Array.isArray(details)) throw Error('استجابة تفاصيل الأحاديث غير صالحة.');
    const normalized = details.map((row) => this.fromHadeethEnc(row)).filter(Boolean);
    if (ids.some((id) => !normalized.some((row) => row.id === 'hadeethenc_' + id)))
      throw Error('تفاصيل بعض النتائج ناقصة؛ لم تُحدّث المكتبة.');
    if (!normalized.length) throw Error('لم يتوفر متن ودرجة وشرح صالح لهذه النتائج.');
    const db = this.getDatabase(),
      known = new Set(db.hadiths.map((r) => r.id));
    let addedCount = 0;
    for (const row of normalized) {
      const existing = db.hadiths.find((h) => h.id === row.id);
      if (existing) Object.assign(existing, row);
      else {
        db.hadiths.push(row);
        addedCount++;
      }
    }
    db.currentHadith = db.hadiths.find((h) => h.id === normalized[0].id);
    db.lastSyncedAt = new Date().toISOString();
    this.saveDatabase(db);
    return {
      success: true,
      addedCount,
      totalStored: db.hadiths.length,
      parsedCount: normalized.length,
      topic: query,
      sampleHadith: db.currentHadith,
      message: 'تم تحديث المكتبة من موسوعة الأحاديث النبوية.',
    };
  }

  fromHadeethEnc(row) {
    const text = String(row.hadeeth || row.hadith_text || '').trim();
    if (!row.id || !text || !row.grade || !row.explanation) return null;
    const plain = text.replace(/[\u064b-\u065f\u0670]/g, '');
    const rawi =
      plain.match(/^عن\s+(.{2,100}?)(?=\s+رضي الله|\s+قال[:\s]|\s+قالت[:\s])/u)?.[1] ||
      'غير مذكور على استقلال في المصدر';
    const sourceUrl = 'https://hadeethenc.com/ar/browse/hadith/' + row.id;
    return {
      id: 'hadeethenc_' + row.id,
      text,
      rawi,
      mohdith: row.muhaddith || 'غير مذكور في المصدر',
      book: row.attribution || 'موسوعة الأحاديث النبوية',
      grade: row.grade,
      gradeSource: 'HadeethEnc — موسوعة الأحاديث النبوية',
      sourceUrl,
      topic: 'أحاديث مشروحة',
      sourceType: 'hadeethenc',
      sharhSource: 'HadeethEnc',
      sharh: this.cleanSharh(row, 'HadeethEnc', sourceUrl),
      fingerprint: this.computeFingerprint(text),
    };
  }

  setFetchFn(fn) {
    this.fetchFn = fn;
  }

  computeFingerprint(text) {
    const normalized = String(text || '')
      .replace(/[\u064B-\u065F]/g, '') // Remove Arabic diacritics.
      .replace(/[^\u0621-\u064A0-9a-zA-Z]/g, ' ') // Keep Arabic and Latin letters and digits as search tokens.
      .replace(/\s+/g, ' ')
      .trim();
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 24);
  }

  initializeLocalDatabase() {
    const seedHadiths = this.storage.readJsonSafe(this.seedPath, []);
    let cached = this.storage.readJsonSafe(this.cachePath, null);
    if (cached?.hadiths?.some((row) => row.sourceType !== 'hadeethenc')) {
      cached = {
        hadiths: seedHadiths,
        shownFingerprints: [],
        currentHadith: seedHadiths[0] || null,
        lastPrayerKey: null,
        lastSyncedAt: null,
      };
      if (!this.storage.writeJsonSafe(this.cachePath, cached))
        throw Error('تعذر استبدال قاعدة الأحاديث القديمة.');
    }

    if (!cached || !Array.isArray(cached.hadiths) || cached.hadiths.length === 0) {
      const enrichedSeed = seedHadiths.map((h) => ({
        ...h,
        fingerprint: this.computeFingerprint(h.text),
        sourceType: 'seed_bundled',
        addedAt: new Date().toISOString(),
      }));

      const initialDb = {
        hadiths: enrichedSeed,
        shownFingerprints: [],
        currentHadith: enrichedSeed[0] || null,
        lastPrayerKey: null,
        lastSyncedAt: null,
      };
      if (!this.storage.writeJsonSafe(this.cachePath, initialDb))
        throw new Error('تعذر إنشاء مخزن الأحاديث في مجلد بيانات المستخدم.');
    }
  }

  getDatabase() {
    this.initializeLocalDatabase();
    return this.storage.readJsonSafe(this.cachePath, {
      hadiths: [],
      shownFingerprints: [],
      currentHadith: null,
      lastPrayerKey: null,
    });
  }

  saveDatabase(db) {
    if (!this.storage.writeJsonSafe(this.cachePath, db))
      throw new Error('تعذر حفظ مخزن الأحاديث في مجلد بيانات المستخدم.');
  }

  /** Select a cached hadith for this prayer without repeating its fingerprint. */
  getHadithForPrayer(prayerKey = 'general', forceRotate = false) {
    const db = this.getDatabase();
    if (!forceRotate && db.currentHadith && db.lastPrayerKey === prayerKey) {
      return this.buildState(db);
    }

    const shownSet = new Set(db.shownFingerprints || []);
    let unshownList = db.hadiths.filter((h) => !shownSet.has(h.fingerprint));

    // Start a new cycle after exhaustion, avoiding an immediate repeat of the last hadith.
    if (unshownList.length === 0) {
      db.shownFingerprints = [];
      unshownList = db.hadiths.filter(
        (h) => !db.currentHadith || h.fingerprint !== db.currentHadith.fingerprint,
      );
      if (unshownList.length === 0) unshownList = db.hadiths;
    }

    const selected = unshownList[Math.floor(Math.random() * unshownList.length)];
    if (selected) {
      db.shownFingerprints.push(selected.fingerprint);
      db.currentHadith = selected;
      db.lastPrayerKey = prayerKey;
      this.saveDatabase(db);
    }

    return this.buildState(db);
  }
}
module.exports = HadithEngine;
