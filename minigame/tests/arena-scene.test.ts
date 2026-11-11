import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/core/GameStore';
import {ArenaScene, buildSelfRankInfo} from '../src/scenes/arena-scene';
import {makeRandom} from './seeded-random';

function arena(t: {after(fn: () => void): void}) {
  store.__resetForTests(); const random = makeRandom(23);
  store.createRoomFromStage({id: 1}, {roomSize: 8, random}); store.startGame({autoStartTimer: false, random});
  const events: string[] = [], scene = new ArenaScene({width: 720, height: 1280, offsetY: 0, onEvent: (e) => events.push(e.type)}); scene.start();
  t.after(() => {scene.dispose(); store.__resetForTests();}); return {scene, random, events};
}
test('开局独立，掉落物由规则层持续产生，场景展示统一的 120 秒状态', (t) => {
  const {scene, random} = arena(t);
  assert.equal(scene.getSnapshot().playerCount, 8); assert.equal(scene.getSnapshot().teamCount, 0); assert.equal(scene.getSnapshot().timeLeft, 120);
  store.advanceRunFrame(1000, {random}); assert.equal(store.getState().runWorld!.drops.length, 0); assert.equal(scene.getSnapshot().timeLeft, 119);
  store.advanceRunFrame(1000, {random}); assert.equal(store.getState().runWorld!.drops.length, 0);
  store.advanceRunFrame(1000, {random}); assert.equal(store.getState().runWorld!.drops.length, 1); assert.equal(scene.getSnapshot().timeLeft, 117);
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
  scene.touchStart(100, 300); scene.touchMove(400, 300); scene.touchMove(320, 300);
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
