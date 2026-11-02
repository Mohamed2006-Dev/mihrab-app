const { parentPort, workerData } = require('worker_threads'),
  fs = require('fs'),
  path = require('path'),
  YouTube = require('./youtube-rss-engine');
try {
  const { baseDir, dataDir, config, offset, limit, channelIds, contextIds, recommendedVideoId } =
    workerData;
  const storage = {
    baseDir,
    dataDir,
    writableDir: path.dirname(dataDir),
    youtubeCachePath: path.join(dataDir, 'youtube-cache.json'),
    getConfig: () => config,
    readJsonSafe: (file, fallback) =>
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback,
    writeJsonSafe: () => {
      throw Error('لا يسمح قارئ الصفحات بتعديل الملفات.');
    },
  };
  const engine = new YouTube(storage, baseDir, null, { readOnly: true }),
    feed = engine.getFeedState('all');
  const filtered = feed.videos
    .filter(
      (v) =>
        (!channelIds.length || channelIds.includes(v.channelId)) &&
        (!contextIds.length || contextIds.includes(v.contextId)),
    )
    .sort(
      (a, b) =>
        new Date(b.pubDate || b.published || 0) - new Date(a.pubDate || a.published || 0) ||
        a.videoId.localeCompare(b.videoId),
    );
  const queues = new Map();
  for (const video of filtered) {
    if (!queues.has(video.channelId)) queues.set(video.channelId, []);
    queues.get(video.channelId).push(video);
  }
  const videos = [];
  for (let i = 0; videos.length < filtered.length; i++)
    for (const queue of queues.values()) if (queue[i]) videos.push(queue[i]);
  const pinned = videos.findIndex((v) => v.videoId === recommendedVideoId);
  if (pinned > 0) videos.unshift(...videos.splice(pinned, 1));
  const start = Math.min(
    Math.max(0, offset),
    Math.max(0, Math.floor((videos.length - 1) / limit) * limit),
  );
  const page = videos.slice(start, start + limit).map(({ description, ...video }) => video);
  parentPort.postMessage({ videos: page, total: videos.length, offset: start, limit });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}

parentPort.close();
