import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/core/GameStore';
import {ArenaScene, buildSelfRankInfo} from '../src/scenes/arena-scene';
import {makeRandom} from './seeded-random';

function arena(t: {after(fn: () => void): void}) {
  store.__resetForTests(); const random = makeRandom(23);
  store.createRoomFromStage({id: 1}, {roomSize: 8, random}); store.startGame({autoStartTimer: false, random});
  const events: string[] = [], scene = new ArenaScene({source: store, width: 720, height: 1280, offsetY: 0, onEvent: (e) => events.push(e.type)}); scene.start();
  t.after(() => {scene.dispose(); store.__resetForTests();}); return {scene, random, events};
}
test('开局独立，掉落物由规则层持续产生，场景展示统一的 120 秒状态', (t) => {
  const {scene, random} = arena(t);
  assert.equal(scene.getSnapshot().playerCount, 8); assert.equal(scene.getSnapshot().teamCount, 0); assert.equal(scene.getSnapshot().timeLeft, 120);
  store.advanceRunFrame(1000, {random}); assert.equal(store.getState().runWorld!.drops.length, 0); assert.equal(scene.getSnapshot().timeLeft, 119);
  store.advanceRunFrame(1000, {random}); assert.equal(store.getState().runWorld!.drops.length, 3); assert.equal(scene.getSnapshot().timeLeft, 118);
});
test('手指拖动才移动，长按维持输入，松手和取消立即停止', (t) => {
  const {scene, random} = arena(t), x = store.getState().runWorld!.runners[0].x;
  scene.touchStart(100, 300); scene.touchMove(170, 300); store.advanceRunFrame(100, {random});
  assert.ok(store.getState().runWorld!.runners[0].x > x);
  for (let i = 0; i < 10; i++) {scene.update(150); store.advanceRunFrame(150, {random});}
  assert.ok(store.getState().runWorld!.runners[0].dx > 0);
  assert.equal(scene.touchEnd(), true); const end = store.getState().runWorld!.runners[0].x;
  store.advanceRunFrame(100, {random}); assert.equal(store.getState().runWorld!.runners[0].x, end);
  scene.touchStart(100, 300); scene.touchMove(100, 360); scene.touchCancel(); assert.equal(store.getState().runWorld!.runners[0].dy, 0);
});
test('点选玩家发出邀请，尚未接触时保持独立，点选空地保持积分', (t) => {
  const {scene} = arena(t); const target = scene.buildBoardPlayers()[1];
  assert.equal(scene.handleTap(target.x, target.y), true);
  assert.equal(store.getState().runWorld!.runners[0].targetId, target.id); assert.equal(scene.getSnapshot().teamCount, 0);
  const score = store.getState().players[0].score; scene.handleTap(680, 180); assert.equal(store.getState().players[0].score, score);
});
test('长拖后回拨立即转向，45 度拖动不受场地宽高比例影响', (t) => {
  const {scene, random} = arena(t);
  scene.touchStart(100, 300); scene.touchMove(400, 300); scene.touchMove(390, 300);
  assert.ok(store.getState().runWorld!.runners[0].dx < 0);
  scene.touchCancel();
  const start = scene.buildBoardPlayers()[0];
  scene.touchStart(100, 300); scene.touchMove(140, 340);
  store.advanceRunFrame(50, {random});
  const end = scene.buildBoardPlayers()[0];
  assert.ok(Math.abs((end.x - start.x) - (end.y - start.y)) < .001);
});
test('第 120 秒进入个人排名结算，结束事件仅发送一次', (t) => {
  const {scene, random, events} = arena(t);
  for (let i = 0; i < 120; i++) store.tick({random});
  assert.equal(scene.getSnapshot().status, 'finished'); assert.equal(scene.getSnapshot().ranking.length, 8);
  store.tick({random}); assert.equal(events.filter((e) => e === 'finished').length, 1);
});
test('场景销毁时停止移动并解除订阅', (t) => {
  const {scene} = arena(t); scene.touchStart(100, 300); scene.touchMove(160, 300); scene.dispose();
  assert.equal(store.getState().runWorld!.runners[0].dx, 0); const time = scene.getSnapshot().timeLeft;
  store.tick({random: () => .5}); assert.equal(scene.getSnapshot().timeLeft, time);
});
test('个人排名按积分计算，积分相同共享靠前名次', (t) => {
  arena(t); const players = store.getState().players.map((p, i) => ({...p, score: i < 2 ? 200 : 100}));
  assert.equal(buildSelfRankInfo(players).text, '当前第 1 / 8 名'); assert.equal(buildSelfRankInfo(players).lead, true);
  assert.deepEqual(buildSelfRankInfo([]), {text: '', lead: false});
});

test('只对本人的踩雷、护盾和连击反馈，每个事件与冲刺提示只触发一次', (t) => {
  const h = arena(t); const state = store.getState();
  const self = state.players.find((p) => p.isSelf)!;
  let notify: (value: typeof state) => void = () => {};
  const events: string[] = [];
  const source = {getState: () => state, subscribe(callback: typeof notify) {notify = callback; return () => {};},
    setRunDirection() {}, setSelfTeam() {}, clearSelfTeam() {}};
  const scene = new ArenaScene({source, onEvent: (event) => events.push(event.type)}); scene.start(); t.after(() => scene.dispose());
  const world = state.runWorld!;
  world.elapsedMs = 105000;
  world.effects = [{id: 1, type: 'pickup', actorId: self.id, teammateId: '', delta: -10, linkedDelta: 0, x: 300, y: 300, at: 105000, kind: 'bomb'},
    {id: 2, type: 'pickup', actorId: self.id, teammateId: '', delta: 0, linkedDelta: 0, x: 300, y: 300, at: 105000, kind: 'bomb', blocked: true},
    {id: 3, type: 'pickup', actorId: self.id, teammateId: '', delta: 24, linkedDelta: 0, x: 300, y: 300, at: 105000, kind: 'gift', combo: 3}];
  notify(state); notify(state);
  for (const name of ['bomb_hit', 'shield_blocked', 'combo', 'sprint']) assert.equal(events.filter((event) => event === name).length, 1);
  assert.equal(events.filter((event) => event === 'bag_collected').length, 1);
  assert.ok(h.scene);
});
