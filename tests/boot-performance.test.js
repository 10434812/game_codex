const test = require('node:test');
const assert = require('node:assert/strict');
const {createBootLoader, getBootAssetQueue} = require('../utils/boot-loader');
test('首屏只预载当前景区与首页资源，不抢跑对局素材和全部头像', () => {
  const urls = getBootAssetQueue({image: 'https://example.test/selected.jpg'});
  assert.ok(urls.includes('https://example.test/selected.jpg'));
  assert.equal(urls.some(url => /gamebg|fortune|effects/.test(url)), false);
  assert.equal(urls.length, new Set(urls).size); assert.ok(urls.length <= 12);
});
test('图片预载最多4个并发，退出后不再调度剩余图片或更新进度', async () => {
  const pending = [], progress = []; let started = 0, active = 0, maximum = 0;
  const loader = createBootLoader(Array.from({length: 12}, () => () => {
    started++; active++; maximum = Math.max(maximum, active);
    return new Promise(resolve => pending.push(() => {active--; resolve();}));
  }), percent => progress.push(percent));
  const done = loader.start(); assert.equal(started, 4);
  pending.shift()(); for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(started, 5); assert.equal(maximum, 4);
  const before = progress.length; loader.cancel();
  pending.splice(0).forEach(resolve => resolve()); await done;
  assert.equal(started, 5); assert.equal(progress.length, before);
});
