const {performance} = require('node:perf_hooks');
const assert = require('node:assert/strict');
const {loadArenaPage, makeArenaFrames} = require('../tests/helpers/arena-view-fixture');
const reference = process.argv[2];
const frames = makeArenaFrames(400);
function measure(source) {
  const page = loadArenaPage(source);
  let bytes = 0, calls = 0;
  const durations = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const snapshot of frames) {
      page.snapshot = snapshot; page.patches.length = 0;
      const start = performance.now(); page.draw(); durations.push(performance.now() - start);
      for (const patch of page.patches) {bytes += Buffer.byteLength(JSON.stringify(patch)); calls++;}
    }
  }
  durations.sort((a, b) => a - b);
  return {frames: durations.length, calls, bytes, totalMs: +durations.reduce((a, b) => a + b, 0).toFixed(2),
    p95Ms: +durations[Math.floor(durations.length * .95)].toFixed(3)};
}
if (reference) {
  const oldPage = loadArenaPage(reference), newPage = loadArenaPage();
  for (const snapshot of frames) {
    oldPage.snapshot = snapshot; newPage.snapshot = snapshot;
    oldPage.draw(); newPage.draw();
    assert.equal(JSON.stringify(newPage.data), JSON.stringify(oldPage.data), '每帧视图数据保持一致');
  }
  console.log('400 帧逐字段视图一致');
}
console.log(JSON.stringify({current: measure(), ...(reference ? {before: measure(reference)} : {})}));
