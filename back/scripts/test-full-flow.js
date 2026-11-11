/**
 * 隔离 MySQL + HTTP + WebSocket 集成验收。
 * 账号通过测试 SQL 创建；微信登录、审核和真机验收使用各自发布流程。
 */
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {once} = require('node:events');
const mysql = require('mysql2/promise');
const WebSocket = require('ws');

const container = 'jinli-flow-' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
const sockets = [];
let backend, db, gameService, connection, containerCreated = false;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 30000, env: {...process.env, MYSQL_ROOT_PASSWORD: password}, stdio: ['ignore', 'pipe', 'pipe']}).trim();

async function main() {
  console.log('[integration] 创建独立 MySQL 容器');
  docker('run', '-d', '--rm', '--name', container, '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_DATABASE=jinli_flow', '-e', 'MYSQL_ROOT_HOST=%', '-p', '127.0.0.1::3306', 'mysql:8.4');
  containerCreated = true;
  const port = Number(docker('port', container, '3306/tcp').split(':').pop());
  const settings = {host: '127.0.0.1', port, user: 'root', password, database: 'jinli_flow', multipleStatements: true, connectTimeout: 1500};
  const deadline = Date.now() + 90000;
  while (!connection && Date.now() < deadline) {
    try {connection = await mysql.createConnection(settings);} catch {await wait(1000);}
  }
  assert.ok(connection, '独立 MySQL 在限定时间内启动');
  for (const file of fs.readdirSync(path.join(__dirname, '../sql')).filter((file) => /^\d.*\.sql$/.test(file)).sort()) {
    try {
      await connection.query(fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8'));
    } catch (error) {
      error.message = `${file}: ${error.message}`;
      throw error;
    }
  }
  await connection.end(); connection = null;
  Object.assign(process.env, {NODE_ENV: 'test', PORT: '0', DB_HOST: settings.host, DB_PORT: String(port), DB_USER: settings.user,
    DB_PASSWORD: password, DB_NAME: settings.database, JWT_SECRET: randomBytes(32).toString('hex'), ADMIN_JWT_SECRET: randomBytes(32).toString('hex')});
  db = require('../src/models/db');
  const auth = require('../src/services/auth-service');
  gameService = require('../src/services/game-service');
  backend = require('../src/app');
  if (!backend.server.listening) await once(backend.server, 'listening');
  // Startup reconciliation completes against the empty database before new games begin.
  await gameService.reconcileOrphanSessions();
  const base = 'http://127.0.0.1:' + backend.server.address().port;
  const initialCoins = 8820;
  const users = await Promise.all(['host', 'guest', 'outsider'].map((name) => auth.findOrCreateUser('integration-' + name, initialCoins)));
  const tokens = users.map((user) => auth.generateToken(user));
  async function request(index, route, method = 'GET', body, status = 200) {
    const response = await fetch(base + '/api' + route, {method, headers: {'content-type': 'application/json', ...(index === null ? {} : {authorization: 'Bearer ' + tokens[index]})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const payload = await response.json();
    assert.equal(response.status, status, method + ' ' + route + ': ' + JSON.stringify(payload));
    if (status === 200) assert.equal(payload.code, 0);
    return payload.data;
  }
  const created = await request(0, '/rooms', 'POST', {stageId: 1});
  const roomId = created.room.id;
  const lookup = await request(1, '/rooms/code/' + created.room.room_code);
  assert.equal(lookup.room.id, roomId);
  await request(1, '/rooms/' + roomId + '/join', 'POST', {});
  await request(0, '/rooms/' + roomId + '/start', 'POST', {}, 409);
  await request(1, '/rooms/' + roomId + '/ready', 'POST', {});
  const started = await request(0, '/rooms/' + roomId + '/start', 'POST', {});
  const sessionId = started.sessionId;
  const game = gameService.getActiveGame(sessionId);
  gameService.stopAllTimers();
  assert.ok(game);
  assert.equal(game.duration, 120);
  assert.ok(game.runWorld, '使用跑动场地规则');
  const states = await Promise.all([request(0, '/games/' + sessionId), request(1, '/games/' + sessionId)]);
  for (let i = 0; i < 2; i++) assert.deepEqual(states[i].players.filter((p) => p.isSelf).map((p) => p.id), [String(users[i].id)]);
  await request(null, '/games/' + sessionId, 'GET', undefined, 401);
  await request(2, '/games/' + sessionId, 'GET', undefined, 404);
  await request(0, '/games/' + sessionId + '/result', 'GET', undefined, 409);

  function connect(index) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/arena?sessionId=' + sessionId, ['arena.' + tokens[index]]);
    sockets.push(ws);
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('error', () => {});
    return {ws, messages};
  }
  async function message(client, event) {
    const expires = Date.now() + 5000;
    while (Date.now() < expires) {
      const result = client.messages.find((item) => item.event === event);
      if (result) return result.data;
      await wait(20);
    }
    assert.fail('WebSocket event timeout: ' + event);
  }
  const clients = [connect(0), connect(1)];
  for (let i = 0; i < clients.length; i++) {
    const state = await message(clients[i], 'game_state');
    assert.equal(state.players.find((p) => p.isSelf).id, String(users[i].id));
  }
  const outsider = connect(2);
  const closed = await once(outsider.ws, 'close');
  assert.equal(closed[0], 4001);
  await request(0, '/games/' + sessionId + '/move', 'POST', {dx: 1, dy: 0}, 400);
  await request(0, '/games/' + sessionId + '/ready', 'POST', {});
  assert.equal((await request(0, '/games/' + sessionId)).awaitingStart, true);
  await request(1, '/games/' + sessionId + '/ready', 'POST', {});
  assert.equal((await request(0, '/games/' + sessionId)).awaitingStart, false);
  await request(0, '/games/' + sessionId + '/team', 'POST', {targetId: String(users[1].id)});
  assert.equal(game.teams.length, 0, '单方邀请不会直接成队');
  await request(1, '/games/' + sessionId + '/team', 'POST', {targetId: String(users[0].id)});
  const initialX = game.runWorld.runners.find((r) => r.id === String(users[0].id)).x;
  for (let i = 0; i < 13; i++) {
    await request(0, '/games/' + sessionId + '/move', 'POST', {dx: 1, dy: 0});
    await request(1, '/games/' + sessionId + '/move', 'POST', {dx: -1, dy: 0});
    await gameService.tick(game, backend.app.get('arenaRealtime'), 100);
  }
  assert.ok(game.runWorld.runners.find((r) => r.id === String(users[0].id)).x > initialX);
  assert.ok(game.teams.some((team) => team.memberIds.includes(String(users[0].id)) && team.memberIds.includes(String(users[1].id))));
  for (let i = 0; i < 2; i++) await request(i, '/games/' + sessionId + '/move', 'POST', {dx: 0, dy: 0});
  await message(clients[1], 'state_changed');

  // 固定掉落位置作为碰撞输入，走真实 tick 与结算链路，不让客户端提交奖励。
  const score = game.players.find((p) => p.id === String(users[0].id)).score;
  const mateScore = game.players.find((p) => p.id === String(users[1].id)).score;
  const runner = game.runWorld.runners.find((r) => r.id === String(users[0].id));
  game.runWorld.drops.push({id: 'integration-bag', kind: 'bag', x: runner.x, y: runner.y, value: 10, speed: 1, warningUntil: 0});
  await gameService.tick(game, backend.app.get('arenaRealtime'), 20);
  assert.equal(game.players.find((p) => p.id === String(users[0].id)).score, score + 10);
  assert.equal(game.players.find((p) => p.id === String(users[1].id)).score, mateScore + 5);
  await request(0, '/games/' + sessionId + '/fortune-bag/claim', 'POST', {offerId: 'invented', bonus: 999999}, 400);
  await request(0, '/games/' + sessionId + '/emotes', 'POST', {emoteId: 'cheer'});
  assert.equal((await message(clients[1], 'emote_broadcast')).emoteId, 'cheer');
  clients[1].ws.close(); await once(clients[1].ws, 'close');
  const reconnected = connect(1);
  assert.equal((await message(reconnected, 'game_state')).timeLeft, game.timeLeft);
  while (game.status === 'playing') await gameService.tick(game, backend.app.get('arenaRealtime'));
  await message(clients[0], 'game_finished');
  const results = await Promise.all([request(0, '/games/' + sessionId + '/result'), request(1, '/games/' + sessionId + '/result')]);
  for (let i = 0; i < 2; i++) {
    const result = results[i];
    assert.equal(result.ranking.find((p) => p.isSelf).id, String(users[i].id));
    const user = await db.queryOne('SELECT coins, game_count FROM users WHERE id = ?', [users[i].id]);
    const ledger = await db.queryAll("SELECT * FROM coin_records WHERE user_id = ? AND type = 'game_reward'", [users[i].id]);
    assert.equal(Number(user.coins), initialCoins + result.coins); assert.equal(user.game_count, 1);
    assert.equal(ledger.length, 1); assert.equal(Number(ledger[0].amount), result.coins);
    const history = await request(i, '/stats/history?page=1&limit=20');
    assert.equal(history.records.length, 1);
    const summary = await request(i, '/stats/summary');
    assert.equal(summary.gameCount, 1);
    const records = await request(i, '/stats/coin-records?page=1&limit=20');
    assert.equal(records.records.length, 1);
    assert.equal(Number(records.records[0].amount), result.coins);
  }
  await gameService.finishGame(game, backend.app.get('arenaRealtime'));
  assert.equal((await db.queryOne('SELECT game_count FROM users WHERE id = ?', [users[0].id])).game_count, 1);
  assert.equal((await db.queryOne('SELECT status FROM rooms WHERE id = ?', [roomId])).status, 'finished');
  // Force the persisted result branch, equivalent to reading after cache eviction.
  gameService.getActiveGames().delete(sessionId);
  for (let i = 0; i < 2; i++) {
    const stored = await request(i, '/games/' + sessionId + '/result');
    assert.equal(stored.coins, results[i].coins);
    assert.equal(stored.ranking.find((p) => p.isSelf).id, String(users[i].id));
  }
  const catalog = await request(0, '/shop/items');
  const balanceBefore = Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[0].id])).coins);
  const item = catalog.filter((item) => item.price > 0 && item.price <= balanceBefore).sort((a, b) => a.price - b.price)[0];
  assert.ok(item, '结算收益可以购买目录商品');
  await request(0, '/shop/buy', 'POST', {itemId: item.id});
  await request(0, '/shop/equip', 'POST', {itemId: item.id, category: item.category});
  const inventory = await request(0, '/shop/inventory');
  assert.ok(inventory.some((owned) => owned.item_id === item.id && owned.is_equipped));
  assert.equal(Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[0].id])).coins), balanceBefore - item.price);
  const leaderboard = await require('../src/services/stats-service').getLeaderboard('income', 20);
  assert.ok(leaderboard.some((entry) => entry.id === users[0].id));
  await request(2, '/user/account', 'DELETE');
  await request(2, '/user/profile', 'GET', undefined, 401);
  console.log('[integration] PASS: SQL migrations, two-account room/readiness/start acknowledgement, personalized HTTP/WS, access control, movement/mutual team/collision/emote authority, reconnect, 120-second accelerated settlement, reward idempotency, ledger/history, persisted results, purchase/equip, leaderboard, account deletion');
}

main().catch((error) => {console.error('[integration] FAIL:', error.message); process.exitCode = 1;}).finally(async () => {
  for (const socket of sockets) socket.terminate();
  gameService?.stopAllTimers();
  if (backend) {
    backend.app.get('arenaRealtime').close();
    await new Promise((resolve) => backend.io.close(resolve));
    if (backend.server.listening) await new Promise((resolve) => backend.server.close(resolve));
  }
  if (db) await db.pool.end();
  if (connection) await connection.end();
  if (containerCreated) {docker('rm', '-f', container); console.log('[integration] 已清理独立容器');}
});

