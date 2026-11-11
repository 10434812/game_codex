const test = require('node:test');
const assert = require('node:assert/strict');

function loadWithDb(modulePath, dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve(modulePath);
  delete require.cache[servicePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  return require(servicePath);
}

function makeConnection(handler) {
  const calls = [];
  return {
    calls,
    beginTransaction: async () => {},
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      return handler(sql, params);
    },
  };
}

// ── leaveRoom (H-2 / H-3 / H-4) ───────────────────────────────────────────

test('leaveRoom rejects leaving a room whose game is in progress without touching members', async () => {
  const conn = makeConnection((sql) => {
    if (/SELECT \* FROM rooms .*FOR UPDATE/.test(sql)) {
      return [[{ id: 7, status: 'playing', host_user_id: 3, current_players: 3 }], []];
    }
    return [{ affectedRows: 1 }, []];
  });
  const svc = loadWithDb('../src/services/room-service', {
    pool: { getConnection: async () => conn },
    queryOne: async () => null,
    queryAll: async () => [],
  });

  await assert.rejects(svc.leaveRoom(7, 5), (err) => err.statusCode === 400);
  assert.ok(!conn.calls.some((c) => /DELETE FROM room_players/.test(c.sql)));
  assert.ok(conn.calls.some((c) => c.sql === 'ROLLBACK'));
});

test('leaveRoom locks the room row before any room_players write (lock order matches join/start)', async () => {
  const conn = makeConnection((sql) => {
    if (/SELECT \* FROM rooms .*FOR UPDATE/.test(sql)) {
      return [[{ id: 7, status: 'waiting', host_user_id: 3, current_players: 2 }], []];
    }
    if (/SELECT \* FROM room_players .*FOR UPDATE/.test(sql)) {
      return [[{ user_id: 5, is_host: 0 }], []];
    }
    if (/SELECT COUNT/.test(sql)) return [[{ count: 1 }], []];
    return [{ affectedRows: 1 }, []];
  });
  const svc = loadWithDb('../src/services/room-service', {
    pool: { getConnection: async () => conn },
    queryOne: async () => ({ id: 7, status: 'waiting' }),
    queryAll: async () => [],
  });

  await svc.leaveRoom(7, 5).catch(() => {});
  const roomLock = conn.calls.findIndex((c) => /FROM rooms .*FOR UPDATE/.test(c.sql));
  const deleteIdx = conn.calls.findIndex((c) => /DELETE FROM room_players/.test(c.sql));
  assert.ok(roomLock >= 0 && deleteIdx > roomLock);
});

test('listAvailableRooms is a single bounded query with per-room counts', async () => {
  let seen = '';
  const svc = loadWithDb('../src/services/room-service', {
    pool: { getConnection: async () => null },
    queryOne: async () => { throw new Error('should not be called per room'); },
    queryAll: async (sql) => {
      seen = sql;
      return [{ id: 1, status: 'waiting', player_count: '3' }];
    },
  });

  const rooms = await svc.listAvailableRooms();
  assert.match(seen, /LIMIT 100/);
  assert.equal(rooms[0].player_count, 3);
});

// ── equipItem (H-10) ──────────────────────────────────────────────────────

test('equipItem takes the slot from the owned item, not from the client category', async () => {
  const conn = makeConnection(() => [{ affectedRows: 1 }, []]);
  const svc = loadWithDb('../src/services/shop-service', {
    pool: { getConnection: async () => conn },
    queryOne: async () => ({ id: 1, category: 'skin' }),
    queryAll: async () => [],
    execute: async () => [{ affectedRows: 1 }, []],
  });

  await svc.equipItem(11, 'skin-red-koi', 'pet');
  const unequip = conn.calls.find((c) => /SET is_equipped = 0/.test(c.sql));
  assert.deepEqual(unequip.params, [11, 'skin']);
});

// ── stored result medal per viewer (H-5) ──────────────────────────────────

test('stored result medal is recomputed for the viewer instead of inheriting first place', () => {
  const svc = loadWithDb('../src/services/game-service', {
    pool: { getConnection: async () => null },
    queryOne: async () => null,
    queryAll: async () => [],
  });
  const stored = svc.buildResultPayload({
    sessionId: 9,
    stage: { id: 1, name: '测试' },
    initialScores: { 1: 0, 12: 0 },
    players: [
      { id: '1', name: 'A', score: 300, isRobot: false },
      { id: '12', name: 'B', score: 40, isRobot: false },
    ],
    runWorld: null,
  });
  const playerRow = { rank: 2, final_score: 40, initial_score: 0, coins_earned: 120 };
  const forB = svc.personalizeStoredResultPayload(JSON.parse(JSON.stringify(stored)), {
    viewerUserId: 12, sessionId: 9, playerRow, stage: { id: 1, name: '测试' },
  });
  assert.equal(forB.rank, 2);
  const firstPlaceMedal = stored.achievementMedal;
  assert.notDeepEqual(forB.achievementMedal, firstPlaceMedal);
});
