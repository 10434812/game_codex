const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

const config = require('../src/config');

const SESSION_ID = 501;
const MEMBER_USER_ID = 11;
const OUTSIDER_USER_ID = 22;

/**
 * db stub: a user is a member of a session only for (SESSION_ID, MEMBER_USER_ID).
 */
function createDbStub() {
  const calls = [];
  const memberSet = new Set([`${SESSION_ID}:${MEMBER_USER_ID}`]);
  const users = new Map([
    [MEMBER_USER_ID, { is_banned: 0, deleted_at: null }],
    [OUTSIDER_USER_ID, { is_banned: 0, deleted_at: null }],
  ]);
  return {
    calls,
    users,
    queryOne: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM users/.test(sql)) return users.get(params[0]) || null;
      if (!/game_players/.test(sql)) return null;
      return memberSet.has(`${params[0]}:${params[1]}`) ? { present: 1 } : null;
    },
  };
}

/**
 * Load a fresh arena-realtime module bound to the stubbed db (same
 * require.cache replacement pattern as game-service.test.js).
 */
function loadHub(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  for (const modPath of [
    require.resolve('../src/socket/arena-realtime'),
    require.resolve('../src/services/game-service'),
    require.resolve('../src/socket/account-guard'),
    require.resolve('../src/middleware/auth'),
  ]) {
    delete require.cache[modPath];
  }
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/socket/arena-realtime');
}

async function startHub(dbStub) {
  const arenaRealtime = loadHub(dbStub);
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const hub = arenaRealtime.createArenaRealtimeHub(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, hub, port: server.address().port };
}

/**
 * Open a real WebSocket client against the hub and resolve with the first
 * terminal outcome (open or close). Fails the test on timeout.
 */
function connectClient(port, { protocols = [], query = '' } = {}) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws/arena${query}`, protocols);
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    let opened = false;
    const messages = [];
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.terminate();
        reject(new Error('ws connection test timed out'));
      }
    }, 3000);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, ws });
    };
    ws.on('message', (raw) => {
      const payload = JSON.parse(String(raw));
      messages.push(payload);
      // Accepted connections are settled by their first `connected` event;
      // rejected ones never get a message and settle on `close` below.
      if (payload.event === 'connected') {
        finish({ opened, closeCode: null, reason: '', messages });
      }
    });
    ws.on('open', () => {
      opened = true;
    });
    ws.on('close', (code, reason) => {
      finish({ opened, closeCode: code, reason: String(reason), messages });
    });
    ws.on('error', () => {
      // ws emits error before close for failed handshakes; ignore it.
    });
  });
}

const tokenFor = (userId) => jwt.sign({ userId }, config.jwt.secret, { expiresIn: '1h' });

test('真实 WebSocket 方向输入经服务端碰撞计分后返回个人快照，松手输入立即生效', async () => {
  const service = require('../src/services/game-service');
  const run = require('../src/game-engine/run-arena');
  const players = [MEMBER_USER_ID, OUTSIDER_USER_ID].map((id, i) => ({id: String(id), name: String(id), seat: i + 1, score: 100, teamId: null, isRobot: false}));
  const world = run.createRunWorld(players); world.nextDropAt = 100000;
  const first = world.runners[0]; world.drops.push({id: 'bag', kind: 'bag', value: 10, x: first.x, y: first.y, speed: 1, warningUntil: 0});
  const game = {sessionId: SESSION_ID, players, teams: [], runWorld: world, duration: 100, timeLeft: 100, round: 0, status: 'playing', scoreLog: {}};
  service.getActiveGames().set(SESSION_ID, game);
  const {ws} = await connectClient(port, {protocols: [`arena.${tokenFor(MEMBER_USER_ID)}`], query: `?sessionId=${SESSION_ID}`});
  const input = (dx, dy) => new Promise((resolve) => {ws.once('pong', resolve); ws.send(JSON.stringify({event: 'run_input', data: {dx, dy, actorId: String(OUTSIDER_USER_ID), score: 99999}})); ws.ping();});
  try {
    await input(1, 0);
    assert.equal(game.runWorld.runners[0].dx, 1); assert.equal(game.runWorld.runners[1].dx, 0);
    const frame = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('实时快照超时')), 2000);
      ws.on('message', function received(raw) {const message = JSON.parse(String(raw)); if (message.event === 'game_state' && message.data.stateVersion >= 1) {clearTimeout(timer); ws.off('message', received); resolve(message.data);}});
    });
    await service.tick(game, hub, 100); const snapshot = await frame;
    assert.ok(snapshot.runWorld.runners[0].x > first.x); assert.equal(snapshot.players[0].score, 110);
    assert.equal(snapshot.players[1].score, 100); assert.equal(snapshot.players[0].isSelf, true); assert.equal(snapshot.players[1].isSelf, false);
    assert.equal(snapshot.runWorld.drops.length, 0);
    await input(0, 0); const x = game.runWorld.runners[0].x; await service.tick(game, hub, 100); assert.equal(game.runWorld.runners[0].x, x);
  } finally {ws.close(); service.getActiveGames().delete(SESSION_ID);}
});

let server = null;
let hub = null;
let port = 0;
let dbStub = null;

test.beforeEach(async () => {
  dbStub = createDbStub();
  const started = await startHub(dbStub);
  server = started.server;
  hub = started.hub;
  port = started.port;
});

test.afterEach(async () => {
  hub.close();
  await new Promise((resolve) => server.close(resolve));
  server = null;
  hub = null;
  port = 0;
  dbStub = null;
});

// ─── Token handling ──────────────────────────────────────────────────────

test('rejects a connection with no token (close code 4001)', async () => {
  const result = await connectClient(port);
  assert.equal(result.closeCode, 4001);
  assert.match(result.reason, /credentials|unauthorized/);
  assert.equal(result.messages.length, 0);
});

test('rejects an invalid token (close code 4001)', async () => {
  const result = await connectClient(port, { protocols: ['arena.not-a-real-jwt'], query: `?sessionId=${SESSION_ID}` });
  assert.equal(result.closeCode, 4001);
  assert.match(result.reason, /token/i);
  assert.equal(result.messages.length, 0);
});

test('accepts a member whose token arrives via Sec-WebSocket-Protocol subprotocol', async () => {
  const result = await connectClient(port, { protocols: [`arena.${tokenFor(MEMBER_USER_ID)}`], query: `?sessionId=${SESSION_ID}` });
  assert.equal(result.closeCode, null);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].event, 'connected');
  assert.equal(result.messages[0].data.sessionId, SESSION_ID);
});

test('legacy clients sending the token in the URL query still connect', async () => {
  const result = await connectClient(port, {
    query: `?sessionId=${SESSION_ID}&token=${encodeURIComponent(tokenFor(MEMBER_USER_ID))}`,
  });
  assert.equal(result.closeCode, null);
  assert.equal(result.messages[0].event, 'connected');
});

// ─── Membership check ────────────────────────────────────────────────────

test('rejects a valid token of a non-member (close code 4001)', async () => {
  const result = await connectClient(port, { protocols: [`arena.${tokenFor(OUTSIDER_USER_ID)}`], query: `?sessionId=${SESSION_ID}` });
  assert.equal(result.closeCode, 4001);
  assert.match(result.reason, /member/i);
  assert.equal(result.messages.length, 0);

  // The membership guard hit the DB with the expected query.
  const memberCalls = dbStub.calls.filter((call) => /game_players/.test(call.sql));
  assert.equal(memberCalls.length, 1);
  assert.deepEqual(memberCalls[0].params, [SESSION_ID, OUTSIDER_USER_ID]);
});

for (const [name, state] of [
  ['banned', { is_banned: 1, deleted_at: null }],
  ['deleted', { is_banned: 0, deleted_at: new Date() }],
  ['missing', null],
]) {
  test(`rejects a valid member token for a ${name} account`, async () => {
    dbStub.users.set(MEMBER_USER_ID, state);
    const result = await connectClient(port, {
      protocols: [`arena.${tokenFor(MEMBER_USER_ID)}`], query: `?sessionId=${SESSION_ID}`,
    });
    assert.equal(result.closeCode, 4001);
    assert.equal(result.messages.length, 0);
    assert.equal(dbStub.calls.filter(({ sql }) => /game_players/.test(sql)).length, 0);
  });
}

test('an idle connected member is disconnected after being banned', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const result = await connectClient(port, {
    protocols: [`arena.${tokenFor(MEMBER_USER_ID)}`], query: `?sessionId=${SESSION_ID}`,
  });
  assert.equal(result.closeCode, null);
  dbStub.users.set(MEMBER_USER_ID, { is_banned: 1, deleted_at: null });
  require('../src/middleware/auth').__private.invalidateUserState(MEMBER_USER_ID);
  const closed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('disabled connection did not close')), 3000);
    result.ws.once('close', (code) => { clearTimeout(timeout); resolve(code); });
  });
  t.mock.timers.tick(15000);
  assert.equal(await closed, 4001);
});

// ─── Frontend contract: subprotocol instead of query token ──────────────

test('frontend URL builder keeps the token out of the URL and exposes a subprotocol', () => {
  const { buildArenaRealtimeUrl, buildArenaRealtimeProtocols } = require('../../utils/arena-realtime');
  const url = buildArenaRealtimeUrl('https://xcx.ukb88.com/api', String(SESSION_ID), 'token-1');
  assert.equal(url, `wss://xcx.ukb88.com/ws/arena?sessionId=${SESSION_ID}`);
  assert.ok(!url.includes('token'), 'token must not appear in the ws URL');
  assert.deepEqual(
    buildArenaRealtimeProtocols('https://xcx.ukb88.com/api', String(SESSION_ID), 'token-1'),
    ['arena.token-1']
  );
  assert.deepEqual(
    buildArenaRealtimeProtocols('https://xcx.ukb88.com/api', String(SESSION_ID), ''),
    []
  );
});
