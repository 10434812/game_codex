const test = require('node:test');
const assert = require('node:assert/strict');
const actions = require('../src/services/game-actions-service');

function fixture(t) {
  const calls = [];
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/game-service');
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql, params) => {
      calls.push({sql, params});
      if (/SELECT id, status FROM game_sessions/.test(sql)) return [[{id: 9, status: 'playing'}]];
      if (/SELECT id FROM game_sessions/.test(sql)) return [[]];
      return [{affectedRows: 1}];
    },
  };
  require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {
    pool: {getConnection: async () => connection},
    queryAll: async () => [1, 2].map((id) => ({user_id: id, seat: id, initial_score: 100, nick_name: `玩家${id}`})),
  }};
  delete require.cache[servicePath];
  const service = require(servicePath);
  const game = {sessionId: 9, roomId: 7, stageId: 1, stage: {id: 1}, status: 'playing', duration: 100, timeLeft: 100,
    round: 0, awaitingStartIds: ['1', '2'], players: [1, 2].map((id) => ({id: String(id), name: `玩家${id}`, seat: id, score: 100, teamId: null})),
    teams: [], initialScores: {'1': 100, '2': 100}, scoreLog: {}};
  service.getActiveGames().set(9, game);
  t.after(() => {service.stopAllTimers(); service.getActiveGames().clear();});
  return {service, game, calls};
}

test('一人未确认开局，30秒后取消本局并恢复房间，不发放奖励', async (t) => {
  const {service, game, calls} = fixture(t);
  actions.ready(game, 1);
  for (let i = 0; i < 29; i++) await service.tick(game, null, 1000);
  assert.equal(game.status, 'playing');
  assert.equal(game.timeLeft, 100);
  await service.tick(game, null, 1000);
  assert.equal(game.status, 'finished');
  assert.equal(service.buildResultPayload(game, 1).interrupted, true);
  const stored = JSON.parse(calls.find(({sql}) => /INSERT INTO game_results/.test(sql)).params[1]);
  assert.equal(stored.reason, '有玩家未确认，已取消本次开局');
  assert.ok(calls.some(({sql}) => /UPDATE rooms SET status = 'waiting'/.test(sql)));
  assert.equal(calls.some(({sql}) => /UPDATE users|INSERT INTO coin_records/.test(sql)), false);
});

test('所有真人及时确认后正常计时，不受确认等待期限影响', async (t) => {
  const {service, game, calls} = fixture(t);
  actions.ready(game, 1);
  await service.tick(game, null, 1000);
  actions.ready(game, 2);
  await service.tick(game, null, 1000);
  assert.equal(game.status, 'playing');
  assert.equal(game.timeLeft, 99);
  assert.equal(calls.length, 0);
});

test('等待阶段可以主动取消，已经计时的对局不能按未开局取消', async (t) => {
  const {service, game} = fixture(t);
  await service.cancelPendingStart(9, null);
  assert.equal(game.status, 'finished');
  await assert.rejects(service.cancelPendingStart(9, null), {statusCode: 409});
  game.status = 'playing'; game.settlementDone = false; game.awaitingStartIds = [];
  await assert.rejects(service.cancelPendingStart(9, null), {statusCode: 409});
});
