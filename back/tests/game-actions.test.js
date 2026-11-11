const test = require('node:test');
const assert = require('node:assert/strict');
const actions = require('../src/services/game-actions-service');
const engine = require('../src/game-engine/game-engine');
const service = require('../src/services/game-service');

function game() {
  const players = engine.createInitialPlayers({count: 8, random: () => 0.4}).map((player, i) => ({...player, id: String(i + 1), isRobot: false, isSelf: false}));
  const paired = engine.pairPlayers(players);
  return {sessionId: 9, roomId: 7, duration: 180, timeLeft: 180, round: 0, status: 'playing', ...paired, scoreLog: {}};
}

test('server issues a personal expiring bag and credits a repeated claim once', () => {
  const g = game();
  assert.equal(actions.getView(g, 1).fortuneBag, null);
  g.timeLeft = 170;
  const bag = actions.getView(g, 1).fortuneBag;
  assert.ok(bag);
  const before = g.players[0].score;
  actions.claimFortuneBag(g, 1, bag.id);
  actions.claimFortuneBag(g, 1, bag.id);
  assert.equal(g.players[0].score, before + 60);
  assert.equal(g.scoreLog['1'].length, 1);
  assert.equal(actions.getView(g, 1).fortuneBag, null);
  assert.equal(g.stateVersion, 1);
});

test('server validates ownership, expiry and playing state before bag rewards', () => {
  const g = game();
  actions.getView(g, 1); g.timeLeft = 170;
  const bag = actions.getView(g, 1).fortuneBag;
  const scores = g.players.map((player) => player.score);
  assert.throws(() => actions.claimFortuneBag(g, 2, bag.id), /福袋/);
  g.timeLeft = 159;
  assert.throws(() => actions.claimFortuneBag(g, 1, bag.id), /福袋/);
  assert.deepEqual(g.players.map((player) => player.score), scores);
  assert.throws(() => actions.claimFortuneBag(g, 99, bag.id), /对局不存在/);
  g.settlementDone = true;
  assert.throws(() => actions.claimFortuneBag(g, 1, bag.id), /结算/);
});

test('manual pairs survive multiple rounds independently and can be dissolved', () => {
  const g = game();
  for (const id of [1, 3]) {
    const state = actions.getView(g, id);
    const target = g.players.find((p) => !['1', '3'].includes(p.id) && !state.visibleScoreIds.includes(p.id) && !(g.lockedPairs || []).flat().includes(p.id));
    actions.setTeam(g, id, target.id);
  }
  const pairs = g.lockedPairs.map((pair) => [...pair]);
  assert.equal(pairs.length, 2);
  for (let i = 0; i < 20; i++) {
    const result = engine.playRound(g.players, g.teams, {random: () => 0.2, lockedPairs: g.lockedPairs});
    g.players = result.players; g.teams = result.teams;
    pairs.forEach((pair) => assert.ok(g.teams.some((team) => pair.every((id) => team.memberIds.includes(id)))));
  }
  actions.setTeam(g, 1, null);
  assert.equal(g.lockedPairs.length, 1);
  assert.ok(g.lockedPairs[0].includes('3'));
  for (let round = 0; round < 10; round++) {
    Object.assign(g, engine.playRound(g.players, g.teams, {random: () => 0.2, lockedPairs: g.lockedPairs}));
    assert.equal(g.players.find((p) => p.id === '1').teamId, null);
    assert.equal(g.teams.some((team) => team.memberIds.includes('1')), false);
  }
});

test('所有真人确认开始后，服务端统一计时且每 3 秒结算', async () => {
  const g = {...game(), duration: 100, timeLeft: 100, awaitingStartIds: ['1', '2']};
  await service.tick(g);
  assert.equal(g.timeLeft, 100);
  assert.throws(() => actions.ready(g, 99), /对局不存在/);
  actions.ready(g, 1);
  actions.ready(g, 1);
  await service.tick(g);
  assert.equal(g.timeLeft, 100);
  actions.ready(g, 2);
  await service.tick(g);
  assert.equal(g.timeLeft, 99);
  assert.equal(g.round, 0);
  await service.tick(g);
  assert.equal(g.round, 0);
});

test('team actions use server visibility and validate session membership', () => {
  const g = game();
  const view = actions.getView(g, 1);
  assert.throws(() => actions.setTeam(g, 1, view.visibleScoreIds[0]), /亮分/);
  assert.throws(() => actions.setTeam(g, 99, '1'), /对局不存在/);
  assert.throws(() => actions.setTeam(g, 1, '1'), /其他/);
});

test('emotes require a player, a known option and a rate limit', () => {
  const g = game();
  actions.acceptEmote(g, 1, 'cheer');
  assert.throws(() => actions.acceptEmote(g, 1, 'cheer'), {statusCode: 429});
  assert.throws(() => actions.acceptEmote(g, 2, 'arbitrary text'), /快捷表情/);
  assert.throws(() => actions.acceptEmote(g, 99, 'cheer'), {statusCode: 404});
});
