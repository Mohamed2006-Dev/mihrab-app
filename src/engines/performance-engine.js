const os = require('os');
const PROFILES = {
  full: {
    id: 'full',
    title: 'كامل',
    batchSize: 8,
    images: true,
    paged: false,
    animations: true,
    requestAttempts: 3,
  },
  balanced: {
    id: 'balanced',
    title: 'متوازن',
    batchSize: 6,
    images: true,
    paged: true,
    animations: false,
    requestAttempts: 2,
  },
  eco: {
    id: 'eco',
    title: 'اقتصادي',
    batchSize: 6,
    images: false,
    paged: true,
    animations: false,
    requestAttempts: 1,
  },
};
function detectHardware(source = os) {
  const cpus = source.cpus() || [],
    speeds = cpus.map((c) => c.speed).filter((n) => n > 0);
  return {
    memoryGB: Math.round((source.totalmem() / 1073741824) * 10) / 10,
    logicalCores: cpus.length || 1,
    cpuMHz: speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0,
    processor: cpus[0]?.model || 'غير معروف',
  };
}
function recommend(hw) {
  if (
    hw.memoryGB <= 4.5 ||
    hw.logicalCores <= 2 ||
    (hw.logicalCores <= 4 && hw.cpuMHz > 0 && hw.cpuMHz < 1700)
  )
    return 'eco';
  if (hw.memoryGB <= 8.5 || hw.logicalCores <= 4 || (hw.cpuMHz > 0 && hw.cpuMHz < 2200))
    return 'balanced';
  return 'full';
}
function resolve(config = {}, hw = detectHardware()) {
  const selection = ['auto', 'full', 'balanced', 'eco'].includes(config.performance?.level)
      ? config.performance.level
      : 'auto',
    recommended = recommend(hw);
  return {
    selection,
    recommended,
    hardware: hw,
    profile: PROFILES[selection === 'auto' ? recommended : selection],
  };
}
module.exports = { PROFILES, detectHardware, recommend, resolve };
