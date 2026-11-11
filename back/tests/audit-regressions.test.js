const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, deps, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name in deps) return deps[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
    console: { log() {}, error() {} }, Map, Date, Math,
    setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
  });
  return module.exports;
}

function socketHarness({ blocked = false, throwState = false } = {}) {
  const handlers = {};
  let authenticate, connect;
  const sent = [];
  const socket = {
    id: 'test', userId: 1, handshake: { auth: { token: 'valid' } },
    on(event, fn) { handlers[event] = fn; },
    emit(event, data) { sent.push({ event, data }); },
    join() {}, leave() {}, disconnect() { this.disconnected = true; },
    to() { return { emit() {} }; },
  };
  const guard = {
    assertActiveUser: async () => { if (blocked) throw new Error('account_disabled'); },
    watchAccount: () => () => {},
  };
  const init = load('socket/arena-handler.js', {
    jsonwebtoken: { verify: () => ({ userId: 1 }) }, '../config': { jwt: { secret: 'test' } },
    '../models/db': { queryOne: async () => ({ present: 1 }) },
    '../services/game-service': { getGameState() { if (throwState) throw new Error('state failed'); return null; } },
    './account-guard': guard,
  });
  init({ use(fn) { authenticate = fn; }, on(event, fn) { connect = fn; } });
  connect(socket);
  return { socket, handlers, sent, authenticate };
}

test('Socket.IO rejects malformed event payloads without throwing', async () => {
  const { handlers, sent } = socketHarness();
  for (const event of ['join_arena', 'leave_arena', 'emote', 'fortune_buy']) {
    for (const payload of [undefined, null, [], 'bad', {}, { sessionId: {} }]) {
      await assert.doesNotReject(async () => handlers[event](payload));
    }
  }
  assert.ok(sent.some(({ event, data }) => event === 'arena_error' && data.code === 400));
});

test('Socket.IO contains failures after membership validation', async () => {
  const { handlers, sent } = socketHarness({ throwState: true });
  await assert.doesNotReject(async () => handlers.join_arena({ sessionId: 5 }));
  assert.ok(sent.some(({ event, data }) => event === 'arena_error' && data.code === 500));
});

test('Socket.IO rejects valid JWTs belonging to disabled accounts', async () => {
  const { authenticate, socket } = socketHarness({ blocked: true });
  let error;
  await authenticate(socket, (err) => { error = err; });
  assert.ok(error);
});

test('failed initialization recovers the committed session before returning an error', async () => {
  const routes = {};
  const router = { use() {}, get() {}, post(p, fn) { routes[p] = fn; } };
  let status = 'waiting';
  let recovered = false;
  load('routes/rooms.js', {
    express: { Router: () => router }, '../middleware/auth': () => {},
    '../utils/response': { success: (x) => x, fail: (message) => ({ message }) },
    '../services/room-service': { startGame: async () => { status = 'playing'; return { roomId: 10, sessionId: 20 }; } },
    '../services/game-service': {
      startGameSession: async () => { throw new Error('initialization failed'); },
      recoverFailedStart: async (id) => { assert.equal(id, 20); status = 'waiting'; recovered = true; },
    },
  });
  const res = { status(c) { this.code = c; return this; }, json(body) { this.body = body; } };
  await routes['/:id/start']({ params: { id: '10' }, user: { userId: 1 }, app: { get() { return {}; } } }, res);
  assert.equal(res.code, 500);
  assert.equal(recovered, true);
  assert.equal(status, 'waiting');
});

test('account watcher revokes an idle connection and stops its timer', async () => {
  let check, cleared = false, revoked = false;
  const guard = load('socket/account-guard.js', {
    '../middleware/auth': { assertActiveUser: async () => { throw Object.assign(new Error('账号已被封禁，请联系客服'), { statusCode: 403 }); } },
  }, {
    setInterval(fn) { check = fn; return { unref() {} }; },
    clearInterval() { cleared = true; },
  });
  guard.watchAccount(1, () => { revoked = true; });
  await check();
  assert.equal(revoked, true);
  assert.equal(cleared, true);
});

test('closed connections stop their account watcher without late revocation', async () => {
  let check, resolveCheck, revoked = false;
  const guard = load('socket/account-guard.js', {
    '../middleware/auth': {
      assertActiveUser: () => new Promise((_resolve, reject) => { resolveCheck = reject; }),
    },
  }, {
    setInterval(fn) { check = fn; return { unref() {} }; }, clearInterval() {},
  });
  const stop = guard.watchAccount(1, () => { revoked = true; });
  const pending = check();
  stop();
  resolveCheck(new Error('account disabled'));
  await pending;
  assert.equal(revoked, false);
});

test('legacy native WebSocket entry rejects disabled members before sending state', async () => {
  const handlers = {};
  class WebSocketServer {
    on(event, fn) { (handlers[event] ||= []).push(fn); }
  }
  const native = load('socket/native-arena-ws.js', {
    jsonwebtoken: { verify: () => ({ userId: 1 }) },
    ws: { WebSocket: { OPEN: 1 }, WebSocketServer }, '../config': { jwt: { secret: 'test' } },
    '../models/db': { queryOne: async () => ({ present: 1 }) },
    '../services/game-service': { getGameState() { assert.fail('disabled user must not read state'); } },
    './account-guard': { assertActiveUser: async () => { throw new Error('account disabled'); }, watchAccount() {} },
  });
  native.initNativeArenaWs({});
  const ws = { on() {}, close(code) { this.closeCode = code; } };
  await handlers.connection[0](ws, {
    url: '/ws/arena?sessionId=5', headers: { 'sec-websocket-protocol': 'arena.valid' },
  });
  assert.equal(ws.closeCode, 4001);
});

test('real Socket.IO transport survives a missing payload and accepts the next valid event', async () => {
  const http = require('node:http');
  const { Server } = require('socket.io');
  const { WebSocket } = require('ws');
  const server = http.createServer();
  const io = new Server(server);
  const init = load('socket/arena-handler.js', {
    jsonwebtoken: { verify: () => ({ userId: 1 }) }, '../config': { jwt: { secret: 'test' } },
    '../models/db': { queryOne: async () => ({ present: 1 }) },
    '../services/game-service': { getGameState: () => ({ sessionId: 5 }) },
    './account-guard': { assertActiveUser: async () => {}, watchAccount: () => () => {} },
  });
  init(io);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/socket.io/?EIO=4&transport=websocket`);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket.IO regression timed out')), 3000);
      ws.on('error', reject);
      ws.on('message', (raw) => {
        const packet = String(raw);
        if (packet.startsWith('0')) ws.send('40{"token":"valid"}');
        else if (packet.startsWith('40')) ws.send('42["leave_arena"]');
        else if (packet.startsWith('42')) {
          const [event, data] = JSON.parse(packet.slice(2));
          if (event === 'arena_error') {
            assert.equal(data.code, 400);
            ws.send('42["join_arena",{"sessionId":5}]');
          } else if (event === 'game_state') {
            assert.equal(data.sessionId, 5);
            clearTimeout(timer);
            resolve();
          }
        }
      });
    });
  } finally {
    ws.terminate();
    await new Promise((resolve) => io.close(resolve));
  }
});
