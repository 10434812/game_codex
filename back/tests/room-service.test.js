const test = require('node:test');
const assert = require('node:assert/strict');

function loadRoomService(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/room-service');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/services/room-service');
}

function createConnectionStub({ statusUpdateAffected = 1, capacityUpdateAffected = 1, disabledUser = null, roster = [{user_id: 3, seat: 1, is_host: 1, is_ready: 1}] } = {}) {
  const calls = [];
  return {
    calls,
    connection: {
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      execute: async (sql, params = []) => {
        calls.push({ sql, params });
        if (/SELECT id, deleted_at, is_banned FROM users/.test(sql)) {
          return [[{id: params[0], deleted_at: Number(params[0]) === disabledUser ? '2026-01-01' : null, is_banned: 0}], []];
        }
        if (/SELECT \* FROM rooms .*FOR UPDATE/.test(sql)) {
          return [[{id: 28, stage_id: 1, status: 'waiting', host_user_id: 3, current_players: 2, max_players: 10}], []];
        }
        if (/SELECT id FROM room_players/.test(sql)) return [[], []];
        if (/SELECT \* FROM room_players/.test(sql)) return [roster, []];
        if (/UPDATE rooms SET status/.test(sql)) {
          return [{ affectedRows: statusUpdateAffected }, []];
        }
        if (/UPDATE rooms SET current_players/.test(sql)) {
          return [{ affectedRows: capacityUpdateAffected }, []];
        }
        if (/SELECT MAX\(seat\)/.test(sql)) {
          return [[{ max_seat: 1 }], []];
        }
        if (/INSERT INTO game_sessions/.test(sql)) {
          return [{ insertId: 99 }, []];
        }
        return [{ affectedRows: 1 }, []];
      },
    },
  };
}

test('startGame escapes rank column when creating game players', async () => {
  const { calls, connection } = createConnectionStub();
  const dbStub = {
    pool: { getConnection: async () => connection },
    queryOne: async (sql) => {
      if (/FROM rooms/.test(sql)) {
        return { id: 28, stage_id: 1, status: 'waiting', host_user_id: 3 };
      }
      return null;
    },
    queryAll: async (sql) => {
      if (/FROM room_players/.test(sql)) {
        return [{ user_id: 3, seat: 1, is_ready: 1, is_host: 1 }];
      }
      if (/FROM game_players/.test(sql)) {
        return [{ session_id: 99, user_id: 3, seat: 1 }];
      }
      return [];
    },
  };
  const roomService = loadRoomService(dbStub);

  await roomService.startGame(28, 3);

  const insertGamePlayer = calls.find((call) => /INSERT INTO game_players/.test(call.sql));
  assert.ok(insertGamePlayer);
  assert.match(insertGamePlayer.sql, /`rank`/);
});

test('startGame waits for real members to become ready', async () => {
  const {calls, connection} = createConnectionStub({roster: [
    {user_id: 3, seat: 1, is_host: 1, is_ready: 1},
    {user_id: 4, seat: 2, is_host: 0, is_ready: 0},
  ]});
  const service = loadRoomService({pool: {getConnection: async () => connection}, queryAll: async () => [{user_id: 3}, {user_id: 4}]});
  await assert.rejects(service.startGame(28, 3), {statusCode: 409});
  assert.equal(calls.some((call) => /INSERT INTO game_sessions/.test(call.sql)), false);
});

test('startGame refuses to start when the room is no longer waiting (double-start race)', async () => {
  // Simulate a concurrent start that already flipped the room to 'playing':
  // the conditional UPDATE must affect 0 rows and the whole transaction rolls back.
  const { calls, connection } = createConnectionStub({ statusUpdateAffected: 0 });
  const dbStub = {
    pool: { getConnection: async () => connection },
    queryOne: async (sql) => {
      if (/FROM rooms/.test(sql)) {
        return { id: 28, stage_id: 1, status: 'waiting', host_user_id: 3 };
      }
      return null;
    },
    queryAll: async () => [{user_id: 3}],
  };
  const roomService = loadRoomService(dbStub);

  await assert.rejects(() => roomService.startGame(28, 3), /游戏已开始/);

  // No session was created.
  assert.equal(calls.filter((call) => /INSERT INTO game_sessions/.test(call.sql)).length, 0);
  const statusUpdate = calls.find((call) => /UPDATE rooms SET status/.test(call.sql));
  assert.match(statusUpdate.sql, /AND status = 'waiting'/);
});

test('joinRoom atomically rejects when the room filled up between check and insert', async () => {
  // Pre-check passes (room not full), but the conditional capacity UPDATE
  // affects 0 rows because a concurrent join claimed the last slot.
  const { calls, connection } = createConnectionStub({ capacityUpdateAffected: 0 });
  const dbStub = {
    pool: { getConnection: async () => connection },
    queryOne: async (sql) => {
      if (/FROM rooms/.test(sql)) {
        return { id: 28, status: 'waiting', current_players: 9, max_players: 10 };
      }
      if (/FROM room_players/.test(sql)) {
        return null; // user not in room yet
      }
      return null;
    },
    queryAll: async () => [],
  };
  const roomService = loadRoomService(dbStub);

  await assert.rejects(() => roomService.joinRoom(28, 7), /房间已满或游戏已开始/);

  // No player row inserted (rollback happened).
  assert.equal(calls.filter((call) => /INSERT INTO room_players/.test(call.sql)).length, 0);
  const claim = calls.find((call) => /UPDATE rooms SET current_players/.test(call.sql));
  assert.match(claim.sql, /current_players < max_players/);
});

test('joinRoom increments players only once per successful join', async () => {
  const { calls, connection } = createConnectionStub();
  const dbStub = {
    pool: { getConnection: async () => connection },
    queryOne: async (sql) => {
      if (/FROM rooms/.test(sql)) {
        return { id: 28, status: 'waiting', current_players: 2, max_players: 10 };
      }
      if (/FROM room_players/.test(sql)) {
        return null;
      }
      return null;
    },
    queryAll: async () => [],
  };
  const roomService = loadRoomService(dbStub);

  await roomService.joinRoom(28, 7);

  const claims = calls.filter((call) => /UPDATE rooms SET current_players/.test(call.sql));
  const playerInserts = calls.filter((call) => /INSERT INTO room_players/.test(call.sql));
  assert.equal(claims.length, 1);
  assert.equal(playerInserts.length, 1);
  assert.match(playerInserts[0].sql, /VALUES \(\?, \?, \?, 1, 0\)/, '受邀加入的玩家默认已准备');
});

test('已在进行中满员房间的原成员可返回，不重复插入或增加人数', async () => {
  const {calls, connection} = createConnectionStub();
  const execute = connection.execute;
  connection.execute = async (sql, params) => {
    if (/SELECT \* FROM rooms .*FOR UPDATE/.test(sql)) return [[{id: 28, status: 'playing', current_players: 10, max_players: 10}], []];
    if (/SELECT id FROM room_players/.test(sql)) return [[{id: 1}], []];
    return execute(sql, params);
  };
  const service = loadRoomService({pool: {getConnection: async () => connection},
    queryOne: async (sql) => /FROM rooms/.test(sql) ? {id: 28, status: 'playing', current_players: 10, max_players: 10} : {id: 99},
    queryAll: async () => [{user_id: 7}],
  });
  const result = await service.joinRoom(28, 7);
  assert.equal(result.sessionId, 99);
  assert.equal(calls.some(({sql}) => /UPDATE rooms SET current_players|INSERT INTO room_players/.test(sql)), false);
});

test('create and join refuse accounts deleted after the initial authentication', async () => {
  for (const operation of ['createRoom', 'joinRoom']) {
    const {calls, connection} = createConnectionStub({disabledUser: 7});
    const service = loadRoomService({
      pool: {getConnection: async () => connection},
      queryOne: async (sql) => /room_code/.test(sql) ? null : {id: 28, status: 'waiting', current_players: 2, max_players: 10},
      queryAll: async () => [],
    });
    await assert.rejects(operation === 'createRoom' ? service.createRoom(7, 1) : service.joinRoom(28, 7), {statusCode: 403});
    assert.equal(calls.some(({sql}) => /INSERT INTO (rooms|room_players)/.test(sql)), false);
  }
});

test('start uses the locked fresh roster, not stale pre-transaction participants', async () => {
  const {calls, connection} = createConnectionStub({roster: [{user_id: 3, seat: 1}, {user_id: 8, seat: 2}]});
  const service = loadRoomService({
    pool: {getConnection: async () => connection},
    queryAll: async () => [{user_id: 3}, {user_id: 7}],
  });
  await assert.rejects(service.startGame(28, 3), {statusCode: 409});
  assert.equal(calls.some(({sql}) => /INSERT INTO game_sessions/.test(sql)), false);
  const accountLocks = calls.filter(({sql}) => /SELECT id, deleted_at/.test(sql));
  assert.deepEqual(accountLocks.map(({params}) => params[0]), [3, 7]);
  assert.ok(calls.findIndex(({sql}) => /FROM users/.test(sql)) < calls.findIndex(({sql}) => /FROM rooms/.test(sql)));
});

test('start rejects a deleted participant before any session or game-player insertion', async () => {
  const {calls, connection} = createConnectionStub({disabledUser: 7, roster: [{user_id: 3}, {user_id: 7}]});
  const service = loadRoomService({
    pool: {getConnection: async () => connection},
    queryAll: async () => [{user_id: 7}, {user_id: 3}],
  });
  await assert.rejects(service.startGame(28, 3), {statusCode: 403});
  assert.equal(calls.some(({sql}) => /INSERT INTO game_/.test(sql)), false);
});

test('create and join acquire account locks before any room or membership write', async () => {
  for (const operation of ['createRoom', 'joinRoom']) {
    const {calls, connection} = createConnectionStub();
    const service = loadRoomService({
      pool: {getConnection: async () => connection},
      queryOne: async (sql) => /room_code/.test(sql) ? null : {id: 28, status: 'waiting', current_players: 2, max_players: 10},
      queryAll: async () => [],
    });
    if (operation === 'createRoom') await service.createRoom(7, 1);
    else await service.joinRoom(28, 7);
    const account = calls.findIndex(({sql}) => /FROM users.*FOR UPDATE/.test(sql));
    const room = calls.findIndex(({sql}) => /FROM rooms.*FOR UPDATE|INSERT INTO rooms/.test(sql));
    const membership = calls.findIndex(({sql}) => /INSERT INTO room_players/.test(sql));
    assert.ok(account >= 0 && account < room && room < membership, operation);
  }
});
