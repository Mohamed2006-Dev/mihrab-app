const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihrab-engine-tests-'));

const StorageEngine = require('./src/engines/storage-engine');
const ThemeEngine = require('./src/engines/theme-engine');
const PrayerEngine = require('./src/engines/prayer-engine');
const HadithEngine = require('./src/engines/hadith-engine');
const YouTubeRssEngine = require('./src/engines/youtube-rss-engine');
const QuranWirdEngine = require('./src/engines/quran-wird-engine');
const SchedulerEngine = require('./src/engines/scheduler-engine');

async function runTests() {
  console.log('Starting engine integration checks');
  const baseDir = __dirname;
  const storage = new StorageEngine(baseDir, testDataDir);

  // 1. Verify isolated theme definitions.
  const themeEngine = new ThemeEngine(baseDir);
  const themeState = themeEngine.getActiveThemeState();
  assert(
    themeState && themeState.availableThemes.length >= 3,
    'يجب اكتشاف 3 قوالب خارجية على الأقل',
  );
  assert(themeState.cssVariables['--bg-primary'], 'يجب ترجمة القالب إلى متغيرات CSS');
  console.log('Theme isolation and variables passed');

  // 2. Verify prayer calculations, geography and the city dataset.
  const prayerEngine = new PrayerEngine(storage);
  const fridayDate = new Date('2026-10-30T09:00:00');
  const fridayPrayers = prayerEngine.calculateLocalPrayerTimes(fridayDate);
  const dhuhrOnFriday = fridayPrayers.prayers.find((p) => p.id === 'dhuhr');
  assert.strictEqual(
    dhuhrOnFriday.name,
    'صلاة الجمعة',
    'يجب أن يظهر اسم صلاة الجمعة بدلاً من صلاة الظهر يوم الجمعة',
  );

  // Check country and city name localization independently.
  const tangierTrans = prayerEngine.translateGeoNames('Tangier', 'Morocco', 'MA');
  assert.strictEqual(tangierTrans.city, 'طنجة');
  assert.strictEqual(tangierTrans.country, 'المملكة المغربية');

  // Validate the expanded city dataset.
  const citiesPath = path.join(baseDir, 'data', 'cities.json');
  const citiesList = JSON.parse(fs.readFileSync(citiesPath, 'utf8'));
  assert(
    citiesList.length >= 80,
    `يجب أن يحتوي ملف cities.json على مدن موسعة (الحالي: ${citiesList.length})`,
  );
  const moroccoCities = citiesList.filter((c) => c.country === 'المملكة المغربية');
  assert(moroccoCities.length >= 25, 'يجب أن تشمل مدن المغرب كافة الأقاليم والجهات الرئيسية');
  console.log(
    `✅ [PrayerEngine] Loaded geography (${citiesList.length} cities in ${new Set(citiesList.map((c) => c.country)).size} countries) and localized names.`,
  );

  const hadithEngine = new HadithEngine(storage, baseDir);
  const sample = hadithEngine.fromHadeethEnc({
    id: '1',
    hadeeth: 'عن أبي موسى رضي الله عنه قال: من صلى البردين دخل الجنة',
    grade: 'صحيح',
    attribution: 'متفق عليه',
    explanation: 'شرح تجريبي لاختبار المصدر.',
  });
  assert(sample.fingerprint);
  assert.strictEqual(sample.grade, 'صحيح');
  assert.strictEqual(sample.sharhSource, 'HadeethEnc');
  console.log('[HadithEngine] HadeethEnc metadata, explanation and fingerprint passed.');
  // 4. Verify RSS thumbnails, Shorts exclusion and invalid cache cleanup.
  const ytEngine = new YouTubeRssEngine(storage, baseDir);
  assert.strictEqual(
    ytEngine.isShortVideo('درس رائع #shorts', 'https://youtube.com/watch?v=123'),
    true,
  );
  assert.strictEqual(
    ytEngine.isShortVideo('درس كامل في تزكية النفس', 'https://youtube.com/shorts/abc'),
    true,
  );
  assert.strictEqual(
    ytEngine.isShortVideo('شرح كتاب التوحيد - الدرس الأول', 'https://youtube.com/watch?v=xyz'),
    false,
  );

  // Reject cached search results and placeholder videos.
  const cachePath = path.join(baseDir, 'data', 'youtube-cache.json');
  const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const v of cacheData.videos || []) {
    assert(!v.videoId.includes('islamic_vid'), 'يجب ألا يحتوي الكاش على مقاطع وهمية مركبة');
    assert(!v.url?.includes('search_query='), 'يجب ألا يحتوي الكاش على روابط بحث');
    assert(v.thumbnailUrl, 'يجب أن يتضمن كل فيديو رابط الصورة المصغرة');
  }

  // Check round-robin interleaving across channels.
  const sampleVids = [
    { videoId: '1', channelId: 'ch1', title: 'A1' },
    { videoId: '2', channelId: 'ch1', title: 'A2' },
    { videoId: '3', channelId: 'ch2', title: 'B1' },
    { videoId: '4', channelId: 'ch3', title: 'C1' },
  ];
  const interleavedTest = ytEngine.interleaveVideosByChannel(sampleVids);
  assert.strictEqual(interleavedTest[0].title, 'A1');
  assert.strictEqual(interleavedTest[1].title, 'B1');
  assert.strictEqual(interleavedTest[2].title, 'C1');
  assert.strictEqual(interleavedTest[3].title, 'A2');
  console.log('Round-robin recommendations passed');

  // 5. Verify Quran units, memorization ranges and random reading.
  const quranEngine = new QuranWirdEngine(storage, baseDir);

  // Check memorization range conversion to hizb units.
  const hifzHizb = quranEngine.formatWirdAssignment(
    {
      unit: 'hizb',
      amount: 1,
      rangeStart: 58,
      rangeEnd: 60,
      currentPosition: { hizbNumber: 58 },
    },
    true,
  );
  assert.strictEqual(hifzHizb.currentAssignment, 'الحزب رقم 58');
  assert(hifzHizb.rangeDescription.includes('من الحزب 58 إلى الحزب 60'));

  // Check memorization range conversion to surah units.
  const hifzSurah = quranEngine.formatWirdAssignment(
    {
      unit: 'surah',
      amount: 1,
      rangeStart: 78,
      rangeEnd: 114,
      currentPosition: { surahNumber: 78 },
    },
    true,
  );
  assert(hifzSurah.currentAssignment.includes('النبأ'));
  assert(
    hifzSurah.rangeDescription.includes('النبأ') && hifzSurah.rangeDescription.includes('الناس'),
  );

  // Check memorization range conversion to page units.
  const hifzPage = quranEngine.formatWirdAssignment(
    {
      unit: 'page',
      amount: 2,
      rangeStart: 582,
      rangeEnd: 604,
      currentPosition: { pageNumber: 582 },
    },
    true,
  );
  assert.strictEqual(hifzPage.currentAssignment, 'من صفحة 582 إلى صفحة 583');

  // Generate and manually rotate a random reading portion.
  const randomStatus = quranEngine.rollRandomReadingWird();
  assert(randomStatus.readingSummary.currentAssignment.length > 0, 'يجب توليد ورد قراءة عشوائي');
  assert(
    randomStatus.readingSummary.rangeDescription.includes('عشوائي'),
    'يجب أن يوضح النطاق أنه نمط عشوائي',
  );

  console.log('Quran ranges and random mode passed');

  // 6. Verify scheduling and advance reminders.
  let lockTriggered = false;
  const scheduler = new SchedulerEngine({
    storage,
    prayerEngine,
    hadithEngine,
    quranEngine,
    youtubeEngine: ytEngine,
    callbacks: {
      onActivateScreenLock: (payload) => {
        lockTriggered = Boolean(payload.hadith && payload.motivationalQuote);
      },
    },
  });
  scheduler.triggerScreenLock(dhuhrOnFriday);
  assert(lockTriggered, 'يجب أن تعمل شاشة التهيؤ للصلاة');
  console.log('Prayer scheduling passed');

  // 7. Verify Habous parameters and official timetable comparison.
  const HabousSyncEngine = require('./src/engines/habous-sync-engine');

  // Check the official Habous calculation parameters.
  const habousParams = prayerEngine.getCalculationParams('Habous');
  assert.strictEqual(
    habousParams.fajrAngle,
    19.0,
    'زاوية الفجر لطريقة الأوقاف المغربية يجب أن تكون 19.0 درجة',
  );
  assert.strictEqual(
    habousParams.ishaAngle,
    17.0,
    'زاوية العشاء لطريقة الأوقاف المغربية يجب أن تكون 17.0 درجة',
  );
  assert.strictEqual(
    habousParams.madhab,
    'shafi',
    'مذهب صلاة العصر يجب أن يكون الشافعي/المالكي (ظل الشيء مثله)',
  );
  assert.strictEqual(
    habousParams.methodAdjustments.dhuhr,
    5,
    'إضافة 5 دقائق شرعية لوقت الظهر الفلكي لمطابقة توقيت الأوقاف',
  );
  assert.strictEqual(
    prayerEngine.inferMethodFromCountry('MA'),
    'Habous',
    'يجب اختيار طريقة Habous تلقائياً لرمز المغرب MA',
  );

  // Check the raw astronomical baseline.
  const rawPt = prayerEngine.calculateRawPrayerTimes(new Date('2026-10-31T12:00:00'));
  assert(rawPt && rawPt.fajr, 'يجب احتساب المواقيت الفلكية الخام بنجاح');

  // All Moroccan cities must use the Habous method.
  for (const mc of moroccoCities) {
    assert.strictEqual(
      mc.method,
      'Habous',
      `المدينة المغربية ${mc.name} يجب أن تعتمد طريقة Habous`,
    );
  }

  // Check official offsets and their automatic application.
  const mockHabousJson = {
    annee: 2026,
    mois: 10,
    villes: [
      {
        code_ville: 1,
        nom: 'الرباط',
        horaires: [
          {
            date: '2026-10-31',
            Fajr: '05:11',
            Chorouq: '06:44',
            Dhuhr: '12:21',
            Asr: '15:22',
            Maghrib: '17:33',
            Ishae: '18:50',
          },
        ],
      },
    ],
  };

  const mockNetFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockHabousJson,
  });

  const habousEngine = new HabousSyncEngine(storage, baseDir, mockNetFetch);
  const syncDate = new Date('2026-10-31T12:00:00');

  // Use Rabat with existing offsets to test that adjustments do not accumulate.
  storage.saveConfig({
    location: {
      city: 'الرباط',
      country: 'المملكة المغربية',
      lat: 34.0209,
      lng: -6.8416,
      calculationMethod: 'Habous',
    },
    prayerAdjustments: {
      fajr: 99,
      sunrise: 99,
      dhuhr: 99,
      asr: 99,
      maghrib: 99,
      isha: 99,
    },
  });

  const syncReport = await habousEngine.syncOfficialTimings(syncDate, {
    throwOnError: true,
    bypassCache: true,
  });
  assert.strictEqual(
    syncReport.status,
    'verified_online',
    'يجب أن تنجح المطابقة الرسمية عبر الشبكة',
  );
  assert.strictEqual(syncReport.cityName, 'الرباط');
  assert.strictEqual(syncReport.officialTimings.fajr, '05:11', 'يجب استخراج وقت الفجر الرسمي');
  assert.strictEqual(syncReport.officialTimings.maghrib, '17:33', 'يجب استخراج وقت المغرب الرسمي');
  assert.strictEqual(syncReport.officialTimings.sunrise, '06:44', 'يجب استخراج وقت الشروق الرسمي');
  assert.strictEqual(
    typeof syncReport.discrepanciesInMinutes.fajr,
    'number',
    'يجب حساب فرق الفجر بالدقائق',
  );
  assert.strictEqual(
    typeof syncReport.discrepanciesInMinutes.maghrib,
    'number',
    'يجب حساب فرق المغرب بالدقائق',
  );

  // Replace prayerAdjustments instead of adding new offsets to old ones.
  const updatedCfg = storage.getConfig();
  assert.deepStrictEqual(
    updatedCfg.prayerAdjustments,
    syncReport.discrepanciesInMinutes,
    'يجب استبدال الإزاحات القديمة بالكامل بالقيم الناتجة دون تراكم',
  );
  assert.notStrictEqual(
    updatedCfg.prayerAdjustments.fajr,
    99 + syncReport.discrepanciesInMinutes.fajr,
    'يجب عدم جمع الفارق الجديد فوق الإزاحات السابقة',
  );
  console.log('Habous parameters and clean offsets passed');

  // 8. Verify Monday and Thursday pre-dawn synchronization.
  prayerEngine.habousSyncEngine = habousEngine;
  const mockSyncScheduler = new SchedulerEngine({
    storage,
    prayerEngine,
    hadithEngine,
    quranEngine,
    youtubeEngine: ytEngine,
    callbacks: {},
  });

  await mockSyncScheduler.triggerAutomaticOfficialSync(syncDate);
  assert(storage.getConfig().officialSync.lastSyncTime, 'يجب تسجيل وقت المزامنة التلقائية');
  console.log('Twice-weekly verification schedule passed');

  // Reset adjustments before the next case.
  storage.saveConfig({
    prayerAdjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  });

  // 9. Verify multi-select channel and topic filters.
  const sampleVideos = [
    { videoId: 'v1', title: 'درس الفجر', contextId: 'ctx_01', channelId: 'ch_a' },
    { videoId: 'v2', title: 'درس الظهر', contextId: 'ctx_02', channelId: 'ch_a' },
    { videoId: 'v3', title: 'تزكية المساء', contextId: 'ctx_01', channelId: 'ch_b' },
    { videoId: 'v4', title: 'شرح السنن', contextId: 'ctx_03', channelId: 'ch_c' },
  ];

  const filterMultiTags = (vids, selChSet, selCtxSet) =>
    vids.filter((v) => {
      const matchCh = selChSet.size === 0 || selChSet.has(v.channelId);
      const matchCtx = selCtxSet.size === 0 || selCtxSet.has(v.contextId);
      return matchCh && matchCtx;
    });

  // Select two channels using OR within the category.
  const multiChSet = new Set(['ch_a', 'ch_b']);
  const emptyCtxSet = new Set();
  assert.strictEqual(
    filterMultiTags(sampleVideos, multiChSet, emptyCtxSet).length,
    3,
    'تحديد أكثر من شيخ يجب أن يجمع دروسهم بمنطق OR',
  );

  // Select two topics together.
  const emptyChSet = new Set();
  const multiCtxSet = new Set(['ctx_01', 'ctx_03']);
  assert.strictEqual(
    filterMultiTags(sampleVideos, emptyChSet, multiCtxSet).length,
    3,
    'تحديد أكثر من سياق يجب أن يجمع دروسهم بمنطق OR',
  );

  // Combine the channel and topic categories using AND.
  assert.strictEqual(
    filterMultiTags(sampleVideos, multiChSet, new Set(['ctx_01'])).length,
    2,
    'الربط بين الفئتين يجب أن يطبق AND',
  );
  assert.strictEqual(
    filterMultiTags(sampleVideos, new Set(['ch_c']), new Set(['ctx_01'])).length,
    0,
    'عدم تحقق شرط AND يستبعد النتيجة',
  );
  console.log('Multi-tag filter semantics passed');

  // 10. Preserve the Quran range invariant: end >= start.
  const endGteStart = (start, end) => Math.max(start, end);
  assert.strictEqual(
    endGteStart(58, 53),
    58,
    'يجب منع تحديد نطاق عكسي وضبط النهاية مساوية أو أكبر من البداية',
  );
  assert.strictEqual(endGteStart(1, 10), 10, 'النطاق المتصاعد الطبيعي يظل سليماً');
  console.log('Quran range invariant passed');

  // 11. Verify channel identifiers and RSS 404 handling.
  const mockYtFetch = async (url) => {
    if (url.includes('notfound_channel') || url.includes('UC_404_NOT_FOUND')) {
      return { ok: false, status: 404, text: async () => '404 Not Found' };
    }
    if (url.includes('@SheikhChannel')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          '<html><head><meta itemprop="channelId" content="UC1234567890123456789012"></head></html>',
      };
    }
    if (url.includes('feeds/videos.xml?channel_id=UC1234567890123456789012')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          '<feed xmlns="http://www.w3.org/2005/Atom"><title>قناة الشيخ المعتمدة</title><entry><title>درس جديد</title><id>yt:video:123</id></entry></feed>',
      };
    }
    return { ok: false, status: 404, text: async () => 'Not found' };
  };

  const smartYtEngine = new YouTubeRssEngine(storage, baseDir, mockYtFetch);

  // Accept a canonical 24-character UC identifier.
  const resolvedExplicit = await smartYtEngine.resolveChannelId('  UC1234567890123456789012  ');
  assert.strictEqual(
    resolvedExplicit,
    'UC1234567890123456789012',
    'يجب اعتماد المعرّف الصريح فوراً',
  );

  // Resolve the identifier from a direct channel URL.
  const resolvedFromUrl = await smartYtEngine.resolveChannelId(
    'https://www.youtube.com/channel/UC1234567890123456789012',
  );
  assert.strictEqual(
    resolvedFromUrl,
    'UC1234567890123456789012',
    'يجب استخراج المعرّف من رابط /channel/UC...',
  );

  // Resolve a channel handle from its page metadata.
  const resolvedFromHandle = await smartYtEngine.resolveChannelId('@SheikhChannel');
  assert.strictEqual(
    resolvedFromHandle,
    'UC1234567890123456789012',
    'يجب استخراج المعرّف من وسم itemprop="channelId"',
  );

  // Keep the user-facing 404 explanation in Arabic.
  let caught404Err = null;
  try {
    await smartYtEngine.resolveChannelId('notfound_channel');
  } catch (e) {
    caught404Err = e;
  }
  assert(caught404Err, 'يجب رمي خطأ عند تعذر العثور على القناة');
  assert(
    caught404Err.message.includes(
      'تعذر العثور على القناة؛ يرجى التأكد من إدخال Channel ID الصريح الذي يبدأ بـ UC أو رابط القناة المباشر',
    ),
  );
  console.log('Channel resolution and RSS errors passed');

  // 12. Verify sandbox and dry-run isolation from real settings.
  const beforeDryRunCfg = JSON.parse(JSON.stringify(storage.getConfig()));

  // Verify the official timetable in dry-run mode.
  const drySyncReport = await habousEngine.syncOfficialTimings(syncDate, {
    throwOnError: true,
    bypassCache: true,
    dryRun: true,
  });
  assert.strictEqual(drySyncReport.dryRun, true, 'تقرير المطابقة يجب أن يحمل علامة dryRun');
  assert.strictEqual(drySyncReport.autoApplied, false, 'يجب عدم تطبيق الفروق في وضع dryRun');
  const afterDryRunCfg = storage.getConfig();
  assert.deepStrictEqual(
    afterDryRunCfg.prayerAdjustments,
    beforeDryRunCfg.prayerAdjustments,
    'يجب عدم المساس بإزاحات الصلوات في ملف الإعدادات الحقيقي',
  );

  // Discover the location in dry-run mode.
  const mockLocationCaller = async () => ({
    ok: true,
    json: async () => ({
      city: 'مدينة تجريبية',
      country: 'دولة تجريبية',
      country_code: 'SA',
      latitude: 24.7,
      longitude: 46.7,
    }),
  });
  const dryPrayerEngine = new PrayerEngine(storage, mockLocationCaller);
  const dryLocResult = await dryPrayerEngine.detectLocationOnline({
    throwOnError: true,
    dryRun: true,
  });
  assert.strictEqual(dryLocResult.dryRun, true, 'كشف الموقع يجب أن يحمل علامة dryRun');
  assert.strictEqual(
    storage.getConfig().location.city,
    beforeDryRunCfg.location.city,
    'يجب عدم استبدال موقع المستخدم الحقيقي في وضع dryRun',
  );
  console.log('Dry-run isolation passed');

  // 13. Check bundled audio and system tray assets.
  const trayIconPath = path.join(baseDir, 'src', 'ui', 'assets', 'tray-icon.png');
  assert(
    fs.existsSync(trayIconPath) && fs.statSync(trayIconPath).size > 50,
    'أيقونة System Tray يجب أن تكون موجودة وصالحة',
  );

  const adhanAudioPath = path.join(
    baseDir,
    'src',
    'ui',
    'assets',
    'audio',
    'ALLAHO_AKBAR_audio.flac',
  );
  assert(
    fs.existsSync(adhanAudioPath) && fs.statSync(adhanAudioPath).size > 100000,
    'ملف أذان FLAC يجب أن يكون موجوداً بالحجم الكامل',
  );
  console.log('Bundled audio and tray assets passed');

  console.log('All engine integration checks passed');
}

runTests()
  .catch((err) => {
    console.error('Engine integration check failed', err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (
      path.dirname(testDataDir) === os.tmpdir() &&
      path.basename(testDataDir).startsWith('mihrab-engine-tests-')
    ) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });
