const { allowed } = require('./resource-engine');
async function openVideo(data, { shell, config }) {
  const id = data.video?.videoId;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('رابط المقطع غير صالح.');
  if (!allowed(config, 'youtube')) throw new Error('الوصول إلى يوتيوب متوقف في إعدادات الإنترنت.');
  await shell.openExternal('https://www.youtube.com/watch?v=' + id);
  return { opened: true };
}
module.exports = { openVideo };
