const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { resolve, recommend, detectHardware } = require('./src/engines/performance-engine');
const machines = [
  ['2 GB dual core', { memoryGB: 2, logicalCores: 2, cpuMHz: 1100 }, 'eco'],
  ['4 GB four threads', { memoryGB: 4, logicalCores: 4, cpuMHz: 2500 }, 'eco'],
  ['8 GB weak dual core', { memoryGB: 8, logicalCores: 2, cpuMHz: 3000 }, 'eco'],
  ['8 GB quad core', { memoryGB: 8, logicalCores: 4, cpuMHz: 2400 }, 'balanced'],
  ['16 GB low-clock four threads', { memoryGB: 16, logicalCores: 4, cpuMHz: 1600 }, 'eco'],
  ['16 GB older CPU', { memoryGB: 16, logicalCores: 8, cpuMHz: 2000 }, 'balanced'],
  ['16 GB modern CPU', { memoryGB: 16, logicalCores: 8, cpuMHz: 3200 }, 'full'],
  ['32 GB workstation', { memoryGB: 32, logicalCores: 16, cpuMHz: 3600 }, 'full'],
  ['unknown frequency', { memoryGB: 8, logicalCores: 4, cpuMHz: 0 }, 'balanced'],
];
for (const [name, hardware, level] of machines)
  test('automatic profile: ' + name, () => {
    assert.equal(recommend(hardware), level);
    assert.equal(resolve({}, hardware).profile.id, level);
  });
test('manual profiles override detection without altering the recommendation', () => {
  const h = { memoryGB: 4, logicalCores: 2, cpuMHz: 1200 };
  for (const level of ['eco', 'balanced', 'full']) {
    const result = resolve({ performance: { level } }, h);
    assert.equal(result.profile.id, level);
    assert.equal(result.recommended, 'eco');
  }
  assert.equal(resolve({ performance: { level: 'bad' } }, h).selection, 'auto');
});
test('economy enforces six cards without images and hardware inspection does not benchmark', () => {
  const result = resolve(
    {},
    detectHardware({
      totalmem: () => 4 * 1073741824,
      cpus: () => Array.from({ length: 2 }, () => ({ speed: 1000, model: 'mock' })),
    }),
  );
  assert.equal(result.profile.batchSize, 6);
  assert.equal(result.profile.images, false);
  assert.equal(result.profile.paged, true);
});
