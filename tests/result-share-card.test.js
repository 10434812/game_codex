const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const {resultCard, resultShareTitle, loadResultAvatars, renderResultCard} = require('../utils/result-share-card');
const {prepareResultImage} = require('../utils/result-share-image');
function result() {return {coins: 60, ranking: [{name: '第一名', rank: 1, score: 999}, {name: '自己', avatar: 'https://example.com/avatar.png', rank: 2, score: 234, isSelf: true, name: '自己', avatar: 'https://example.com/avatar.png'}]};}
function context() {return {save() {}, restore() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, arc() {}, clip() {}, drawImage() {}, fill() {}, stroke() {}, createLinearGradient: () => ({addColorStop() {}}), fillText() {}, measureText: (value) => ({width: Array.from(value).length * 12})};}
function platform(t) {
  const original = global.wx, storage = new Map(); let started;
  const exporting = new Promise((resolve) => {started = resolve;});
  const canvas = {getContext: () => context()};
  const query = {in() {return this;}, select() {return this;}, fields() {return this;}, exec(done) {done([{node: canvas}]);}};
  global.wx = {getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), createSelectorQuery: () => query, canvasToTempFilePath: (options) => started(options)};
  api.setToken('account-a'); t.after(() => {global.wx = original;});
  return {exporting, canvas, page: {pageActive: true, shareResultOwner: 'account-a'}};
}
test('战绩卡保留本人名次与积分，并使用结算排名中的头像和昵称', () => {
  const card = resultCard(result(), '万里长城');
  assert.equal(card.score, 234); assert.equal(card.rank, 2); assert.equal(card.coins, 60);
  assert.deepEqual(card.podium, [{rank: 2, score: 234, isSelf: true, name: '自己', avatar: 'https://example.com/avatar.png'}, {rank: 1, score: 999, isSelf: false, name: '第一名', avatar: ''}]);
  assert.equal(resultCard({...result(), interrupted: true}, '长城'), null);
  assert.match(resultShareTitle(card), /234分，第2名/);
  assert.equal(resultCard({...result(), title: '对局已中断'}, '长城'), null);
  assert.equal(resultCard({...result(), ranking: result().ranking.map((entry) => ({...entry, isSelf: false}))}, '长城'), null);
  const invalid = result(); invalid.ranking[1].score = NaN; assert.equal(resultCard(invalid, '长城'), null);
  assert.doesNotThrow(() => renderResultCard(context(), card));
});
test('原生Canvas导出有效战绩卡，路径绑定当前账号', async (t) => {
  const h = platform(t), pending = prepareResultImage(h.page, result(), '万里长城');
  const options = await h.exporting;
  assert.equal(options.canvas, h.canvas); assert.equal(options.destWidth, 500); assert.equal(options.destHeight, 400);
  options.success({tempFilePath: 'wxfile://verified-card.png'});
  assert.equal(await pending, 'wxfile://verified-card.png'); assert.equal(h.page.shareCardOwner, 'account-a');
});
test('换号或离页后的导出回调不能覆盖当前账号的分享图片', async (t) => {
  const h = platform(t), pending = prepareResultImage(h.page, result(), '万里长城');
  const options = await h.exporting; api.setToken('account-b');
  options.success({tempFilePath: 'wxfile://old-account-card.png'});
  assert.equal(await pending, ''); assert.equal(h.page.shareCardPath, '');
});
test('导出失败保留通用分享回退，不抛出影响结算的异常', async (t) => {
  const h = platform(t), pending = prepareResultImage(h.page, result(), '万里长城');
  (await h.exporting).fail(); assert.equal(await pending, ''); assert.equal(h.page.shareCardPath, '');
});

test('头像加载成功后圆形裁切绘制，头像出错时仍可导出战绩卡', async () => {
  const card = resultCard(result(), '万里长城');
  const image = {width: 160, height: 120, set src(value) {
    assert.equal(value, 'https://example.com/avatar.png');
    this.onload();
  }};
  const images = await loadResultAvatars(card, () => image);
  assert.deepEqual(images, [image, null, image]);
  const drawn = [];
  renderResultCard({...context(), drawImage(value) {drawn.push(value);}}, card, images);
  assert.deepEqual(drawn, [image, image]);
  assert.deepEqual(await loadResultAvatars(card, () => ({set src(_) {this.onerror();}})), [null, null, null]);
});
