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

test('pairPlayers 会把锁定的两人编成同一队', () => {
  const players = engine.createInitialPlayers({count: 8, random: createRandom(0.2)});
  const self = players.find((player) => player.isSelf);
  // 挑一个默认编排下不会和自己同队的人（默认是按座位号两两配对，seat 1 配 seat 2）
  const target = players[4];

  const paired = engine.pairPlayers(players, {lockedPair: [self.id, target.id]});
  const team = paired.teams.find((item) => item.memberIds.includes(self.id));

  assert.ok(team.memberIds.includes(target.id));
  assert.equal(paired.players.length, players.length);
});

test('锁定队伍不会被每回合的随机重排拆散', () => {
  let players = engine.createInitialPlayers({count: 8, random: createRandom(0.2)});
  const self = players.find((player) => player.isSelf);
  const target = players[4];
  const lockedPair = [self.id, target.id];

  let paired = engine.pairPlayers(players, {lockedPair});
  players = paired.players;
  let teams = paired.teams;

  // random 恒为 0 → 每一轮都必定触发重排（TEAM_RESHUFFLE_PROBABILITY 之下）
  for (let round = 0; round < 30; round += 1) {
    const result = engine.playRound(players, teams, {lockedPair, random: createRandom(0)});
    players = result.players;
    teams = result.teams;
    const team = teams.find((item) => item.memberIds.includes(self.id));
    assert.ok(team.memberIds.includes(target.id), `第 ${round + 1} 轮队友被拆散了`);
  }
});

test('lockedPair 引用了不存在的玩家时退回默认编排', () => {
  const players = engine.createInitialPlayers({count: 6, random: createRandom(0.2)});
  const self = players.find((player) => player.isSelf);

  assert.equal(engine.normalizeLockedPair(players, [self.id, 'ghost-player']), null);
  assert.equal(engine.normalizeLockedPair(players, [self.id, self.id]), null);
  assert.equal(engine.normalizeLockedPair(players, [self.id]), null);

  const paired = engine.pairPlayers(players, {lockedPair: [self.id, 'ghost-player']});
  assert.equal(paired.teams.length, 3);
});

test('联动比例随队友分数强弱变化，不再固定 50%', () => {
  const players = [
    {id: 'a', name: '强', seat: 1, score: 900, isSelf: false, isRobot: true},
    {id: 'b', name: '搭档甲', seat: 2, score: 300, isSelf: true, isRobot: false},
    {id: 'c', name: '弱', seat: 3, score: 100, isSelf: false, isRobot: true},
    {id: 'd', name: '搭档乙', seat: 4, score: 300, isSelf: false, isRobot: true},
  ];

  const strong = engine.getScoreStrength(players[0], players);
  const weak = engine.getScoreStrength(players[2], players);

  assert.equal(strong, 1);
  assert.equal(weak, 0);
  // 抱高分队友拿到更大比例，亏损同样按这个比例分摊
  assert.ok(engine.getLinkedDelta(80, strong) > engine.getLinkedDelta(80, weak));
  assert.ok(engine.getLinkedDelta(-80, strong) < engine.getLinkedDelta(-80, weak));
  // 缺省参数保持原来的 50%
  assert.equal(engine.getLinkedDelta(80), 40);
});

test('playRound 把联动值和队友一并挂在事件上', () => {
  const players = engine.createInitialPlayers({count: 6, random: createRandom(0.2)});
  const paired = engine.pairPlayers(players);
  const result = engine.playRound(paired.players, paired.teams, {random: createRandom(0.5)});

  result.events.forEach((event) => {
    assert.equal(typeof event.linkedDelta, 'number');
    assert.equal(typeof event.teammateId, 'string');
    if (event.teammateId) {
      assert.equal(Math.sign(event.linkedDelta), Math.sign(event.delta));
    }
  });
});
