const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({failStart = false, failSession = false, failRecovery = false, failBackoff = false} = {}) {
  const attempted = [], sessions = [], recovered = [], deferred = [], errors = [];
  let released = 0;
  const deps = {
    '../models/db': {
      pool: {getConnection: async () => ({
        execute: async () => [[{acquired: 1}]], release: () => {released++;},
      })},
      queryAll: async () => [1, 2].map((id) => ({id, host_user_id: id + 10})),
      execute: async (sql, params) => {
        assert.match(sql, /match_due_at/);
        if (failBackoff) throw new Error('backoff failed');
        deferred.push(params[0]);
      },
    },
    './room-service': {startGame: async (id) => {
      attempted.push(id);
      if (id === 1 && failStart) throw new Error('room unavailable');
      return {roomId: id, sessionId: id + 100};
    }},
    './game-service': {
      startGameSession: async (id) => {
        sessions.push(id);
        if (id === 1 && failSession) throw new Error('session failed');
      },
      recoverFailedStart: async (id) => {
        recovered.push(id);
        if (failRecovery) throw new Error('recovery failed');
      },
    },
    '../game-engine/constants': {STAGES: [{id: 1}]},
    '../utils/logger': {error: (...args) => errors.push(args)},
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/matchmaking-service.js'), 'utf8'), {
    module, require: (name) => {
      assert.ok(name in deps, `unexpected dependency: ${name}`);
      return deps[name];
    },
  });
  return {service: module.exports, deps, attempted, sessions, recovered, deferred, errors, released: () => released};
}

test('首页优先加入匹配房，无房可加入时只建一个好友房', async () => {
  const {service, deps} = harness();
  let available = {id: 42};
  let existing;
  const roomService = deps['./room-service'];
  deps['../models/db'].queryOne = async (sql) => {
    if (sql.includes('game_sessions')) return null;
    return sql.includes('room_players') ? existing?.room : available;
  };
  roomService.joinRoom = async (id) => ({room: {id, match_due_at: 'soon'}});
  roomService.getRoom = async () => existing;
  roomService.createRoom = async (userId, stageId, options) => {
    assert.equal(userId, 7);
    assert.equal(stageId, 1);
    if (options?.matchmaking) return {room: {id: 44, match_due_at: 'soon'}};
    assert.equal(existing, undefined);
    existing = {room: {id: 43, match_due_at: null}};
    return existing;
  };
  const options = {createFriendRoomIfEmpty: true};
  assert.equal((await service.join(7, 1, options)).room.id, 42);
  available = null;
  assert.equal((await service.join(7, 1)).room.id, 44);
  const [created, repeated] = await Promise.all([service.join(7, 1, options), service.join(7, 1, options)]);
  assert.equal(created.autoCreatedFriendRoom, true);
  assert.equal(created.room.match_due_at, null);
  assert.equal(repeated, existing);
});

test('坏房间不会阻塞后续匹配，并延期重试避免持续占据队首', async () => {
  const h = harness({failStart: true});
  await h.service.advanceDue({});
  assert.deepEqual(h.attempted, [1, 2]);
  assert.deepEqual(h.sessions, [2]);
  assert.deepEqual(h.deferred, [1]);
  assert.equal(h.released(), 1);
});

test('会话初始化失败先恢复该局，再继续后续匹配', async () => {
  const h = harness({failSession: true});
  await h.service.advanceDue({});
  assert.deepEqual(h.sessions, [1, 2]);
  assert.deepEqual(h.recovered, [101]);
  assert.deepEqual(h.deferred, [1]);
});

test('恢复或延期本身失败时记录错误，仍不饿死后续房间', async () => {
  const h = harness({failSession: true, failRecovery: true, failBackoff: true});
  await h.service.advanceDue({});
  assert.deepEqual(h.sessions, [1, 2]);
  assert.ok(h.errors.length >= 2);
  assert.equal(h.released(), 1);
});

test('服务排空时停止启动新局', async () => {
  const h = harness();
  await h.service.advanceDue({}, () => false);
  assert.deepEqual(h.attempted, []);
  assert.equal(h.released(), 1);
});
