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
    batchSize: 4,
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
function recommend(hw, signals = {}) {
  const low = (value, threshold) => value > 0 && value <= threshold;
  if (low(hw.memoryGB, 4.5) || low(hw.logicalCores, 2) ||
      signals.powerSaver === true || signals.framePacing === 'poor' || signals.pressure === 2)
    return 'eco';
  if (!hw.memoryGB || !hw.logicalCores || low(hw.memoryGB, 8.5) || low(hw.logicalCores, 4) ||
      signals.lowBattery === true || signals.reducedMotion === true ||
      (['software', 'unavailable'].includes(signals.graphics) &&
        (low(hw.memoryGB, 12) || low(hw.logicalCores, 6))) ||
      signals.framePacing === 'mixed' || signals.pressure === 1)
    return 'balanced';
  return 'full';
}

function resolve(config = {}, hw = detectHardware(), signals = {}) {
  const selection = ['auto', 'full', 'balanced', 'eco'].includes(config.performance?.level)
      ? config.performance.level
      : 'auto',
    recommended = recommend(hw, signals);
  return {
    selection,
    recommended,
    hardware: hw,
    profile: PROFILES[selection === 'auto' ? recommended : selection],
  };
}
module.exports = { PROFILES, detectHardware, recommend, resolve };
