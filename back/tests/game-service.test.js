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
