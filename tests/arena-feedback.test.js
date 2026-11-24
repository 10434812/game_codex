const test = require('node:test');
const assert = require('node:assert/strict');
const {sprintFeedback, scoreBursts, performanceFeedback} = require('../utils/arena-feedback');
const run = require('../utils/run-arena');

test('冲刺按个人分数显示超越所需积分，等待与普通阶段保持常规提示', () => {
  const self = {id: 'a', score: 100}, state = {players: [self, {id: 'b', score: 108}, {id: 'c', score: 120}], timeLeft: 15};
  assert.equal(sprintFeedback(state, self).sprintText, '再得 9 分超越上一名');
  assert.equal(sprintFeedback({...state, timeLeft: 16}, self).sprint, false);
  assert.equal(sprintFeedback({...state, awaitingStart: true}, self).sprint, false);
  assert.match(sprintFeedback({...state, players: [self]}, self).sprintText, /保持领先/);
});

test('得分在拾取者与队友各自位置显示，踩雷使用实际扣分并在一秒后消失', () => {
  const world = {elapsedMs: 500, runners: [{id: 'b', x: 300, y: 400}], effects: [
    {id: 1, at: 0, type: 'pickup', actorId: 'a', teammateId: 'b', kind: 'bag', delta: 10, linkedDelta: 5, x: 100, y: 200},
    {id: 2, at: 0, type: 'pickup', actorId: 'a', teammateId: 'b', kind: 'bomb', delta: -10, linkedDelta: -5, appliedDelta: -2, appliedLinkedDelta: 0, x: 100, y: 200},
  ]};
  const bursts = scoreBursts(world, 'a');
  assert.deepEqual(bursts.map((e) => e.text), ['自己 +10', '联动 +5', '自己 −2', '联动 0']);
  assert.equal(bursts[1].x, 300); assert.equal(bursts[3].loss, true);
  assert.equal(bursts[0].kind, 'bag'); assert.equal(bursts[2].kind, 'bomb');
  assert.equal(bursts[1].kind, 'linked');
  assert.equal(new Set(bursts.map((e) => e.id)).size, 4);
  assert.deepEqual(scoreBursts({...world, elapsedMs: 1000}, 'a'), []);
});

test('统计累计实际拾取与联动，退出换队保留记录，源快照完整保留', () => {
  let players = ['a', 'b'].map((id) => ({id, name: id, score: 100, teamId: null}));
  let world = run.createRunWorld(players); world.nextDropAt = 100000;
  world.runners[0].mateId = 'b'; world.runners[1].mateId = 'a';
  for (const [kind, value] of [['bag', 10], ['gift', 20], ['bomb', -10]]) {
    world.drops.push({id: kind, kind, value, x: world.runners[0].x, y: world.runners[0].y, speed: 0, warningUntil: 0});
    const before = JSON.stringify(world);
    const next = run.advanceRunArena(world, players, 20);
    assert.equal(JSON.stringify(world), before);
    world = next.world; players = next.players;
  }
  run.selectRunTarget(world, 'a', null);
  const stats = run.runPerformanceMap(world);
  // 福袋 10 → 联动 5；礼物连击 20+2 → 联动 11；雷 −10 → 联动 −5。
  assert.deepEqual(stats.a, {bags: 1, gifts: 1, bombs: 1, contributed: 16, received: 0, causedLoss: 5, complete: true});
  assert.equal(stats.b.received, 16);
  stats.a.bags = 999; assert.equal(world.runners[0].stats.bags, 1);
  const restored = run.restoreRunWorld(world, players, [], 100);
  assert.deepEqual(restored.runners[0].stats, world.runners[0].stats);
});

test('低分踩雷按实际损失记录，历史存档明确统计范围，旧结算隐藏新统计', () => {
  const players = ['a', 'b'].map((id) => ({id, name: id, score: 2, teamId: null}));
  const world = run.createRunWorld(players); world.nextDropAt = 100000;
  world.runners[0].mateId = 'b'; world.runners[1].mateId = 'a';
  world.drops.push({id: 'bomb', kind: 'bomb', value: -10, x: world.runners[0].x, y: world.runners[0].y, speed: 0, warningUntil: 0});
  const next = run.advanceRunArena(world, players, 20);
  assert.equal(next.events[0].appliedDelta, -2); assert.equal(next.events[0].appliedLinkedDelta, -2);
  assert.equal(next.world.runners[0].stats.causedLoss, 2);
  delete world.runners[0].stats;
  const restored = run.restoreRunWorld(world, players, [], 100);
  assert.equal(restored.runners[0].stats.complete, false);
  const result = {ranking: [{id: 'a', isSelf: true}], performanceMap: run.runPerformanceMap(restored)};
  assert.equal(performanceFeedback(result).title, '恢复后的表现');
  assert.equal(performanceFeedback({ranking: result.ranking}), null);
});
