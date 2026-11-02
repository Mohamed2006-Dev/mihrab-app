const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Engine = require('./src/engines/youtube-rss-engine');

const ID = 'UCahYlNszeMy_PHffYvgAOHg';
const OTHER = 'UCWjCSGhmSGu0VLf2mPFS0Kg';
const TITLE = 'الدكتور إياد قنيبي - القناة الرسمية';
const feed = (entries = '', title = TITLE) => `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<id>yt:channel:${ID.slice(2)}</id><yt:channelId>${ID.slice(2)}</yt:channelId><title>${title}</title>${entries}</feed>`;
const entry = (id = 'mJicnGqY7e0', title = 'درس &amp; علم', extra = '') => `<entry>
<yt:videoId>${id}</yt:videoId><title>${title}</title><published>2026-10-30T12:00:00Z</published>${extra}</entry>`;
const page = `<html><head><title>${TITLE} - YouTube</title></head><script>{"channelMetadataRenderer":{"externalId":"${ID}"}}</script></html>`;
const response = (text, status = 200) => ({ status, ok: status === 200, text: async () => text });

function setup(fetchFn, channels = []) {
  let config = { youtube: { channels } };
  const files = new Map();
  const storage = {
    dataDir: path.join(__dirname, 'user-data', 'data'),
    youtubeCachePath: path.join(__dirname, 'user-data', 'data', 'youtube-cache.json'),
    getConfig: () => config,
    saveConfig: (patch) => {
      config = { ...config, ...patch };
      return config;
    },
    readJsonSafe: (file, fallback) =>
      file.endsWith('youtube-contexts.json')
        ? {
            contexts: [{ id: 'ctx_01', title: 'العلم', keywords: ['علم'] }],
            defaultChannels: [{ channelId: OTHER }],
          }
        : files.get(file) || fallback,
    writeJsonSafe: (file, value) => {
      files.set(file, value);
      return true;
    },
  };
  return {
    engine: new Engine(storage, __dirname, fetchFn, { retryDelayMs: 0, requestTimeoutMs: 100 }),
    storage,
    files,
  };
}

test('the reported channel ID is accepted and its real Atom format is parsed and cached', async () => {
  const { engine, storage, files } = setup(async () => response(feed(entry())));
  const result = await engine.addChannel({ channelId: ID });
  assert.equal(result.channel.name, TITLE);
  assert.equal(result.warning, null);
  const videos = files.get(storage.youtubeCachePath).videos;
  assert.equal(videos[0].title, 'درس & علم');
  assert.equal(videos[0].url, 'https://www.youtube.com/watch?v=mJicnGqY7e0');
  assert.equal(engine.getFeedState().allVideosCount, 1);
  assert.notEqual(engine.cachePath, path.join(__dirname, 'data', 'youtube-cache.json'));
});

test('a transient RSS 404 is retried instead of being reported as a missing channel', async () => {
  let calls = 0;
  const { engine } = setup(async () =>
    ++calls === 1 ? response('Not found', 404) : response(feed(entry())),
  );
  const result = await engine.addChannel({ channelId: ID });
  assert.equal(calls, 2);
  assert.equal(result.channel.channelId, ID);
  assert.equal(result.warning, null);
});

test('persistent feed failure saves only a channel confirmed by its own page, with an explicit warning', async () => {
  let feedCalls = 0;
  const { engine } = setup(async (url) => {
    if (url.includes('/feeds/')) {
      feedCalls++;
      return response('Not found', 404);
    }
    return response(page);
  });
  const result = await engine.addChannel({ channelId: ID });
  assert.equal(feedCalls, 3);
  assert.equal(result.channel.name, TITLE);
  assert.match(result.warning, /تعذر جلب المقاطع/);
  assert.equal(engine.getChannels().length, 1);
  assert.equal(engine.getFeedState().allVideosCount, 0);
});

test('a missing or mismatched channel page cannot create a subscription', async () => {
  for (const channelResponse of [response('Not found', 404), response(page.replace(ID, OTHER))]) {
    const { engine } = setup(async (url) =>
      url.includes('/feeds/') ? response('failure', 503) : channelResponse,
    );
    await assert.rejects(engine.addChannel({ channelId: ID }));
    assert.equal(engine.getChannels().length, 0);
  }
});

test('a valid channel feed with no uploads is accepted without a false missing-channel error', async () => {
  const { engine } = setup(async () => response(feed()));
  const result = await engine.addChannel({ channelId: ID });
  assert.equal(result.warning, null);
  assert.equal(result.channel.name, TITLE);
});

test('the static PubSub hub feed and HTML block pages are not mistaken for channel data', async () => {
  for (const payload of [
    '<feed><title>YouTube video feed</title></feed>',
    '<html>Consent required</html>',
  ]) {
    const { engine } = setup(async () => response(payload));
    await assert.rejects(engine.fetchChannelRss(ID), /تعذر جلب خلاصة/);
  }
});

test('requests and response bodies time out, and the request is aborted', async () => {
  for (const bodyHangs of [false, true]) {
    let signal;
    const { engine } = setup(async (_, options) => {
      signal = options.signal;
      if (bodyHangs) return { status: 200, text: () => new Promise(() => {}) };
      return new Promise(() => {});
    });
    engine.requestTimeoutMs = 5;
    engine.maxAttempts = 1;
    await assert.rejects(engine.fetchChannelRss(ID), /مهلة الاتصال/);
    assert.equal(signal.aborted, true);
  }
});

test('handles use owner metadata rather than a recommended channel, and direct URLs and RSS URLs resolve', async () => {
  const { engine } = setup(async () =>
    response(`<script>{"channelId":"${OTHER}"}</script>${page}`),
  );
  for (const input of [
    ID,
    `\u200f${ID}\u200f`,
    `https://www.youtube.com/channel/${ID}?si=abc`,
    '@EyadQunaibi',
    `youtube.com/channel/${ID}`,
    `https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`,
  ]) {
    assert.equal(await engine.resolveChannelId(input), ID);
  }
  await assert.rejects(engine.resolveChannelId(`https://example.com/channel/${ID}`));
  await assert.rejects(engine.resolveChannelId('UCinvalid'));
});

test('CDATA, numeric entities, thumbnails and Shorts links are handled correctly', async () => {
  const { engine } = setup(async () =>
    response(
      feed(
        entry(
          'mJicnGqY7e0',
          '<![CDATA[درس <العلم>]]>',
          '<media:thumbnail url="https://i.ytimg.com/vi/mJicnGqY7e0/hqdefault.jpg?a=1&amp;b=2"/>',
        ) +
          entry('abcdefghijk', 'درس &#x627;&#1604;&#1593;&#1604;&#1605;') +
          entry(
            '12345678901',
            'قصير',
            '<link rel="alternate" href="https://www.youtube.com/shorts/12345678901"/>',
          ) +
          entry('98765432101', 'درس #shorts') +
          entry('invalid', 'معرف غير صالح'),
      ),
    ),
  );
  const result = await engine.fetchChannelRss(ID);
  assert.equal(result.videos.length, 2);
  assert.equal(result.videos[0].title, 'درس <العلم>');
  assert.match(result.videos[0].thumbnailUrl, /a=1&b=2$/);
  assert.equal(result.videos[1].title, 'درس العلم');
});

test('refresh failure keeps saved lessons and reports the error; deleting the last channel stays empty', async () => {
  const { engine } = setup(async () => response('failure', 503), [{ channelId: ID, name: TITLE }]);
  engine.mergeVideosIntoCache([
    {
      videoId: 'mJicnGqY7e0',
      channelId: ID,
      title: 'درس',
      published: '2026-10-01',
      url: 'https://www.youtube.com/watch?v=mJicnGqY7e0',
    },
  ]);
  const state = await engine.refreshFeeds();
  assert.equal(state.networkErrors.length, 1);
  assert.equal(state.videos.length, 1);
  engine.removeChannel(ID);
  assert.deepEqual(engine.getChannels(), []);
  assert.deepEqual(engine.getFeedState().videos, []);
  assert.deepEqual((await engine.refreshFeeds()).videos, []);
});

test('new uploads precede old cached uploads and duplicates are replaced', () => {
  const { engine } = setup(null, [{ channelId: ID }]);
  const video = (videoId, published, title = 'درس') => ({
    videoId,
    channelId: ID,
    title,
    published,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  });
  engine.mergeVideosIntoCache([video('abcdefghijk', '2026-10-01')]);
  const result = engine.mergeVideosIntoCache([
    video('mJicnGqY7e0', '2026-11-01'),
    video('abcdefghijk', '2026-10-01', 'عنوان مصحح'),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].videoId, 'mJicnGqY7e0');
  assert.equal(result[1].title, 'عنوان مصحح');
});

test('a cache write failure is surfaced instead of reporting a successful refresh', async () => {
  const { engine, storage } = setup(async () => response(feed()), [{ channelId: ID }]);
  storage.writeJsonSafe = () => false;
  await assert.rejects(engine.refreshFeeds(), /تعذر حفظ مقاطع/);
});
