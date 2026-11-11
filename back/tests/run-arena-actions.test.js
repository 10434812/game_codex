const test = require('node:test');
const assert = require('node:assert/strict');
const run = require('../src/game-engine/run-arena');
const actions = require('../src/services/game-actions-service');
function game() {
  const players = ['1', '2', '3'].map((id) => ({id, name: id, score: 100, teamId: null, isRobot: false}));
  return {sessionId: 1, duration: 100, status: 'playing', timeLeft: 100, players, teams: [], runWorld: run.createRunWorld(players)};
}
test('联机只接受当前真人的方向，异常输入与待开始状态保持原位', () => {
  const g = game(); assert.throws(() => actions.move(g, '99', {dx: 1, dy: 0}), /对局不存在/);
  for (const body of [{dx: NaN, dy: 0}, {dx: '1', dy: 0}, {dx: 0, dy: Infinity}]) assert.throws(() => actions.move(g, '1', body), /有效/);
  actions.move(g, '1', {dx: 10000, dy: 0}); assert.equal(g.runWorld.runners[0].dx, 1); assert.equal(g.runWorld.runners[1].dx, 0);
  g.awaitingStartIds = ['2']; assert.throws(() => actions.move(g, '1', {dx: 1, dy: 0}), /等待/);
});
test('服务端要求双向点选与接触，退出对双方生效', () => {
  const g = game(); actions.setTeam(g, '1', '2'); assert.equal(g.teams.length, 0);
  actions.setTeam(g, '2', '1'); assert.equal(g.teams.length, 0);
  g.runWorld.runners[1].x = g.runWorld.runners[0].x + 60;
  const next = run.advanceRunArena(g.runWorld, g.players, 50); Object.assign(g, {runWorld: next.world, players: next.players, teams: next.teams});
  assert.equal(g.teams.length, 1); assert.throws(() => actions.setTeam(g, '3', '2'), /独立/);
  actions.setTeam(g, '1', null); assert.equal(g.teams.length, 0); assert.equal(g.runWorld.runners[1].mateId, '');
});
test('联机福袋由服务器碰撞结算，领取接口按跑动规则回应', () => {
  const g = game(); assert.throws(() => actions.claimFortuneBag(g, '1', 'fake'), /跑动接住/);
  const r = g.runWorld.runners[0]; g.runWorld.drops.push({id: 'gift', x: r.x, y: r.y, kind: 'bag', value: 10, speed: 1, warningUntil: 0});
  const next = run.advanceRunArena(g.runWorld, g.players, 20); assert.equal(next.players[0].score, 110); assert.equal(next.players[1].score, 100);
});
