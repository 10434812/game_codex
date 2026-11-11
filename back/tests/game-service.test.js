const test = require('node:test');
const assert = require('node:assert/strict');

const gameService = require('../src/services/game-service');

/**
 * Load a fresh game-service instance bound to a stubbed db module.
 * The module keeps its own `activeGames` Map, so each stub test starts clean.
 */
function loadGameService(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/game-service');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/services/game-service');
}

/**
 * Build a db stub whose connection records every call and returns sensible
 * defaults for the settlement queries.
 */
function createDbStub(overrides = {}) {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (overrides.throwOn && new RegExp(overrides.throwOn).test(sql)) {
        const err = new Error('injected failure');
        if (overrides.failCode) err.code = overrides.failCode;
        throw err;
      }
      return [{ affectedRows: 0 }, []];
    },
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      if (overrides.throwOn && new RegExp(overrides.throwOn).test(sql)) {
        const err = new Error('injected failure');
        if (overrides.failCode) err.code = overrides.failCode;
        throw err;
      }
      if (/SELECT status FROM game_sessions/.test(sql)) {
        return [[{ status: overrides.sessionStatus || 'playing' }], []];
      }
      if (/SELECT coins, total_exp FROM users/.test(sql)) {
        return [[{ coins: overrides.balanceAfter || 200, total_exp: overrides.totalExp || 0 }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const dbStub = {
    pool: { getConnection: async () => connection },
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }, []];
    },
    queryOne: async () => null,
    queryAll: async () => [],
  };
  return { dbStub, connection, calls };
}

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

test('结算保留各玩家表现，持久化结果按查看者身份选择本人', () => {
  const run = require('../src/game-engine/run-arena');
  const players = [{id: '1', name: '甲', score: 100, teamId: null}, {id: '2', name: '乙', score: 120, teamId: null}];
  const runWorld = run.createRunWorld(players);
  runWorld.runners[0].stats.bags = 3; runWorld.runners[1].stats.gifts = 2;
  const payload = gameService.buildResultPayload({sessionId: 42, players, runWorld, initialScores: {}, stage: {id: 1}}, 1);
  assert.equal(payload.performanceMap['1'].bags, 3);
  const restored = gameService.personalizeStoredResultPayload(payload, {viewerUserId: 2, sessionId: 42});
  const self = restored.ranking.find((p) => p.isSelf);
  assert.equal(self.id, '2'); assert.equal(restored.performanceMap[self.id].gifts, 2);
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

// ─── finishGame: transaction + idempotency + ledger ──────────────────────

function sampleGame() {
  return {
    sessionId: 77,
    round: 1,
    stage: {id: 1, name: '万里长城'},
    initialScores: {'1': 100, 'robot-2': 100},
    players: [
      {id: '1', name: '真人', score: 130, teamId: 'team-1', avatar: 'a.png', seat: 1},
      {id: 'robot-2', name: '机器人', score: 160, teamId: 'team-1', avatar: 'b.png', seat: 2, isRobot: true},
    ],
  };
}

test('finishGame settles in one transaction, persists only real players and writes coin_records', async () => {
  const { dbStub, connection, calls } = createDbStub();
  const svc = loadGameService(dbStub);

  await svc.finishGame(sampleGame(), { emitToSession() {} });

  const userUpdateCalls = calls.filter((call) => /UPDATE users SET coins/.test(call.sql));
  const gamePlayerUpdateCalls = calls.filter((call) => /UPDATE game_players SET/.test(call.sql));
  const coinRecordCalls = calls.filter((call) => /INSERT INTO coin_records/.test(call.sql));
  const resultCalls = calls.filter((call) => /INSERT INTO game_results/.test(call.sql));
  const sessionUpdateCalls = calls.filter((call) => /UPDATE game_sessions SET/.test(call.sql));

  // Only the real player is settled (robot skipped).
  assert.equal(userUpdateCalls.length, 1);
  assert.equal(gamePlayerUpdateCalls.length, 1);
  assert.match(gamePlayerUpdateCalls[0].sql, /`rank`/);
  assert.equal(userUpdateCalls[0].params.at(-1), 1);

  const taskCalls = calls.filter((call) => /INSERT INTO daily_tasks/.test(call.sql));
  assert.equal(taskCalls.length, 1);
  assert.equal(taskCalls[0].params[0], 1);
  assert.equal(taskCalls[0].params[2], 1);

  // Ledger row: gain = 130 - 100 = 30, coins = 30 * 3 = 90.
  assert.equal(coinRecordCalls.length, 1);
  assert.equal(coinRecordCalls[0].params[0], 1); // user_id
  assert.equal(coinRecordCalls[0].params[1], 90); // amount
  assert.equal(coinRecordCalls[0].params[2], 200); // balance_after
  assert.equal(coinRecordCalls[0].params[3], 'game_reward');
  assert.match(coinRecordCalls[0].params[4], /对局奖励/);

  // Session marked finished + idempotent result insert.
  assert.equal(sessionUpdateCalls.length, 1);
  assert.equal(sessionUpdateCalls[0].params[0], 'finished');
  assert.equal(resultCalls.length, 1);
  assert.match(resultCalls[0].sql, /ON DUPLICATE KEY UPDATE/);

  // Everything inside one transaction that actually commits.
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  assert.ok(!calls.some((call) => call.sql === 'ROLLBACK'));
});

test('finishGame is idempotent: a second call settles nothing', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);
  const game = sampleGame();

  await svc.finishGame(game, { emitToSession() {} });
  await svc.finishGame(game, { emitToSession() {} });
  await svc.finishGame(game, { emitToSession() {} });

  const userUpdateCalls = calls.filter((call) => /UPDATE users SET coins/.test(call.sql));
  const resultCalls = calls.filter((call) => /INSERT INTO game_results/.test(call.sql));
  assert.equal(userUpdateCalls.length, 1);
  assert.equal(resultCalls.length, 1);
  assert.equal(calls.filter((call) => /INSERT INTO daily_tasks/.test(call.sql)).length, 1);
});

test('finishGame rolls back the whole transaction and stays retryable on DB failure', async () => {
  const { dbStub, calls } = createDbStub({ throwOn: 'UPDATE users SET' });
  const svc = loadGameService(dbStub);
  const game = sampleGame();

  await assert.rejects(() => svc.finishGame(game, { emitToSession() {} }), /injected failure/);

  // Rolled back: no commit, no partial settlement persisted.
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
  const coinRecordCalls = calls.filter((call) => /INSERT INTO coin_records/.test(call.sql));
  const resultCalls = calls.filter((call) => /INSERT INTO game_results/.test(call.sql));
  assert.equal(coinRecordCalls.length, 0);
  assert.equal(resultCalls.length, 0);

  // The settlement lock is released so the next tick can retry.
  assert.equal(game.settlementDone, false);
  assert.equal(game.status, undefined);
});

test('finishGame skips settlement when the DB session was already finished', async () => {
  const { dbStub, calls } = createDbStub({ sessionStatus: 'finished' });
  const svc = loadGameService(dbStub);
  const game = sampleGame();

  await svc.finishGame(game, { emitToSession() {} });

  const userUpdateCalls = calls.filter((call) => /UPDATE users SET coins/.test(call.sql));
  assert.equal(userUpdateCalls.length, 0);
  assert.equal(game.status, 'finished');
});

// ─── startGameSession: robot persistence + atomic find-or-create ─────────

function createStartGameDbStub({ existingSessionId = null, duplicateOnce = false, existingGamePlayers = null } = {}) {
  const calls = [];
  let sessionLookups = 0;
  let sessionInserts = 0;
  const dbStub = {
    pool: {
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        execute: async (sql, params = []) => {
          calls.push({ sql, params });
          return [{ affectedRows: 1 }, []];
        },
      }),
    },
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/INSERT INTO game_sessions/.test(sql)) {
        sessionInserts += 1;
        if (duplicateOnce && sessionInserts === 1) {
          const err = new Error('Duplicate entry');
          err.code = 'ER_DUP_ENTRY';
          throw err;
        }
        return [{ insertId: 55 }, []];
      }
      return [{ affectedRows: 1 }, []];
    },
    queryOne: async (sql) => {
      if (/FROM rooms/.test(sql)) return { id: 10, stage_id: 1, status: 'playing' };
      if (/FROM game_sessions/.test(sql)) {
        sessionLookups += 1;
        if (sessionLookups === 1 && existingSessionId) return { id: existingSessionId };
        if (sessionLookups > 1) return { id: 55 }; // re-read after ER_DUP_ENTRY
        return null;
      }
      return null;
    },
    queryAll: async (sql, params = []) => {
      if (/FROM room_players/.test(sql)) {
        return [
          { user_id: 1, seat: 1, is_host: 1 },
          { user_id: 2, seat: 2, is_host: 0 },
        ]; // 2 real players -> engine fills 2 robots to reach 4
      }
      if (/FROM users/.test(sql)) {
        assert.match(sql, /IN \(\?, \?\)/);
        assert.deepEqual(params, [1, 2], 'prepared statements require flat scalar bindings');
        return [
          { id: 1, nick_name: '甲', avatar_url: '' },
          { id: 2, nick_name: '乙', avatar_url: '' },
        ];
      }
      if (/FROM game_players/.test(sql)) {
        return existingGamePlayers || [];
      }
      return [];
    },
  };
  return { dbStub, calls };
}

test('startGameSession skips robots when writing game_players (<4 real players)', async () => {
  const { dbStub, calls } = createStartGameDbStub();
  const svc = loadGameService(dbStub);

  const { sessionId } = await svc.startGameSession(10, 1, null);
  const state = svc.getActiveGame(sessionId);
  assert.equal(state.duration, 120);
  assert.equal(state.timeLeft, 120);
  assert.deepEqual(state.awaitingStartIds, state.players.filter((player) => !player.isRobot).map((player) => player.id));
  assert.ok(state.players.filter((player) => !player.isRobot).every((player) => player.independent && player.teamId === null));

  assert.equal(sessionId, 55);

  const inserts = calls.filter((call) => /INSERT INTO game_players/.test(call.sql));
  // Only the 2 real players are persisted; robot ids must never reach the DB.
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map((call) => call.params[1]).sort(), [1, 2]);
  for (const call of inserts) {
    assert.ok(Number.isInteger(call.params[1]), `user_id must be an integer, got ${call.params[1]}`);
    assert.ok(!Number.isNaN(call.params[1]), 'user_id must not be NaN');
    assert.ok(call.params[1] > 0, 'user_id must be a positive id');
  }
});

test('startGameSession reuses the session created by room-service', async () => {
  const { dbStub, calls } = createStartGameDbStub({ existingSessionId: 77 });
  const svc = loadGameService(dbStub);

  const { sessionId } = await svc.startGameSession(10, 1, null);

  assert.equal(sessionId, 77);
  assert.equal(calls.filter((call) => /INSERT INTO game_sessions/.test(call.sql)).length, 0);
});

test('startGameSession syncs in-memory initial score into existing game_players rows', async () => {
  // room-service.startGame already inserted game_players rows; the engine rolled
  // its own starting scores, so the UPDATE must persist them back or the result
  // page recomputes a gain that disagrees with the coins actually granted.
  const { dbStub, calls } = createStartGameDbStub({
    existingSessionId: 77,
    existingGamePlayers: [{ user_id: 1 }, { user_id: 2 }],
  });
  const svc = loadGameService(dbStub);

  const { sessionId } = await svc.startGameSession(10, 1, null);

  assert.equal(sessionId, 77);
  const updates = calls.filter((call) => /UPDATE game_players SET team_id = \?, initial_score = \?/.test(call.sql));
  assert.equal(updates.length, 2, 'each existing player row must get its in-memory initial score');
  for (const update of updates) {
    const [teamId, initialScore, sessionIdParam, userId] = update.params;
    assert.ok(Number.isInteger(initialScore), 'initial_score must be an integer');
    assert.ok(initialScore >= 80 && initialScore <= 220, 'initial_score within engine range');
    assert.equal(sessionIdParam, 77);
    assert.ok([1, 2].includes(userId));
  }
});

test('startGameSession treats a duplicate session INSERT as a race and re-reads it', async () => {
  const { dbStub } = createStartGameDbStub({ duplicateOnce: true });
  const svc = loadGameService(dbStub);

  const { sessionId } = await svc.startGameSession(10, 1, null);

  assert.equal(sessionId, 55);
});

// ─── tick loop: serial scheduling, single settlement ─────────────────────

test('tick loop runs serially and finishes the game exactly once', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);
  const games = svc.getActiveGames();

  games.set(5, {
    sessionId: 5,
    roomId: 1,
    stageId: 1,
    stage: {id: 1, name: '万里长城'},
    duration: 180,
    timeLeft: 1,
    round: 0,
    status: 'playing',
    players: [
      {id: '1', name: '甲', score: 100, teamId: 'team-1', avatar: '', seat: 1},
      {id: '2', name: '乙', score: 100, teamId: 'team-1', avatar: '', seat: 2},
    ],
    teams: [{id: 'team-1', memberIds: ['1', '2']}],
    initialScores: {'1': 100, '2': 100},
    scoreLog: {'1': [], '2': []},
    lastEvents: [],
    feedText: '',
  });

  svc.startTickLoop(5, { emitToSession() {} });

  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } finally {
    svc.stopAllTimers();
  }

  const game = games.get(5);
  assert.equal(game.status, 'finished');
  assert.equal(game.timer, null);
  // Exactly one settlement: 2 real players, one users-UPDATE each.
  const userUpdates = calls.filter((call) => /UPDATE users SET coins/.test(call.sql));
  assert.equal(userUpdates.length, 2);
});

// ─── orphan session reconciliation ───────────────────────────────────────

test('reconcileOrphanSessions interrupts orphaned playing sessions and rolls the room back to waiting', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/SELECT id, status FROM game_sessions/.test(sql)) return [[{ id: 99, status: 'playing' }], []];
      if (/SELECT id FROM game_sessions/.test(sql) && /LIMIT 1/.test(sql)) return [[], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  const dbStub = {
    pool: { getConnection: async () => connection },
    execute: async () => [{ affectedRows: 1 }, []],
    queryOne: async () => null,
    queryAll: async (sql) => {
      if (/FROM game_sessions/.test(sql)) return [{ id: 99, room_id: 7, stage_id: 1 }];
      if (/FROM game_players/.test(sql)) {
        return [
          { user_id: 1, seat: 1, initial_score: 100, nick_name: '甲', avatar_url: '' },
          { user_id: 2, seat: 2, initial_score: 120, nick_name: '乙', avatar_url: '' },
        ];
      }
      return [];
    },
  };
  const svc = loadGameService(dbStub);

  const handled = await svc.reconcileOrphanSessions();

  assert.equal(handled, 1);
  const sessionUpdate = calls.find((call) => /UPDATE game_sessions SET/.test(call.sql));
  assert.ok(sessionUpdate);
  assert.match(sessionUpdate.sql, /status = 'finished'/);
  assert.equal(sessionUpdate.params[0], 99);
  const playerRollback = calls.find((call) => /UPDATE game_players SET final_score = initial_score/.test(call.sql));
  assert.ok(playerRollback);
  const roomRollback = calls.find((call) => /UPDATE rooms SET status/.test(call.sql));
  assert.ok(roomRollback);
  assert.match(roomRollback.sql, /status = 'waiting'/);
  assert.equal(roomRollback.params[0], 7);
  const resultInsert = calls.find((call) => /INSERT INTO game_results/.test(call.sql));
  assert.ok(resultInsert);
  const payload = JSON.parse(resultInsert.params[1]);
  assert.equal(payload.interrupted, true);
  assert.equal(payload.gain, 0);
  assert.equal(payload.ranking.length, 2);
});

test('reconcileOrphanSessions skips sessions that are live in memory', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);
  svc.getActiveGames().set(99, { sessionId: 99 });

  const handled = await svc.reconcileOrphanSessions();

  assert.equal(handled, 0);
  assert.equal(calls.filter((call) => /UPDATE game_sessions/.test(call.sql)).length, 0);
});

test('recoverFailedStart clears partial memory and restores only the failed room in a transaction', async () => {
  const { dbStub, calls, connection } = createDbStub();
  dbStub.queryOne = async (sql, params) => {
    assert.deepEqual(params, [99]);
    return { id: 99, room_id: 7, stage_id: 1 };
  };
  connection.execute = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/SELECT id, status FROM game_sessions/.test(sql)) return [[{ id: 99, status: 'playing' }], []];
    if (/SELECT id FROM game_sessions/.test(sql)) return [[], []];
    return [{ affectedRows: 1 }, []];
  };
  const svc = loadGameService(dbStub);
  const timer = setTimeout(() => assert.fail('partial start timer must be stopped'), 5000);
  svc.getActiveGames().set(99, { sessionId: 99, timer });
  svc.getActiveGames().set(100, { sessionId: 100 });
  try {
    await svc.recoverFailedStart(99);
    assert.equal(svc.getActiveGame(99), null);
    assert.ok(svc.getActiveGame(100), 'other live sessions must survive');
    assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
    const roomUpdate = calls.find(({ sql }) => /UPDATE rooms SET status = 'waiting'/.test(sql));
    assert.deepEqual(roomUpdate.params, [7]);
    const result = calls.find(({ sql }) => /INSERT INTO game_results/.test(sql));
    assert.equal(JSON.parse(result.params[1]).interrupted, true);
    assert.equal(calls.filter(({ sql }) => /UPDATE users SET/.test(sql)).length, 0);
  } finally {
    clearTimeout(timer);
  }
});

test('recoverFailedStart is safe when the session is already finished', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);
  await svc.recoverFailedStart(99);
  assert.equal(calls.length, 0);
});

test('recoverFailedStart rolls back and does not hide recovery database errors', async () => {
  const { dbStub, calls } = createDbStub({ throwOn: 'SELECT id, status' });
  dbStub.queryOne = async () => ({ id: 99, room_id: 7, stage_id: 1 });
  const svc = loadGameService(dbStub);
  await assert.rejects(svc.recoverFailedStart(99), /injected failure/);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(calls.filter(({ sql }) => sql === 'COMMIT').length, 0);
});

// ─── admin force close: forceFinishSession ───────────────────────────────

test('forceFinishSession settles an in-memory game and broadcasts abort events', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);
  const emitted = [];
  const realtime = {
    emitToSession(sessionId, event, data) {
      emitted.push({ sessionId, event, data });
    },
  };

  svc.getActiveGames().set(5, {
    sessionId: 5,
    roomId: 7,
    timeLeft: 120,
    round: 3,
    status: 'playing',
    timer: setTimeout(() => {}, 1000),
    stage: {id: 1, name: '万里长城'},
    initialScores: {'1': 100, '2': 100},
    players: [
      {id: '1', name: '甲', score: 130, teamId: 'team-1', avatar: 'a.png', seat: 1},
      {id: '2', name: '乙', score: 160, teamId: 'team-1', avatar: 'b.png', seat: 2},
    ],
    teams: [{id: 'team-1', memberIds: ['1', '2']}],
  });

  const result = await svc.forceFinishSession(5, realtime, { reason: '测试强制关闭' });

  assert.equal(result.aborted, true);
  assert.equal(result.settled, true);
  const game = svc.getActiveGames().get(5);
  assert.equal(game.status, 'finished');
  assert.equal(game.timer, null);
  // Settlement ran inside a transaction: users UPDATE twice (2 real players).
  const userUpdates = calls.filter((call) => /UPDATE users SET coins/.test(call.sql));
  assert.equal(userUpdates.length, 2);
  // Session row marked finished inside the settlement transaction.
  const sessionUpdate = calls.find((call) => /UPDATE game_sessions SET/.test(call.sql));
  assert.ok(sessionUpdate);
  assert.equal(sessionUpdate.params[0], 'finished');
  // Both the finish broadcast and the abort notice went out.
  const finishedEvents = emitted.filter((item) => item.event === 'game_finished');
  assert.equal(finishedEvents.length, 1);
  assert.ok(emitted.find((item) => item.event === 'game_aborted' && item.data.reason === '测试强制关闭'));
});

test('forceFinishSession rolls back without rewards when settle=false', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);
  const emitted = [];
  const realtime = {
    emitToSession(sessionId, event, data) {
      emitted.push({ event, data });
    },
  };

  svc.getActiveGames().set(6, {
    sessionId: 6,
    roomId: 7,
    timeLeft: 100,
    round: 2,
    status: 'playing',
    timer: setTimeout(() => {}, 1000),
    stage: {id: 1, name: '万里长城'},
    initialScores: {'1': 100, '2': 100},
    players: [
      {id: '1', name: '甲', score: 130, teamId: 'team-1', avatar: 'a.png', seat: 1},
      {id: '2', name: '乙', score: 160, teamId: 'team-1', avatar: 'b.png', seat: 2},
    ],
    teams: [{id: 'team-1', memberIds: ['1', '2']}],
  });

  const result = await svc.forceFinishSession(6, realtime, { settle: false });

  assert.equal(result.settled, false);
  assert.equal(svc.getActiveGames().get(6).status, 'finished');
  // No user reward updates in rollback mode.
  const userUpdates = calls.filter((call) => /UPDATE users SET coins/.test(call.sql));
  assert.equal(userUpdates.length, 0);
  const sessionUpdate = calls.find((call) => /UPDATE game_sessions SET/.test(call.sql));
  assert.ok(sessionUpdate);
  assert.equal(sessionUpdate.params[0], 'finished');
  // Aborted game_finished with null result + abort notice.
  assert.ok(emitted.find((item) => item.event === 'game_finished' && item.data.aborted === true && item.data.result === null));
  assert.ok(emitted.find((item) => item.event === 'game_aborted'));
});

test('forceFinishSession with no in-memory game only closes the DB session row', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadGameService(dbStub);

  const result = await svc.forceFinishSession(99, null);

  assert.equal(result.inMemory, false);
  assert.equal(result.aborted, true);
  const sessionUpdate = calls.find((call) => /UPDATE game_sessions SET/.test(call.sql));
  assert.ok(sessionUpdate);
  assert.match(sessionUpdate.sql, /status = 'finished'/);
});


test('每日任务进度写入失败只回滚任务子句，整局金币与流水照常提交', async () => {
  const {dbStub, calls} = createDbStub({throwOn: 'INSERT INTO daily_tasks'});
  const svc = loadGameService(dbStub);
  const game = sampleGame();
  await svc.finishGame(game, {emitToSession() {}});
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK TO SAVEPOINT daily_task_progress'));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  assert.ok(!calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(calls.some((call) => /UPDATE users SET coins = coins/.test(call.sql)));
  assert.equal(game.status, 'finished');
});

test('recoverFailedStart retries a transient DB failure and then interrupts the session', async () => {
  let queryCalls = 0;
  const dbStub = {
    pool: {
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        execute: async (sql) => {
          if (/SELECT id, status FROM game_sessions/.test(sql)) return [[{ id: 55, status: 'playing' }], []];
          return [{ affectedRows: 1 }, []];
        },
      }),
    },
    execute: async () => [{ affectedRows: 1 }, []],
    queryOne: async () => {
      queryCalls += 1;
      if (queryCalls === 1) {
        const err = new Error('connection reset');
        err.code = 'PROTOCOL_CONNECTION_LOST';
        throw err;
      }
      return { id: 55, room_id: 9, stage_id: 1 };
    },
    queryAll: async () => [],
  };
  const svc = loadGameService(dbStub);

  await svc.recoverFailedStart(55, { attempts: 3, baseDelayMs: 1 });

  assert.equal(queryCalls, 2);
});

test('recoverFailedStart surfaces the error and keeps the playing row when DB stays down', async () => {
  let queryCalls = 0;
  const dbStub = {
    pool: { getConnection: async () => { throw new Error('should not be reached'); } },
    execute: async () => [{ affectedRows: 1 }, []],
    queryOne: async () => {
      queryCalls += 1;
      throw new Error('db down');
    },
    queryAll: async () => [],
  };
  const svc = loadGameService(dbStub);

  await assert.rejects(svc.recoverFailedStart(56, { attempts: 3, baseDelayMs: 1 }), /db down/);
  assert.equal(queryCalls, 3);
});
