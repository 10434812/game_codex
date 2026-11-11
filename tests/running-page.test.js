const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../utils/game-store');
const run = require('../utils/run-arena');
const {renderRunArena} = require('../utils/run-arena-renderer');
const {ARENA_EFFECT_ASSETS, ARENA_DROP_ASSETS} = require('../utils/arena-effects');
const privacy = require('../utils/privacy-consent');
const fs = require('node:fs');
const path = require('node:path');
const {applyViewPatch} = require('./helpers/arena-view-fixture');

test('跑动页沿用场景、装饰头像、消息与导航，人物和弹层共享原生视图层', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  for (const name of ['scene-backdrop', 'arena-scene-mask', 'avatar-shell', 'avatar-ring-overlay', 'pet-follower', 'message-reply-card', 'bottom-nav', 'rules-overlay']) assert.ok(wxml.includes(name), name);
  assert.doesNotMatch(wxml, /<canvas\b/);
  assert.ok(wxml.indexOf('player-name-layer') > wxml.indexOf('class="player-node'));
  assert.match(wxml, /wx:if="{{stageVideo && !rulesVisible}}"/);
});

function pageFixture(t) {
  const storage = new Map(), calls = [], audioCalls = [];
  global.wx = {getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key),
    getSystemInfoSync: () => ({statusBarHeight: 20, windowWidth: 375}), getMenuButtonBoundingClientRect: () => ({top: 24, height: 32, left: 280, width: 80}),
    redirectTo: (v) => calls.push(v), navigateTo: (v) => calls.push(v)};
  const originalCanEnter = privacy.canEnter; privacy.canEnter = () => true;
  const audioPath = require.resolve('../utils/audio'), audio = require.cache[audioPath];
  require.cache[audioPath] = {id: audioPath, filename: audioPath, loaded: true, exports: {playCue(name) {audioCalls.push(name);}, playVoice() {}, playStageBgm() {}, playVibrate() {}}};
  const path = require.resolve('../pages/arena/index'); delete require.cache[path];
  let definition; global.Page = (value) => {definition = value;}; require(path);
  if (audio) require.cache[audioPath] = audio; else delete require.cache[audioPath];
  const page = {...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) {applyViewPatch(this.data, patch); callback?.();}};
  store.__resetForTests(); store.startGame({autoStartTimer: false, random: () => .2}); page.onLoad(); page.onShow();
  t.after(() => {page.onUnload(); store.__resetForTests(); privacy.canEnter = originalCanEnter;});
  return {page, calls, storage, audioCalls};
}
function drawingContext() {
  const operations = [], ctx = new Proxy({measureText: (text) => ({width: text.length * 8})}, {get(obj, key) {if (key in obj) return obj[key]; return (...args) => operations.push([key, ...args]);}, set(obj, key, value) {obj[key] = value; return true;}});
  return {ctx, operations};
}
test('真实页面拖动移动，松手、取消触控和切后台均停止，规则层时间保持一致', (t) => {
  const {page} = pageFixture(t); page.setData({rulesVisible: false});
  const self = store.getState().runWorld.runners[0];
  page.onRunTouchStart({touches: [{x: 100, y: 100}]}); page.onRunTouchMove({touches: [{x: 170, y: 100}]});
  store.advanceRunFrame(100, {random: () => .5}); assert.ok(store.getState().runWorld.runners[0].x > self.x);
  page.onRunTouchEnd({changedTouches: [{x: 170, y: 100}]}); const end = store.getState().runWorld.runners[0].x;
  store.advanceRunFrame(100, {random: () => .5}); assert.equal(store.getState().runWorld.runners[0].x, end);
  page.onRunTouchStart({touches: [{x: 100, y: 100}]}); page.onRunTouchMove({touches: [{x: 170, y: 100}]}); page.onRunTouchCancel();
  assert.equal(store.getState().runWorld.runners[0].dx, 0);
  page.onRunTouchStart({touches: [{x: 100, y: 100}]}); page.onRunTouchMove({touches: [{x: 170, y: 100}]}); page.onHide();
  assert.equal(store.getState().runWorld.runners[0].dx, 0);
});

test('拖动输入在下一显示帧推进，松手后的下一帧不再移动', (t) => {
  t.mock.timers.enable({apis: ['setInterval', 'Date'], now: 1000});
  const {page} = pageFixture(t);
  page.setData({rulesVisible: false, rulesFirstRun: false});
  store.resumeGame();
  const start = store.getState().runWorld.runners[0].x;
  const startPx = page.data.players[0].px;
  page.onRunTouchStart({touches: [{x: 100, y: 100}]});
  page.onRunTouchMove({touches: [{x: 170, y: 100}]});
  t.mock.timers.tick(17);
  assert.ok(store.getState().runWorld.runners[0].x > start, '输入后 17ms 内人物应移动，而不是等待 50ms');
  assert.ok(page.data.players[0].px > startPx, '人物视图应与规则位置在同一帧更新');
  page.onRunTouchCancel();
  const stopped = store.getState().runWorld.runners[0].x;
  t.mock.timers.tick(17);
  assert.equal(store.getState().runWorld.runners[0].x, stopped);
});

test('帧调度被阻塞后按实际时间推进，恢复前台不补跑后台时间', (t) => {
  t.mock.timers.enable({apis: ['setInterval', 'Date'], now: 1000});
  const {page} = pageFixture(t);
  page.setData({rulesVisible: false, rulesFirstRun: false});
  store.resumeGame();
  const start = store.getState().runWorld.elapsedMs;
  t.mock.timers.setTime(1090);
  t.mock.timers.tick(16);
  assert.equal(store.getState().runWorld.elapsedMs - start, 106);
  page.onHide();
  const paused = store.getState().runWorld.elapsedMs;
  t.mock.timers.tick(5000);
  page.onShow();
  t.mock.timers.tick(16);
  assert.equal(store.getState().runWorld.elapsedMs - paused, 16);
});
test('点击头像只发邀请，点击掉落福袋保持积分由碰撞结算', (t) => {
  const {page} = pageFixture(t); page.setData({rulesVisible: false}); page.fieldRect = {x: 0, y: 0, width: 1000, height: 1200};
  const target = page.snapshot.runWorld.runners[1];
  page.onRunTouchStart({touches: [{x: target.x, y: target.y}]}); page.onRunTouchEnd({changedTouches: [{x: target.x, y: target.y}]});
  assert.equal(store.getState().teams.length, 0); assert.equal(store.getState().runWorld.runners[0].targetId, target.id);
  const score = store.getState().players[0].score;
  page.onRunTouchStart({touches: [{x: 800, y: 100}]}); page.onRunTouchEnd({changedTouches: [{x: 800, y: 100}]});
  assert.equal(store.getState().players[0].score, score);
});
test('头像边缘点选和按下后目标移动，始终邀请实际按下的玩家', (t) => {
  const {page} = pageFixture(t); page.setData({rulesVisible: false});
  page.fieldRect = {x: 0, y: 0, width: 1000, height: 1200}; page.canvasBounds = {x: 0, y: 0};
  const target = page.snapshot.runWorld.runners[1];
  const touch = {clientX: target.x, clientY: target.y + 65};
  page.onRunTouchStart({touches: [touch], currentTarget: {dataset: {playerId: target.id}}});
  target.x += 150;
  page.onRunTouchEnd({changedTouches: [touch]});
  assert.equal(store.getState().runWorld.runners[0].targetId, target.id);
});
test('双方互选后提示靠近碰面，接触成队并支持退出', (t) => {
  const {page} = pageFixture(t); page.setData({rulesVisible: false});
  const state = store.getState(), self = state.runWorld.runners[0], target = state.runWorld.runners[1];
  self.targetId = target.id; target.targetId = self.id;
  page.acceptState(state);
  assert.match(page.data.hint, /双方已同意.*靠近/);
  assert.match(page.data.teamText, /已互选/);
  store.setSelfTeam(target.id);
  for (let i = 0; i < 120 && !page.data.hasTeam; i++) store.advanceRunFrame(50, {random: () => .5});
  assert.equal(page.data.hasTeam, true);
  assert.match(page.data.teamText, /队友/);
  page.onExitTeam();
  assert.equal(page.data.hasTeam, false);
});
test('收到邀请可忽略、重新邀请可接受，互选后显示目标连线', (t) => {
  const {page} = pageFixture(t); page.setData({rulesVisible: false});
  const state = store.getState(), self = state.runWorld.runners[0], target = state.runWorld.runners[1];
  target.targetId = self.id; page.acceptState(state);
  assert.equal(page.data.incomingId, target.id);
  page.onIgnoreInvite(); assert.equal(page.data.incomingId, '');
  target.targetId = ''; page.acceptState(state);
  target.targetId = self.id; page.acceptState(state);
  assert.equal(page.data.incomingId, target.id);
  page.onAcceptInvite();
  assert.equal(store.getState().runWorld.runners[0].targetId, target.id);
  self.targetId = target.id; page.acceptState(state);
  assert.equal(page.data.incomingId, ''); assert.match(page.data.teamText, /已互选/);
  assert.ok(page.data.inviteLink?.style.includes('rotate'));
});
test('冲刺提示随时间更新，重复快照的倒计时音效每秒播放一次', (t) => {
  const {page, audioCalls} = pageFixture(t); page.setData({rulesVisible: false});
  const state = store.getState(); state.timeLeft = 3;
  page.acceptState(state); page.acceptState(state);
  state.timeLeft = 2; page.acceptState(state);
  assert.equal(page.data.sprint, true); assert.ok(page.data.sprintText);
  assert.equal(audioCalls.filter((name) => name === 'countdown3').length, 1);
  assert.equal(audioCalls.filter((name) => name === 'countdown2').length, 1);
  state.timeLeft = 20; page.acceptState(state); assert.equal(page.data.sprint, false);
});
test('Canvas 同时绘制头像、装备皮肤、光环、宠物，名牌处于所有头像之上', () => {
  const {ctx, operations} = drawingContext();
  const ps = [{id: 'a', name: '自己', score: 100, teamId: null, isSelf: true, avatar: 'avatar'}, {id: 'b', name: '队友', score: 90, teamId: null, avatar: 'other'}];
  const assets = {skin: {width: 50, height: 50}, ring: {width: 60, height: 60}, pet: {width: 30, height: 30}, other: {width: 50, height: 50}};
  renderRunArena(ctx, run.createRunWorld(ps), ps, {x: 0, y: 0, width: 360, height: 600}, {images: assets, skinImage: 'skin', ringImage: 'ring', petImage: 'pet'});
  for (const image of Object.values(assets)) assert.ok(operations.some((op) => op[0] === 'drawImage' && op[1] === image));
  const lastImage = operations.findLastIndex((op) => op[0] === 'drawImage');
  assert.ok(operations.findLastIndex((op) => op[0] === 'fillText' && String(op[1]).includes('自己 · 100')) > lastImage);
});

test('三个掉落物在真实页面与 Canvas 中使用新的独立贴图，分值保持原样', (t) => {
  const {page} = pageFixture(t), state = store.getState();
  state.runWorld.drops = ['bomb', 'bag', 'gift'].map((kind, i) => ({id: kind, kind, value: [-10, 10, 20][i],
    x: 250 + i * 200, y: 500, speed: 0, warningUntil: 0}));
  page.acceptState(state);
  assert.deepEqual(page.data.drops.map((drop) => drop.asset), Object.values(ARENA_DROP_ASSETS));
  assert.deepEqual(page.data.drops.map((drop) => drop.label), ['−10', '+10', '+20']);
  const images = Object.fromEntries(Object.values(ARENA_DROP_ASSETS).map((asset) => [asset, {width: 256, height: 256}]));
  const {ctx, operations} = drawingContext();
  renderRunArena(ctx, state.runWorld, state.players, {x: 0, y: 0, width: 360, height: 600}, {images});
  for (const sprite of Object.values(images)) assert.ok(operations.some((op) => op[0] === 'drawImage' && op[1] === sprite));
});
test('掉落预警、组队闪爆和快捷表情使用同一实时画面', () => {
  const {ctx, operations} = drawingContext(), ps = [{id: 'a', name: '玩家', score: 100, teamId: null}], world = run.createRunWorld(ps);
  world.drops.push({id: 'bomb', kind: 'bomb', x: 400, y: -28, value: -10, speed: 240, warningUntil: 700});
  world.effects.push({id: 1, type: 'team', actorId: 'a', teammateId: 'b', delta: 0, linkedDelta: 0, x: 300, y: 500, at: 0});
  renderRunArena(ctx, world, ps, {x: 0, y: 0, width: 360, height: 600}, {emotes: {a: '一起接福'}});
  const texts = operations.filter((op) => op[0] === 'fillText').map((op) => op[1]);
  assert.ok(texts.includes('雷 ↓')); assert.ok(texts.includes('组队成功')); assert.ok(texts.includes('一起接福'));
});
test('陈旧联机快照和离开页面后的响应保持当前状态', (t) => {
  const {page} = pageFixture(t); page.sessionId = '7';
  const state = {...store.getState(), sessionId: 7, stateVersion: 10}; page.acceptState(state);
  page.acceptState({...state, timeLeft: 90, stateVersion: 9}); assert.equal(page.snapshot.timeLeft, 120);
  page.onHide(); page.acceptState({...state, timeLeft: 80, stateVersion: 11}); assert.equal(page.snapshot.timeLeft, 120);
});

test('真实碰撞产生爆炸或拾取粒子，显示实际积分并自动结束', () => {
  for (const [kind, value, label] of [['bomb', -10, '踩雷 −2'], ['bag', 10, '福袋 +10'], ['gift', 20, '礼物 +20']]) {
    const ps = [{id: 'a', name: '玩家', score: 2, teamId: null}];
    const world = run.createRunWorld(ps), r = world.runners[0];
    world.drops.push({id: 'hit', kind, value, x: r.x, y: r.y, speed: 0, warningUntil: 0});
    const next = run.advanceRunArena(world, ps, 20);
    const {ctx, operations} = drawingContext();
    renderRunArena(ctx, next.world, next.players, {x: 0, y: 0, width: 360, height: 600});
    assert.ok(operations.filter((op) => op[0] === 'arc').length >= 12, kind);
    assert.ok(operations.some((op) => op[0] === 'fillText' && op[1] === label), label);
    const expired = run.advanceRunArena(next.world, next.players, 1000);
    assert.equal(run.advanceRunArena(expired.world, expired.players, 120).world.effects.length, 0);
  }
});

test('已加载的生成素材按帧裁取，爆炸与奖励各用独立图集，到期不再绘制', () => {
  for (const [kind, value] of [['bomb', -10], ['bag', 10], ['gift', 20]]) {
    const ps = [{id: 'a', name: '玩家', score: 100, teamId: null}];
    const world = run.createRunWorld(ps), r = world.runners[0];
    world.drops.push({id: kind, kind, value, x: r.x, y: r.y, speed: 0, warningUntil: 0});
    const next = run.advanceRunArena(world, ps, 20), sprite = {width: 768, height: 384};
    const asset = kind === 'bomb' ? ARENA_EFFECT_ASSETS.bomb : ARENA_EFFECT_ASSETS.reward;
    const draw = (age) => {
      const {ctx, operations} = drawingContext();
      renderRunArena(ctx, {...next.world, elapsedMs: next.world.effects[0].at + age}, next.players,
        {x: 0, y: 0, width: 360, height: 600}, {images: {[asset]: sprite}});
      return operations.filter((op) => op[0] === 'drawImage' && op[1] === sprite);
    };
    const first = draw(0), later = draw(550);
    assert.equal(first.length, 1); assert.equal(later.length, 1);
    assert.equal(first[0].length, 10); // drawImage 的九参数裁剪形式。
    assert.deepEqual(first[0].slice(2, 6), [0, 0, 192, 192]);
    assert.ok(later[0][2] > 0 || later[0][3] > 0);
    assert.deepEqual(draw(kind === 'bomb' ? 800 : 1000), []);
  }
});

test('真实页面的碰撞反馈携带图集帧，重复快照维持当前帧', (t) => {
  const {page} = pageFixture(t), state = store.getState();
  const r = state.runWorld.runners[0];
  state.runWorld.effects = [{id: 1, type: 'pickup', actorId: r.id, teammateId: '', kind: 'gift',
    delta: 20, linkedDelta: 0, x: r.x, y: r.y, at: 0}];
  state.runWorld.elapsedMs = 300;
  page.acceptState(state);
  assert.equal(page.data.bursts[0].effect.asset, ARENA_EFFECT_ASSETS.reward);
  const frame = page.data.bursts[0].effect.frame;
  page.acceptState(state); assert.equal(page.data.bursts[0].effect.frame, frame);
  state.runWorld.elapsedMs = 700; page.acceptState(state);
  assert.ok(page.data.bursts[0].effect.frame > frame);
  state.runWorld.elapsedMs = 1000; page.acceptState(state);
  assert.deepEqual(page.data.bursts, []);
});

test('窄短场地左上角拾取时，加分标签留在可见区域', (t) => {
  const {page} = pageFixture(t), state = store.getState(), r = state.runWorld.runners[0];
  page.fieldRect = {x: 0, y: 0, width: 360 * .82, height: 120 * .76};
  state.runWorld.effects = [{id: 1, type: 'pickup', actorId: r.id, teammateId: '', kind: 'bag',
    delta: 10, linkedDelta: 0, x: run.FIELD.radius, y: run.FIELD.radius, at: 0}];
  state.runWorld.elapsedMs = 20;
  page.acceptState(state);
  const burst = page.data.bursts[0];
  assert.ok(burst.labelX > 10 && burst.labelX < 90);
  assert.ok(burst.labelY * 120 / 100 >= 30 && burst.labelY * 120 / 100 <= 90);
});

test('等待开局时可以取消，返回原联网房间', async (t) => {
  const {page, calls} = pageFixture(t);
  page.sessionId = '9'; page.snapshot = {...page.snapshot, roomId: 7, awaitingStart: true};
  const api = require('../utils/api-client');
  t.mock.method(api, 'post', async (path) => {assert.equal(path, '/games/9/cancel-start'); return {cancelled: true};});
  await page.cancelStart();
  assert.equal(calls.at(-1).url, '/pages/room/index?backendRoomId=7');
  assert.equal(page.cancelPending, false);
});
