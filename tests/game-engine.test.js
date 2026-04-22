const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../utils/game-engine');

function createRandom(...values) {
  let index = 0;
  return () => {
    const value = values[index];
    index = Math.min(index + 1, values.length - 1);
    return value;
  };
}

test('ensureMinimumPlayers 会补机器人到至少 4 人', () => {
  const players = [engine.createSelfPlayer()];
  const next = engine.ensureMinimumPlayers(players, {random: createRandom(0.1, 0.2, 0.3, 0.4)});

  assert.equal(next.length, 4);
  assert.equal(next.filter((player) => player.isRobot).length, 3);
});

test('createInitialPlayers 会把总人数限制在 10 人以内', () => {
  const players = engine.createInitialPlayers({count: 12, random: createRandom(0.2, 0.2, 0.2, 0.2, 0.2)});

  assert.equal(players.length, 10);
});

test('pairPlayers 会在奇数人数时补一个机器人后两两组队', () => {
  const players = engine.createInitialPlayers({count: 5, random: createRandom(0.2, 0.2, 0.2, 0.2, 0.2)});
  const paired = engine.pairPlayers(players, {random: createRandom(0.3, 0.3, 0.3, 0.3)});

  assert.equal(paired.players.length % 2, 0);
  assert.equal(paired.teams.length * 2, paired.players.length);
  assert.equal(paired.players[paired.players.length - 1].isRobot, true);
});

test('applyRoundEvents 会让主玩家和队友发生 50% 联动', () => {
  const players = engine.createInitialPlayers({count: 4, random: createRandom(0.1, 0.1, 0.1, 0.1)});
  const paired = engine.pairPlayers(players, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  const actorId = paired.players[0].id;
  const teammateId = paired.players[1].id;
  const result = engine.applyRoundEvents(
    paired.players,
    paired.teams,
    [{actorId, delta: 60}],
  );

  const actor = result.find((player) => player.id === actorId);
  const teammate = result.find((player) => player.id === teammateId);

  assert.equal(actor.score - paired.players[0].score, 60);
  assert.equal(teammate.score - paired.players[1].score, 30);
});

test('buildRanking 会按分数倒序并在同分时按 seat 升序排序', () => {
  const players = [
    {...engine.createSelfPlayer({seat: 2, score: 300}), id: 'self-2'},
    {...engine.createRobotPlayer({seat: 1, score: 300}), id: 'robot-1'},
    {...engine.createRobotPlayer({seat: 3, score: 280}), id: 'robot-3'},
  ];

  const ranking = engine.buildRanking(players);

  assert.equal(ranking[0].seat, 1);
  assert.equal(ranking[1].seat, 2);
  assert.equal(ranking[2].seat, 3);
});

test('addInvitedHuman 会向房间追加一个真人玩家', () => {
  const players = engine.createInitialPlayers({count: 4, random: createRandom(0.2, 0.2, 0.2, 0.2)});
  const next = engine.addInvitedHuman(players, {random: createRandom(0.1, 0.1, 0.1)});

  assert.equal(next.length, 5);
  const last = next[next.length - 1];
  assert.equal(last.isRobot, false);
  assert.equal(last.isSelf, false);
});

test('buildVisibleScoreState 会按阶段切换可见分数玩家', () => {
  const players = engine.createInitialPlayers({count: 6, random: createRandom(0.2, 0.2, 0.2, 0.2, 0.2)});
  const first = engine.buildVisibleScoreState(players, 180, 180, null, {random: createRandom(0.1, 0.2, 0.3)});
  const second = engine.buildVisibleScoreState(players, 179, 180, first, {random: createRandom(0.4, 0.5, 0.6)});
  const third = engine.buildVisibleScoreState(players, 149, 180, second, {random: createRandom(0.2, 0.3, 0.4)});

  assert.equal(first.visibleIds.length, 2);
  assert.equal(second.changed, false);
  assert.equal(third.changed, true);
});
