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

test('startGame escapes rank column when creating game players', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params = []) => {
      calls.push({sql, params});
      if (/INSERT INTO game_sessions/.test(sql)) {
        return [{insertId: 99}, []];
      }
      return [{affectedRows: 1}, []];
    },
  };
  const dbStub = {
    pool: {
      getConnection: async () => connection,
    },
    queryOne: async (sql) => {
      if (/FROM rooms/.test(sql)) {
        return {id: 28, stage_id: 1, status: 'waiting', host_user_id: 3};
      }
      return null;
    },
    queryAll: async (sql) => {
      if (/FROM room_players/.test(sql)) {
        return [{user_id: 3, seat: 1, is_ready: 1, is_host: 1}];
      }
      if (/FROM game_players/.test(sql)) {
        return [{session_id: 99, user_id: 3, seat: 1}];
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
