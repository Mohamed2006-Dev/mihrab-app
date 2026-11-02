const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
function fixture(level) {
  const events = [],
    timers = new Map();
  let timerId = 0,
    requests = 0,
    observed = 0;
  const node = () => ({
    dataset: {},
    addEventListener: (name, fn) => events.push(name),
    removeEventListener() {},
    replaceChildren() {},
    querySelectorAll: () => [],
    setAttribute() {},
    append() {},
    isConnected: true,
  });
  const root = { ...node(), scrollTop: 0, scrollHeight: 800, clientHeight: 400 };
  const context = {
    window: {
      mihrabPerformance: { profile: { id: level, batchSize: 6 } },
      mihrabApi: {
        getYoutubePage: async ({ offset }) => {
          requests++;
          return {
            offset,
            total: 30,
            videos: Array.from({ length: 6 }, (_, n) => ({ id: offset + n })),
          };
        },
      },
    },
    document: { createElement: node, createDocumentFragment: node },
    IntersectionObserver: class {
      constructor(fn) {
        this.fn = fn;
      }
      observe() {
        observed++;
      }
      disconnect() {}
    },
    setTimeout: (fn, ms) => {
      assert.equal(ms, 1200);
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(
    fs.readFileSync(require('node:path').join(__dirname, 'src/ui/paged-lesson-feed.js'), 'utf8'),
    context,
  );
  const feed = new context.window.MihrabPagedLessonFeed({
    grid: node(),
    root,
    createCard: node,
    onCount() {},
    onError: (e) => {
      throw e;
    },
    emptyState: node,
  });
  return { feed, events, timers, requests: () => requests, observed: () => observed };
}
test('economy paging has no scroll gestures, observers or automatic replacement', async () => {
  const f = fixture('eco');
  f.feed.setActive(true);
  await new Promise(setImmediate);
  assert.equal(f.requests(), 1);
  assert.equal(f.observed(), 0);
  assert(!f.events.includes('wheel'));
  assert(!f.events.includes('touchend'));
  f.feed.schedulePage('next');
  assert.equal(f.timers.size, 0);
  await f.feed.load(6, true);
  assert.equal(f.requests(), 2);
  assert.equal(f.feed.offset, 6);
});
test('balanced paging waits before replacing content and cancels on departure', async () => {
  const f = fixture('balanced');
  f.feed.setActive(true);
  await new Promise(setImmediate);
  f.feed.schedulePage('next');
  assert.equal(f.requests(), 1);
  assert.equal(f.timers.size, 1);
  const run = [...f.timers.values()][0];
  run();
  await new Promise(setImmediate);
  assert.equal(f.requests(), 2);
  assert.equal(f.feed.offset, 6);
  f.feed.schedulePage('next');
  f.feed.setActive(false);
  assert.equal(f.timers.size, 0);
});
test('manual paging cancels an outstanding automatic transition', async () => {
  const f = fixture('balanced');
  f.feed.setActive(true);
  await new Promise(setImmediate);
  f.feed.schedulePage('next');
  await f.feed.load(6, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.requests(), 2);
});
test('video notifications open only a canonical YouTube URL and respect network policy', async () => {
  const { openVideo } = require('./src/engines/video-notification');
  let url;
  const options = { config: {}, shell: { openExternal: async (value) => (url = value) } };
  await openVideo({ video: { videoId: 'abcdefghijk', url: 'https://untrusted.invalid' } }, options);
  assert.equal(url, 'https://www.youtube.com/watch?v=abcdefghijk');
  await assert.rejects(openVideo({ video: { videoId: '../../bad' } }, options));
  await assert.rejects(
    openVideo(
      { video: { videoId: 'abcdefghijk' } },
      { ...options, config: { network: { enabled: false } } },
    ),
  );
});
