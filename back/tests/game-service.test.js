const test = require('node:test');
const assert = require('node:assert/strict');

const gameService = require('../src/services/game-service');

test.beforeEach(() => {
  gameService.getActiveGames().clear();
});

test('getGameState marks the requesting user as self for polling clients', () => {
  gameService.getActiveGames().set(9, {
    sessionId: 9,
    timeLeft: 177,
    duration: 180,
    round: 1,
    status: 'playing',
    lastEvents: [{actorId: '2', delta: 60}],
    feedText: '好运上涨',
    players: [
      {id: '1', name: '甲', score: 120, teamId: 'team-1', avatar: 'a.png', seat: 1},
      {id: '2', name: '乙', score: 180, teamId: 'team-1', avatar: 'b.png', seat: 2},
    ],
    teams: [{id: 'team-1', memberIds: ['1', '2']}],
  });

  const state = gameService.getGameState(9, 2);

  assert.equal(state.duration, 180);
  assert.equal(state.modeText, '联网对战');
  assert.deepEqual(state.lastEvents, [{actorId: '2', delta: 60}]);
  assert.equal(state.players[0].isSelf, false);
  assert.equal(state.players[1].isSelf, true);
});

test('buildResultPayload includes viewer settlement fields expected by result page', () => {
  const payload = gameService.buildResultPayload({
    sessionId: 42,
    stage: {id: 1, name: '万里长城'},
    initialScores: {'1': 100, '2': 100},
    players: [
      {id: '1', name: '甲', score: 120, teamId: 'team-1', avatar: 'a.png', seat: 1},
      {id: '2', name: '乙', score: 180, teamId: 'team-1', avatar: 'b.png', seat: 2},
    ],
  }, 2);

  assert.equal(payload.resultId, 'session-42-user-2');
  assert.equal(payload.gain, 80);
  assert.equal(payload.coins, 240);
  assert.equal(payload.achievement, '长城守望者');
  assert.equal(payload.rank, 1);
  assert.equal(payload.achievementMedal.shortName, '长城');
  assert.equal(payload.ranking.find((player) => player.id === '2').isSelf, true);
  assert.equal(payload.ranking.find((player) => player.id === '1').isSelf, false);
});

test('buildOnlinePlayers fills robots when real players are not enough', () => {
  const players = gameService.buildOnlinePlayers([
    {user_id: 1, seat: 1, is_host: 1},
    {user_id: 2, seat: 2, is_host: 0},
    {user_id: 3, seat: 3, is_host: 0},
  ], {
    1: {nick_name: '甲', avatar_url: 'a.png'},
    2: {nick_name: '乙', avatar_url: 'b.png'},
    3: {nick_name: '丙', avatar_url: 'c.png'},
  });

  assert.equal(players.length, 4);
  assert.equal(players.filter((player) => player.isRobot).length, 1);
  assert.deepEqual(players.slice(0, 3).map((player) => player.id), ['1', '2', '3']);
});

test('fillArenaPlayers keeps real players and fills missing seats with robots', () => {
  const realPlayers = gameService.buildEnginePlayers([
    {user_id: 1, seat: 1, is_host: 1},
    {user_id: 2, seat: 2, is_host: 0},
  ], {
    1: {id: 1, nick_name: '房主', avatar_url: 'a.png'},
    2: {id: 2, nick_name: '好友', avatar_url: 'b.png'},
  }, {
    random: () => 0.1,
  });

  const players = gameService.fillArenaPlayers(realPlayers, {random: () => 0.2});

  assert.equal(players.length, 4);
  assert.equal(players.filter((player) => !player.isRobot).length, 2);
  assert.equal(players.filter((player) => player.isRobot).length, 2);
  assert.deepEqual(players.slice(0, 2).map((player) => player.id), ['1', '2']);
});

test('finishGame persists settlement only for real players', async () => {
  const db = require('../src/models/db');
  const originalExecute = db.execute;
  const calls = [];
  db.execute = async (sql, params = []) => {
    calls.push({sql, params});
    return [{affectedRows: 1}, []];
  };

  try {
    await gameService.finishGame({
      sessionId: 77,
      round: 1,
      stage: {id: 1, name: '万里长城'},
      initialScores: {'1': 100, 'robot-2': 100},
      players: [
        {id: '1', name: '真人', score: 130, teamId: 'team-1', avatar: 'a.png', seat: 1},
        {id: 'robot-2', name: '机器人', score: 160, teamId: 'team-1', avatar: 'b.png', seat: 2, isRobot: true},
      ],
    }, {
      to() {
        return {emit() {}};
      },
    });
  } finally {
    db.execute = originalExecute;
  }

  const userUpdateCalls = calls.filter((call) => /UPDATE users SET/.test(call.sql));
  const gamePlayerUpdateCalls = calls.filter((call) => /UPDATE game_players SET/.test(call.sql));
  assert.equal(userUpdateCalls.length, 1);
  assert.equal(gamePlayerUpdateCalls.length, 1);
  assert.match(gamePlayerUpdateCalls[0].sql, /`rank`/);
  assert.equal(userUpdateCalls[0].params.at(-1), 1);
  assert.equal(gamePlayerUpdateCalls[0].params.at(-1), 1);
});
