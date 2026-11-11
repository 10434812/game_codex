const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');

const config = require('../src/config');

const SESSION_ID = 701;
const USER_ID = 31;

// 每个用例可自定义 game_players 查询的行为（正常 / 抛出数据库错误）。
function createDbStub(options = {}) {
  return {
    queryOne: async (sql, params = []) => {
      if (/FROM users/.test(sql)) return { is_banned: 0, deleted_at: null };
      if (/game_players/.test(sql)) {
        if (options.memberQueryError) throw new Error('ECONNRESET (simulated)');
        return params[0] === SESSION_ID && params[1] === USER_ID ? { present: 1 } : null;
      }
      return null;
    },
    execute: async () => [{}],
  };
}

function loadHub(dbStub, gameServiceStub) {
  const dbPath = require.resolve('../src/models/db');
  const gsPath = require.resolve('../src/services/game-service');
  for (const modPath of [
    require.resolve('../src/socket/arena-realtime'),
    gsPath,
    require.resolve('../src/socket/account-guard'),
    require.resolve('../src/middleware/auth'),
  ]) {
    delete require.cache[modPath];
  }
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  if (gameServiceStub) {
    require.cache[gsPath] = { id: gsPath, filename: gsPath, loaded: true, exports: gameServiceStub };
  }
  return require('../src/socket/arena-realtime');
}

async function startHub(dbStub, gameServiceStub) {
  const arenaRealtime = loadHub(dbStub, gameServiceStub);
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const hub = arenaRealtime.createArenaRealtimeHub(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, hub, port: server.address().port };
}

function stopHub({ server, hub }) {
  hub.close();
  server.close();
}

const tokenFor = (userId) => jwt.sign({ userId }, config.jwt.secret, { expiresIn: '1h' });

function openClient(port, { protocols = [], path = '/ws/arena', query = `?sessionId=${SESSION_ID}` } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}${query}`, protocols);
    const messages = [];
    const timer = setTimeout(() => { ws.terminate(); resolve({ closeCode: 'timeout', messages, ws }); }, 3000);
    const done = (result) => { clearTimeout(timer); resolve({ ...result, messages, ws }); };
    ws.on('message', (raw) => {
      const payload = JSON.parse(String(raw));
      messages.push(payload);
      if (payload.event === 'connected') done({ closeCode: null, opened: true });
    });
    ws.on('close', (code) => done({ closeCode: code, opened: false }));
    ws.on('error', () => {});
  });
}

test('未被认领的 Upgrade 路径会被拒绝并断开，而不是无限期挂起', async (t) => {
  const handle = await startHub(createDbStub());
  t.after(() => stopHub(handle));
  const socket = net.connect(handle.port, '127.0.0.1');
  const closed = new Promise((resolve) => socket.on('close', resolve));
  const response = [];
  socket.on('data', (chunk) => response.push(chunk));
  socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 2000));
  const outcome = await Promise.race([closed.then(() => 'closed'), timeout]);
  assert.equal(outcome, 'closed');
  assert.match(Buffer.concat(response).toString(), /^HTTP\/1\.1 404/);
});

test('ws 层 maxPayload 拒绝超大帧，成员连接随之关闭', async (t) => {
  const handle = await startHub(createDbStub());
  t.after(() => stopHub(handle));
  const result = await openClient(handle.port, { protocols: [`arena.${tokenFor(USER_ID)}`] });
  assert.equal(result.closeCode, null, 'member should be admitted first');
  const closed = new Promise((resolve) => result.ws.on('close', (code) => resolve(code)));
  result.ws.send('x'.repeat(64 * 1024));
  const code = await closed;
  assert.equal(code, 1009);
});

test('成员校验遇到数据库瞬时故障时关闭码为 1011，而不是被报告为权限失效 4001', async (t) => {
  const handle = await startHub(createDbStub({ memberQueryError: true }));
  t.after(() => stopHub(handle));
  const result = await openClient(handle.port, { protocols: [`arena.${tokenFor(USER_ID)}`] });
  assert.equal(result.closeCode, 1011);
  assert.equal(result.messages.length, 0);
});

test('会话在内存中缺少该玩家时只关闭当前连接，服务进程与其它连接不受影响', async (t) => {
  const gameServiceStub = {
    getGameState() { throw Object.assign(new Error('对局不存在'), { statusCode: 404 }); },
    getActiveGame() { return null; },
    stopAllTimers() {},
  };
  const handle = await startHub(createDbStub(), gameServiceStub);
  t.after(() => stopHub(handle));
  const result = await openClient(handle.port, { protocols: [`arena.${tokenFor(USER_ID)}`] });
  assert.equal(result.closeCode, 1011);
  assert.equal(result.messages.length, 0);
});

test('NODE_ENV 非白名单取值（如 prod）启动即报错', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const backRoot = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
    cwd: backRoot,
    env: { ...process.env, NODE_ENV: 'prod' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NODE_ENV must be one of/);
});

test('账号巡检遇到数据库瞬时故障不会断开在线连接，待下一轮再判断', async () => {
  const authPath = require.resolve('../src/middleware/auth');
  const guardPath = require.resolve('../src/socket/account-guard');
  const savedAuth = require.cache[authPath];
  let check;
  let revoked = false;
  try {
    require.cache[authPath] = {
      id: authPath, filename: authPath, loaded: true,
      exports: { assertActiveUser: async () => { throw new Error('ECONNRESET (simulated)'); } },
    };
    delete require.cache[guardPath];
    const { watchAccount } = require('../src/socket/account-guard');
    const originalSetInterval = global.setInterval;
    global.setInterval = (fn) => { check = fn; return { unref() {} }; };
    let stop;
    try {
      stop = watchAccount(USER_ID, () => { revoked = true; });
    } finally {
      global.setInterval = originalSetInterval;
    }
    await check();
    assert.equal(revoked, false);
    stop();
  } finally {
    if (savedAuth) require.cache[authPath] = savedAuth; else delete require.cache[authPath];
    delete require.cache[guardPath];
  }
});
