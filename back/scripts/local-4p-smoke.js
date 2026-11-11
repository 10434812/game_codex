/**
 * 本地 4 人联机冒烟：连接本机 MySQL，启动一个临时后端实例（随机端口），
 * 用 4 个测试账号走完整 HTTP 流程：建房 → 加入 → 准备 → 开局 → 加速结算。
 *
 * 无需微信登录，账号由 auth-service 直接创建；与正在运行的 3010 实例共用数据库，
 * 但使用独立房间与随机 openid，不会互相干扰。
 *
 * 用法：cd back && node scripts/local-4p-smoke.js
 */
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const assert = require('node:assert/strict');
const { once } = require('node:events');
const mysql = require('mysql2/promise');

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'game_codex',
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let backendRef = null;

async function main() {
  const probe = await mysql.createConnection({ ...DB, connectTimeout: 3000 });
  const [tables] = await probe.query('SHOW TABLES LIKE "users"');
  assert.equal(tables.length, 1, '本地数据库缺少 users 表，先执行迁移');
  await probe.end();

  process.env.PORT = '0';
  const db = require('../src/models/db');
  const auth = require('../src/services/auth-service');
  const gameService = require('../src/services/game-service');
  const backend = require('../src/app');
  backendRef = backend;
  if (!backend.server.listening) await once(backend.server, 'listening');
  const base = `http://127.0.0.1:${backend.server.address().port}`;
  const realtime = backend.app.get('arenaRealtime');

  const tag = `smoke-${Date.now()}`;
  const users = [];
  for (let i = 1; i <= 4; i += 1) users.push(await auth.findOrCreateUser(`${tag}-${i}`));
  const tokens = users.map((user) => auth.generateToken(user));

  async function request(index, route, method = 'GET', body, status = 200) {
    const response = await fetch(base + '/api' + route, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(index === null ? {} : { authorization: `Bearer ${tokens[index]}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(payload)}`);
    if (status === 200) assert.equal(payload.code, 0, `${method} ${route}: ${JSON.stringify(payload)}`);
    return payload.data;
  }

  console.log(`[4p] 4 个测试账号就绪：${users.map((u) => u.id).join(', ')}`);
  const created = await request(0, '/rooms', 'POST', { stageId: 1 });
  const roomId = created.room.id;
  const roomCode = created.room.room_code;
  console.log(`[4p] 房间已创建：id=${roomId} 房间码=${roomCode}`);

  for (let i = 1; i < 4; i += 1) {
    await request(i, '/rooms/' + roomId + '/join', 'POST', {});
  }
  console.log('[4p] 4 人已进房，未准备开局应被拒绝');
  await request(0, '/rooms/' + roomId + '/start', 'POST', {}, 409);

  for (let i = 1; i < 4; i += 1) {
    await request(i, '/rooms/' + roomId + '/ready', 'POST', {});
  }
  const started = await request(0, '/rooms/' + roomId + '/start', 'POST', {});
  const sessionId = started.sessionId;
  const game = gameService.getActiveGame(sessionId);
  assert.ok(game, '开局后应有内存对局');
  gameService.stopAllTimers();
  console.log(`[4p] 对局已开始：session=${sessionId}，玩家 ${game.players.length} 人`);

  const states = await Promise.all(users.map((_, i) => request(i, '/games/' + sessionId)));
  for (let i = 0; i < 4; i += 1) {
    const self = states[i].players.filter((player) => player.isSelf).map((player) => player.id);
    assert.deepEqual(self, [String(users[i].id)], `玩家 ${i + 1} 的个性化状态错误`);
  }
  console.log('[4p] 个性化状态校验通过（每人只看到自己的可亮分身份）');

  let ticks = 0;
  while (game.status === 'playing' && ticks < 400) {
    await gameService.tick(game, realtime);
    ticks += 1;
  }
  assert.equal(game.status, 'finished', `对局未在 ${ticks} tick 内结束`);
  console.log(`[4p] 加速 tick ${ticks} 次后对局结束`);

  const results = await Promise.all(users.map((_, i) => request(i, '/games/' + sessionId + '/result')));
  for (let i = 0; i < 4; i += 1) {
    const result = results[i];
    const self = result.ranking.find((player) => player.isSelf);
    assert.ok(self, `玩家 ${i + 1} 结果缺少自己`);
    const user = await db.queryOne('SELECT coins, game_count FROM users WHERE id = ?', [users[i].id]);
    const ledger = await db.queryAll(
      "SELECT amount FROM coin_records WHERE user_id = ? AND type = 'game_reward'",
      [users[i].id]
    );
    assert.equal(user.game_count, 1, `玩家 ${i + 1} 对局计数错误`);
    assert.equal(ledger.length, 1, `玩家 ${i + 1} 奖励流水条数错误`);
    assert.equal(Number(ledger[0].amount), result.coins);
    assert.ok(Number(user.coins) >= 0);
  }
  assert.equal(
    (await db.queryOne('SELECT status FROM rooms WHERE id = ?', [roomId])).status,
    'finished',
    '结算后房间状态应回写 finished'
  );
  console.log('[4p] 结算、奖励流水、房间状态全部通过');

  const summary = results.map((result, i) => ({
    user: users[i].id,
    rank: result.ranking.find((player) => player.isSelf).rank,
    coins: result.coins,
  }));
  console.table(summary);

  // 软删测试账号，避免污染本地登录列表
  await db.queryAll('UPDATE users SET deleted_at = NOW() WHERE id IN (?, ?, ?, ?)', users.map((u) => u.id));
  console.log('[4p] PASS：4 人建房/加入/准备/开局/个性化/结算/奖励/房间回写');
}

main()
  .catch((error) => {
    console.error('[4p] FAIL:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (backendRef) {
        backendRef.app.get('arenaRealtime').close();
        await new Promise((resolve) => backendRef.io.close(resolve));
        if (backendRef.server.listening) await new Promise((resolve) => backendRef.server.close(resolve));
      }
    } catch (_) {}
    try {
      const db = require('../src/models/db');
      await db.pool.end();
    } catch (_) {}
  });
