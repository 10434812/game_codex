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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  docker('run', '-d', '--rm', '--name', container, '-e', 'TZ=' + timezone, '-e', 'MYSQL_ROOT_PASSWORD', '-e', 'MYSQL_DATABASE=jinli_flow', '-e', 'MYSQL_ROOT_HOST=%', '-p', '127.0.0.1::3306', 'mysql:8.4');
  containerCreated = true;
  const port = Number(docker('port', container, '3306/tcp').split(':').pop());
  const settings = {host: '127.0.0.1', port, user: 'root', password, database: 'jinli_flow', multipleStatements: true, connectTimeout: 1500};
  const deadline = Date.now() + 90000;
  while (!connection && Date.now() < deadline) {
    try {connection = await mysql.createConnection(settings);} catch {await wait(1000);}
  }
  assert.ok(connection, '独立 MySQL 在限定时间内启动');
  const migrations = fs.readdirSync(path.join(__dirname, '../sql')).filter((file) => /^\d.*\.sql$/.test(file)).sort();
  for (const file of migrations) {
    try {
      await connection.query(fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8'));
    } catch (error) {
      error.message = `${file}: ${error.message}`;
      throw error;
    }
  }
  const {checkGameplaySchema} = require('./check-gameplay-release');
  let schemaBlockers = [];
  await checkGameplaySchema(connection, schemaBlockers);
  assert.deepEqual(schemaBlockers, [], '完整迁移后的真实数据库通过发布结构检查');
  await connection.execute('ALTER TABLE growth_claims DROP PRIMARY KEY');
  await checkGameplaySchema(connection, schemaBlockers);
  assert.ok(schemaBlockers.some((message) => message.includes('growth_claims缺少唯一索引')), '缺失奖励幂等索引必须阻止发布');
  await connection.execute('ALTER TABLE growth_claims ADD PRIMARY KEY (user_id, milestone_id)');
  schemaBlockers = [];
  await checkGameplaySchema(connection, schemaBlockers); assert.deepEqual(schemaBlockers, []);
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
  const username = 'integration-admin';
  const initialAdminPassword = randomBytes(16).toString('hex');
  const passwordHash = await require('bcryptjs').hash(initialAdminPassword, 4);
  const [adminRecord] = await db.execute(
    'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
    [username, passwordHash, 'super']
  );
  let adminToken;
  async function adminRequest(route, method = 'GET', body, status = 200, token = adminToken) {
    const response = await fetch(base + '/api/admin/' + route, {
      method,
      headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    assert.equal(response.status, status, method + ' /api/admin/' + route);
    const payload = await response.json();
    if (status === 200) assert.equal(payload.code, 0);
    return payload.data;
  }
  const adminGet = (route, authorized = true) => adminRequest(route, 'GET', undefined, authorized ? 200 : 401, authorized ? adminToken : null);
  const login = (password, status = 200) => adminRequest('auth/login', 'POST', {username, password}, status, null);
  await login('incorrect-password', 401);
  adminToken = (await login(initialAdminPassword)).token;
  for (const action of ['login', 'login_failed']) {
    const {records} = await adminGet('logs?action=' + action);
    assert.equal(records[0]?.adminId, adminRecord.insertId);
    assert.equal(records[0]?.adminName, username);
  }
  for (const suffix of ['/password', '']) {
    const nextPassword = randomBytes(16).toString('hex');
    await adminRequest('admins/' + adminRecord.insertId + suffix, 'PUT', {password: nextPassword});
    await adminRequest('stats/overview', 'GET', undefined, 401);
    adminToken = (await login(nextPassword)).token;
  }

  const secretKey = 'wechat.minigame_secret';
  const secret = randomBytes(16).toString('hex');
  await adminRequest('configs/' + secretKey, 'PUT', {value: secret});
  await adminRequest('configs', 'PUT', {configs: [{key: secretKey, value: secret}]});
  const auditRows = await db.queryAll("SELECT detail FROM operation_logs WHERE action = 'update' AND target_type = 'config'");
  assert.equal(auditRows.length, 2);
  assert.ok(auditRows.every(({detail}) => !String(detail).includes(secret)));
  const [legacyLog] = await db.execute(
    "INSERT INTO operation_logs (admin_id, admin_name, action, target_type, detail) VALUES (?, ?, 'update', 'config', ?)",
    [adminRecord.insertId, username, JSON.stringify({keys: [secretKey], values: [secret]})]
  );
  assert.deepEqual(JSON.parse((await adminGet('logs/' + legacyLog.insertId)).detail), {keys: [secretKey]});
  const {records: configLogs} = await adminGet('logs?action=update&targetType=config');
  assert.ok(!JSON.stringify(configLogs).includes(secret));
  await db.pool.query(`CREATE TRIGGER test_config_rollback BEFORE INSERT ON system_configs FOR EACH ROW
    BEGIN IF NEW.config_key = '${secretKey}' AND NEW.updated_by <> 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected_config_failure'; END IF; END`);
  try {
    const key = 'wechat.share_title';
    const {value} = await adminGet('configs/' + key);
    await adminRequest('configs', 'PUT', {configs: [{key, value: 'should roll back'}, {key: secretKey, value: secret}]}, 500);
    assert.equal((await adminGet('configs/' + key)).value, value);
  } finally {
    await db.pool.query('DROP TRIGGER test_config_rollback');
  }
  const created = await request(0, '/rooms', 'POST', {stageId: 1});
  const roomId = created.room.id;
  const lookup = await request(1, '/rooms/code/' + created.room.room_code);
  assert.equal(lookup.room.id, roomId);
  const joined = await request(1, '/rooms/' + roomId + '/join', 'POST', {});
  assert.ok(joined.players.some((player) => player.is_self && player.is_ready), '受邀加入默认已准备');
  await request(1, '/rooms/' + roomId + '/ready', 'POST', {});
  await request(0, '/rooms/' + roomId + '/start', 'POST', {}, 409);
  await request(1, '/rooms/' + roomId + '/ready', 'POST', {});
  const started = await request(0, '/rooms/' + roomId + '/start', 'POST', {});
  const sessionId = started.sessionId;
  const game = gameService.getActiveGame(sessionId);
  gameService.stopAllTimers();
  assert.ok(game);
  assert.equal(game.duration, 120);
  assert.ok(game.runWorld, '使用跑动场地规则');
  assert.ok(game.players.every((player) => player.score === 100), '真人与机器人统一100分开局');
  const states = await Promise.all([request(0, '/games/' + sessionId), request(1, '/games/' + sessionId)]);
  for (let i = 0; i < 2; i++) assert.deepEqual(states[i].players.filter((p) => p.isSelf).map((p) => p.id), [String(users[i].id)]);
  await request(null, '/games/' + sessionId, 'GET', undefined, 401);
  await request(2, '/games/' + sessionId, 'GET', undefined, 404);
  await request(0, '/games/' + sessionId + '/result', 'GET', undefined, 409);

  await db.pool.query(`CREATE TRIGGER test_force_close_failure BEFORE UPDATE ON game_sessions FOR EACH ROW
    BEGIN IF NEW.id = ${Number(sessionId)} AND NEW.status = 'finished' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected_close_failure'; END IF; END`);
  try {
    await adminRequest('rooms/' + roomId + '/close', 'PUT', {}, 500);
    assert.equal((await adminGet('rooms/' + roomId)).status, 'playing');
    assert.equal((await request(0, '/games/' + sessionId)).status, 'playing');
  } finally {
    await db.pool.query('DROP TRIGGER test_force_close_failure');
  }

  const {date} = await db.queryOne("SELECT DATE_FORMAT(started_at, '%Y-%m-%d') AS date FROM game_sessions WHERE id = ?", [sessionId]);
  await db.execute("INSERT INTO coin_records (user_id, amount, balance_after, type, title, created_at) VALUES (?, 40, 40, 'admin_adjust', 'test', ?), (?, 300, 340, 'admin_adjust', 'test', ?)",
    [users[2].id, date, users[2].id, date]);
  for (const range of ['?limit=7', '', `?from=${date}&to=${date}`]) {
    const overview = await adminGet('stats/overview' + range);
    assert.deepEqual(overview.games.find((entry) => entry.date === date), {date, count: 1});
    assert.deepEqual(overview.revenue.find((entry) => entry.date === date), {date, amount: 340});
  }

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
  backend.app.locals.draining = true;
  await request(null, '/ready', 'GET', undefined, 503);
  await request(2, '/rooms', 'POST', {stageId: 1}, 503);
  await request(2, '/rooms/' + roomId + '/start', 'POST', {}, 503);
  await request(0, '/games/' + sessionId);
  const initialX = game.runWorld.runners.find((r) => r.id === String(users[0].id)).x;
  for (let i = 0; i < 13; i++) {
    await request(0, '/games/' + sessionId + '/move', 'POST', {dx: 1, dy: 0});
    await request(1, '/games/' + sessionId + '/move', 'POST', {dx: -1, dy: 0});
    await gameService.tick(game, backend.app.get('arenaRealtime'), 100);
  }
  backend.app.locals.draining = false;
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
  const {passport} = await request(0, `/retention?sessionId=${sessionId}`);
  assert.equal(passport.stampedCount, 1);
  assert.equal(passport.newStamp.id, game.stageId);
  assert.equal(passport.nextStage.stamped, false);
  assert.equal(passport.badge, false);
  const unrelatedPassport = (await request(2, `/retention?sessionId=${sessionId}`)).passport;
  assert.equal(unrelatedPassport.stampedCount, 0);
  assert.equal(unrelatedPassport.newStamp, null);
  await gameService.finishGame(game, backend.app.get('arenaRealtime'));
  assert.equal((await db.queryOne('SELECT game_count FROM users WHERE id = ?', [users[0].id])).game_count, 1);
  assert.equal((await db.queryOne('SELECT status FROM rooms WHERE id = ?', [roomId])).status, 'finished');
  // Force the persisted result branch, equivalent to reading after cache eviction.
  gameService.getActiveGames().delete(sessionId);
  for (let i = 0; i < 2; i++) {
    const stored = await request(i, '/games/' + sessionId + '/result');
    assert.equal(stored.coins, results[i].coins);
    assert.equal(stored.ranking.find((p) => p.isSelf).id, String(users[i].id));
    assert.equal(stored.roomId, roomId);
  }
  // 两位玩家同时续玩，重试不能清空对方准备；历史场次不得重置新对局。
  await request(2, '/games/' + sessionId + '/rematch', 'POST', {}, 404);
  const rematches = await Promise.all([0, 1].map((index) => request(index, '/games/' + sessionId + '/rematch', 'POST', {})));
  assert.ok(rematches.every((value) => value.room.id === roomId && value.room.room_code === created.room.room_code));
  let reused = await request(0, '/rooms/' + roomId);
  assert.equal(reused.room.status, 'waiting'); assert.equal(reused.sessionId, null);
  assert.equal(reused.players.length, 2); assert.ok(reused.players.every((player) => player.is_ready));
  await request(0, '/games/' + sessionId + '/rematch', 'POST', {});
  reused = await request(0, '/rooms/' + roomId);
  assert.ok(reused.players.every((player) => player.is_ready));
  const restarted = await request(0, '/rooms/' + roomId + '/start', 'POST', {});
  assert.notEqual(restarted.sessionId, sessionId);
  gameService.stopAllTimers();
  await request(0, '/games/' + sessionId + '/rematch', 'POST', {}, 409);
  assert.equal((await request(1, '/games/' + restarted.sessionId)).awaitingStart, true);
  await request(0, '/games/' + restarted.sessionId + '/cancel-start', 'POST', {});
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
  // Public matching is separate from private invitations and serializes duplicate joins.
  const matchUsers = await Promise.all(['m1', 'm2', 'm3', 'm4'].map((name) => auth.findOrCreateUser('integration-' + name, 100)));
  users.push(...matchUsers); tokens.push(...matchUsers.map((user) => auth.generateToken(user)));
  const autoCreatedRoom = await request(5, '/matchmaking', 'POST', {stageId: 1, createFriendRoomIfEmpty: true});
  assert.equal(autoCreatedRoom.autoCreatedFriendRoom, true);
  assert.equal(autoCreatedRoom.room.match_due_at, null);
  const invited = await request(6, '/rooms/' + autoCreatedRoom.room.id + '/join', 'POST', {});
  assert.equal(invited.players.length, 2);
  await request(6, '/rooms/' + autoCreatedRoom.room.id + '/leave', 'POST', {});
  await request(5, '/rooms/' + autoCreatedRoom.room.id + '/leave', 'POST', {});
  const matched = await Promise.all([request(3, '/matchmaking', 'POST', {stageId: 1}), request(4, '/matchmaking', 'POST', {stageId: 1})]);
  assert.equal(matched[0].room.id, matched[1].room.id);
  const duplicate = await request(3, '/matchmaking', 'POST', {stageId: 1});
  assert.equal(duplicate.players.length, 2);
  const retriedMatches = await Promise.all(Array.from({length: 12}, () => request(3, '/matchmaking', 'POST', {stageId: 1})));
  assert.ok(retriedMatches.every((entry) => entry.room.id === duplicate.room.id && entry.players.length === 2));
  const privateRoom = await request(5, '/rooms', 'POST', {stageId: 1});
  await request(5, '/matchmaking', 'POST', {stageId: 1}, 409);
  await request(5, '/rooms/' + privateRoom.room.id + '/leave', 'POST', {});
  await request(5, '/matchmaking', 'POST', {stageId: 1});
  await request(6, '/matchmaking', 'POST', {stageId: 1});
  const matchmaking = require('../src/services/matchmaking-service');
  await matchmaking.advanceDue(backend.app.get('arenaRealtime'));
  let matchRoom = await request(3, '/rooms/' + duplicate.room.id);
  assert.ok(matchRoom.sessionId);
  let matchGame = gameService.getActiveGame(matchRoom.sessionId);
  assert.equal(gameService.buildResultPayload(matchGame).matchmaking, true);
  assert.equal(matchGame.players.length, 4); assert.equal(matchGame.players.filter((player) => player.isRobot).length, 0);
  await gameService.cancelPendingStart(matchGame.sessionId, backend.app.get('arenaRealtime'));
  assert.equal((await request(3, '/rooms/' + duplicate.room.id)).room.status, 'finished');
  assert.equal((await request(3, '/games/' + matchGame.sessionId + '/result')).matchmaking, true);
  const interrupted = await adminGet('games/' + matchGame.sessionId);
  assert.equal(interrupted.session.mode, 'quick');
  assert.equal(interrupted.settlement.status, 'interrupted');
  assert.equal(interrupted.settlement.botCount, null);
  assert.equal(interrupted.settlement.totalCoins, 0);
  assert.ok(interrupted.players.every((player) => player.rank === null));
  const interruptedPassport = (await request(3, `/retention?sessionId=${matchGame.sessionId}`)).passport;
  assert.equal(interruptedPassport.newStamp, null);
  assert.equal(interruptedPassport.stampedCount, 0);
  const solo = await request(3, '/matchmaking', 'POST', {stageId: 2});
  await request(3, '/rooms/' + solo.room.id + '/start', 'POST', {}, 409);
  await db.execute('UPDATE rooms SET match_due_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [solo.room.id]);
  await matchmaking.advanceDue(backend.app.get('arenaRealtime'));
  matchRoom = await request(3, '/rooms/' + solo.room.id); matchGame = gameService.getActiveGame(matchRoom.sessionId);
  assert.equal(matchGame.players.filter((player) => player.isRobot).length, 3); assert.equal(matchGame.duration, 120);
  const live = await adminGet('games/' + matchGame.sessionId);
  assert.equal(live.session.mode, 'quick');
  assert.equal(live.settlement.status, 'awaiting_start');
  assert.equal(live.settlement.humanCount, 1);
  assert.equal(live.settlement.botCount, 3);
  assert.equal(live.settlement.totalCoins, null);
  const friend = await adminGet('games/' + sessionId);
  assert.equal(friend.session.mode, 'friends');
  assert.equal(friend.settlement.status, 'settled');
  assert.equal(friend.players.filter((player) => player.isBot).length, 2);
  assert.deepEqual(friend.players.map((player) => player.rank), [1, 2, 3, 4]);
  assert.ok(friend.players.filter((player) => player.isBot).every((player) => player.uid === null && player.coinsEarned === null));
  assert.equal(friend.settlement.totalCoins, results.reduce((sum, result) => sum + result.coins, 0));
  const quickRooms = await adminGet('rooms?mode=quick&status=playing');
  assert.equal(quickRooms.total, 1);
  assert.deepEqual(quickRooms.records.map((room) => room.id), [solo.room.id]);
  assert.equal((await adminGet('rooms/' + solo.room.id)).latestSessionId, matchGame.sessionId);
  const quickGames = await adminGet('games?mode=quick&limit=1');
  assert.equal(quickGames.total, 2);
  assert.deepEqual(quickGames.records.map((session) => session.sessionId), [matchGame.sessionId]);
  await adminGet('games/' + matchGame.sessionId, false);
  await gameService.cancelPendingStart(matchGame.sessionId, backend.app.get('arenaRealtime'));
  const originalQuickId = matchGame.sessionId;
  await request(3, '/games/' + originalQuickId + '/rematch', 'POST', {});
  const quickRoomRematch = await request(3, '/rooms/' + solo.room.id + '/start', 'POST', {});
  assert.equal((await adminGet('rooms/' + solo.room.id)).mode, 'quick');
  assert.equal((await adminGet('games/' + quickRoomRematch.sessionId)).session.mode, 'friends');
  assert.equal((await adminGet('games/' + originalQuickId)).session.mode, 'quick');
  await gameService.cancelPendingStart(quickRoomRematch.sessionId, backend.app.get('arenaRealtime'));
  await request(3, '/rooms/' + solo.room.id + '/leave', 'POST', {});
  const cancelMatch = await request(3, '/matchmaking', 'POST', {stageId: 1});
  await request(3, '/rooms/' + cancelMatch.room.id + '/leave', 'POST', {});
  await matchmaking.advanceDue(backend.app.get('arenaRealtime'));
  assert.equal(Number((await db.queryOne("SELECT COUNT(*) AS count FROM game_sessions WHERE room_id = ?", [cancelMatch.room.id])).count), 0);

  // Concurrent reward requests share the account row lock and one durable receipt.
  const checkinBefore = Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[6].id])).coins);
  const checkins = await Promise.all(Array.from({length: 5}, () => request(6, '/retention/checkin', 'POST', {reward: 999999})));
  assert.equal(checkins.filter((entry) => !entry.alreadyClaimed).length, 1);
  assert.equal(Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[6].id])).coins), checkinBefore + 20);
  const enrichedTasks = await request(6, '/tasks?includeRetention=1');
  assert.equal(enrichedTasks.retention.checkin.claimed, true); assert.equal(enrichedTasks.retention.milestones.length, 4);
  const yesterday = require('../src/services/daily-task-service').taskDate(new Date(Date.now() - 86400000));
  await db.execute('INSERT INTO daily_checkins (user_id, checkin_date, streak, reward) VALUES (?, ?, ?, ?)', [users[5].id, yesterday, 6, 45]);
  assert.equal((await request(5, '/retention/checkin', 'POST', {})).reward, 60);
  await request(3, '/retention/milestones/first_game/claim', 'POST', {progress: 1, reward: 999999}, 409);
  await db.execute('UPDATE users SET game_count = 1 WHERE id = ?', [users[3].id]);
  const growthBefore = Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[3].id])).coins);
  const growth = await Promise.all(Array.from({length: 5}, () => request(3, '/retention/milestones/first_game/claim', 'POST', {})));
  assert.equal(growth.filter((entry) => !entry.alreadyClaimed).length, 1);
  assert.equal(Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[3].id])).coins), growthBefore + 50);
  // Inject a real MySQL ledger failure after the receipt and wallet update.
  await db.execute('UPDATE users SET game_count = 10 WHERE id = ?', [users[3].id]);
  await db.pool.query(`CREATE TRIGGER test_retention_ledger BEFORE INSERT ON coin_records FOR EACH ROW BEGIN IF NEW.type = 'growth_reward' AND NEW.user_id = ${Number(users[3].id)} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected_retention_failure'; END IF; END`);
  try {await request(3, '/retention/milestones/ten_games/claim', 'POST', {}, 500);}
  finally {await db.pool.query('DROP TRIGGER test_retention_ledger');}
  assert.equal(Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[3].id])).coins), growthBefore + 50);
  assert.equal(Number((await db.queryOne('SELECT COUNT(*) AS count FROM growth_claims WHERE user_id = ? AND milestone_id = ?', [users[3].id, 'ten_games'])).count), 0);
  await request(3, '/retention/milestones/ten_games/claim', 'POST', {});
  assert.equal(Number((await db.queryOne('SELECT coins FROM users WHERE id = ?', [users[3].id])).coins), growthBefore + 200);

  // Event ingestion/deduplication and real MySQL CTEs (unit SQL mocks cannot verify these).
  const eventsBody = {client: 'miniprogram', deviceId: 'integration_device', events:
    ['app_launch', 'privacy_accept', 'login_success', 'game_start', 'game_finish', 'replay_click']
      .map((name, index) => ({name, ts: Date.now() + index, props: {sessionId: String(sessionId)}}))};
  assert.equal((await request(0, '/events', 'POST', eventsBody)).accepted, 6);
  await request(0, '/events', 'POST', eventsBody);
  assert.equal(Number((await db.queryOne('SELECT COUNT(*) AS count FROM analytics_events WHERE device_id = ?', [eventsBody.deviceId])).count), 6);
  await request(null, '/events', 'POST', {...eventsBody, deviceId: 'anonymous_device'});
  const analyticsService = require('../src/services/analytics-service');
  let analytics = await analyticsService.getOverview();
  assert.equal(analytics.funnel.find((step) => step.name === 'replay_click').devices, 2);
  assert.equal(Number(analytics.completion.finishes), 2); assert.equal(Number(analytics.completion.starts), 2);
  assert.equal(Number(analytics.daily.at(-1).accounts), 1);
  const flowEvents = [
    ['match_request', 'quick_1', {}], ['match_queue', 'quick_1', {}], ['match_background', 'quick_1', {}],
    ['match_started', 'quick_1', {sessionId: 'next_1', waitMs: 8000, humanCount: 2, botCount: 2}],
    ['match_started', 'quick_1', {sessionId: 'next_1', waitMs: 8000, humanCount: 2, botCount: 2}],
    ['match_request', 'quick_2', {}], ['match_queue', 'quick_2', {}], ['match_cancel', 'quick_2', {reason: 'user_cancel', waitMs: 4000}],
    ['match_request', 'quick_3', {}], ['match_failed', 'quick_3', {reason: 'network_error'}],
    ['replay_click', 'replay_1', {sourceSessionId: 'old'}], ['replay_started', 'replay_1', {sourceSessionId: 'old', sessionId: 'next'}],
    ['replay_started', 'orphan', {sourceSessionId: 'old', sessionId: 'next'}],
    ['boot_ready', 'startup_1', {durationMs: 3000}],
  ].map(([name, attemptId, props], index) => ({name, ts: Date.now() + index, props: {attemptId, ...props}}));
  const flowBody = {client: 'miniprogram', deviceId: 'flow_device', events: flowEvents};
  await request(null, '/events', 'POST', flowBody); await request(null, '/events', 'POST', flowBody);
  await request(null, '/events', 'POST', {client: 'minigame', deviceId: 'flow_device', events: [
    {name: 'match_request', ts: Date.now(), props: {attemptId: 'quick_1'}},
    {name: 'match_started', ts: Date.now() + 1, props: {attemptId: 'quick_1', sessionId: 'other_next', waitMs: 100, humanCount: 4, botCount: 0}},
    {name: 'replay_click', ts: Date.now() + 2, props: {attemptId: 'replay_1', sourceSessionId: 'old'}},
  ]});
  analytics = await analyticsService.getOverview();
  const nativeMatch = analytics.matchmaking.find(row => row.client === 'miniprogram');
  assert.equal(Number(nativeMatch.requests), 3); assert.equal(Number(nativeMatch.started), 1);
  assert.equal(Number(nativeMatch.cancelled), 1); assert.equal(Number(nativeMatch.failed), 1);
  assert.equal(Number(nativeMatch.background), 1); assert.equal(Number(nativeMatch.averageWaitMs), 8000);
  assert.equal(Number(nativeMatch.botPlayers), 2); assert.equal(Number(nativeMatch.totalPlayers), 4);
  assert.equal(Number(analytics.matchmaking.find(row => row.client === 'minigame').allHumanStarts), 1);
  assert.equal(Number(analytics.replay.attempts), 2); assert.equal(Number(analytics.replay.started), 1);
  assert.equal(Number(analytics.startup[0].averageMs), 3000);
  assert.equal(Number(analytics.matchExits.find(row => row.reason === 'user_cancel').attempts), 1);
  for (const age of [8, 7, 5, 1]) {
    await db.execute("INSERT INTO analytics_events (event_key, device_id, client, name, client_ts, received_at) VALUES (?, ?, 'miniprogram', 'app_launch', ?, DATE_SUB(NOW(), INTERVAL ? DAY))",
      ['cohort-' + age, 'retention_device', Date.now(), age]);
  }
  analytics = await analyticsService.getOverview();
  const cohort = analytics.retention.find((day) => Number(day.devices) === 1 && Number(day.day7) === 1);
  assert.ok(cohort); assert.equal(Number(cohort.day1), 1); assert.equal(Number(cohort.day3), 1);
  await db.execute("INSERT INTO analytics_events (event_key, device_id, client, name, client_ts, received_at) VALUES ('expired-event', 'expired_device', 'miniprogram', 'app_launch', 1, DATE_SUB(NOW(), INTERVAL 91 DAY))");
  assert.equal(await analyticsService.cleanupExpired(), 1);

  const oldRoom = await request(2, '/rooms', 'POST', {stageId: 1});
  await db.execute('UPDATE rooms SET last_active_at = DATE_SUB(NOW(), INTERVAL 31 MINUTE) WHERE id = ?', [oldRoom.room.id]);
  assert.equal(await require('../src/services/room-service').cleanupStaleRooms(), 1);
  assert.equal((await db.queryOne('SELECT status FROM rooms WHERE id = ?', [oldRoom.room.id])).status, 'finished');
  await request(2, '/events', 'POST', {...eventsBody, deviceId: 'deleting_device'});
  await request(2, '/retention/checkin', 'POST', {});
  await db.execute('UPDATE users SET game_count = 1 WHERE id = ?', [users[2].id]);
  await request(2, '/retention/milestones/first_game/claim', 'POST', {});
  await request(2, '/user/account', 'DELETE');
  for (const table of ['daily_checkins', 'growth_claims']) assert.equal(Number((await db.queryOne(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`, [users[2].id])).count), 0);
  assert.equal(Number((await db.queryOne('SELECT COUNT(*) AS count FROM analytics_events WHERE user_id = ?', [users[2].id])).count), 0);

  const sourceResult = await request(0, `/games/${sessionId}/result`);
  assert.ok(sourceResult.challengeCode);
  const challengePath = `/matchmaking/challenge/${sourceResult.challengeCode}`;
  assert.equal((await request(3, challengePath)).stageId, game.stageId);
  await request(0, challengePath, 'GET', undefined, 409);
  await request(3, `${challengePath}x`, 'GET', undefined, 404);
  const challengeRoom = await request(3, '/matchmaking', 'POST', {
    challengeCode: sourceResult.challengeCode,
    stageId: game.stageId === 1 ? 2 : 1,
    createFriendRoomIfEmpty: true,
  });
  assert.equal(challengeRoom.room.stage_id, game.stageId);
  assert.ok(challengeRoom.room.match_due_at);
  await db.execute('UPDATE rooms SET match_due_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [challengeRoom.room.id]);
  await matchmaking.advanceDue(backend.app.get('arenaRealtime'));
  const {sessionId: challengeSessionId} = await request(3, `/rooms/${challengeRoom.room.id}`);
  const challengeGame = gameService.getActiveGame(challengeSessionId);
  await gameService.finishGame(challengeGame, backend.app.get('arenaRealtime'));
  const settledChallenge = await request(3, `/games/${challengeSessionId}/result`);
  assert.deepEqual(settledChallenge.challengeComparison, {
    selfScore: Number(settledChallenge.ranking.find((player) => player.isSelf).score),
    friendScore: Number(sourceResult.ranking.find((player) => player.isSelf).score),
  });
  gameService.getActiveGames().delete(challengeSessionId);
  const storedChallenge = await request(3, `/games/${challengeSessionId}/result`);
  assert.deepEqual(storedChallenge.challengeComparison, settledChallenge.challengeComparison);
  // Existing databases baseline only after all SQL was independently applied above.
  const migrator = require('./migrate');
  await migrator.migrate(['--baseline', migrations.at(-1)]);
  await migrator.migrate(['--dry-run']);
  await migrator.migrate([]);

  await request(2, '/user/profile', 'GET', undefined, 401);
  for (let i = 0; i < 20; i++) await request(null, '/auth/login', 'POST', {}, 400);
  await request(null, '/auth/refresh', 'POST', {}, 429);
  console.log('[integration] PASS: SQL migrations, equal-score start, two-account HTTP/WS, movement/team/collision, settlement/ledger idempotency, concurrent same-room rematch and stale-session rejection, purchase/equip, leaderboard, telemetry/deduplication/retention CTEs, expiry, account deletion, migration baseline/dry-run, drain readiness/write gates and auth rate limit, concurrent matching/private isolation/robot fallback/cancellation, checkin/growth exactly-once rewards and real ledger failure rollback, release schema/index checks');
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

