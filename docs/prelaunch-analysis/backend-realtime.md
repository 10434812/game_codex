# 锦鲤前程 · 后端与实时对战系统 上线前分析

> 分析对象：`back/`（Express + MySQL + Socket.IO + 原生 ws + 微信支付 + 管理后台）与小程序端 `utils/api-client.js`、`utils/arena-realtime.js`、`pages/arena/index.js` 实时通道配合。
> 分析方法：逐文件精读代码 + 运行时实验（ws/socket.io 共存验证、mysql2 NaN 转义验证、前后端常量/引擎/商城逐项 diff、测试套件回归：后端 31/31、前端 178/178 全过）。
> 结论口径：🔴 高危（建议上线前必修）· 🟠 中危（强烈建议修）· 🟡 低危/改进项。

## 结论速览（TOP 10）

| # | 问题 | 等级 |
|---|---|---|
| 1 | 房间 <4 真人时机器人补位，机器人 id（`robot-3-12345`）被 `Number()` 后以 NaN 写入 `game_players.user_id`，`startGameSession` 抛错被吞，对局永不开始 | 🔴 |
| 2 | `back/.env` 被 git 跟踪且工作区已写入真实微信 AppSecret，随时可能被提交泄漏 | 🔴 |
| 3 | 生产环境 JWT_SECRET 允许 `change-this-to-random-secret-in-production` 占位值（只检查存在性），用户与管理员共用同一密钥，可伪造任意身份 | 🔴 |
| 4 | 管理后台登录无限流 + 「空表时用 .env 内 admin/admin123 引导建号」逻辑，用仓库内默认凭据可接管后台 | 🔴 |
| 5 | 对局内存态（activeGames）无持久化/恢复：进程重启后所有进行中对局永久卡死，房间 stuck 在 playing，客户端无限轮询 | 🔴 |
| 6 | finishGame 无事务、无幂等守卫，慢 DB 下重叠 tick 可重复结算发币（金币/经验/胜场翻倍） | 🔴 |
| 7 | 任意登录用户可枚举 sessionId 旁观/拉取任意对局完整状态与结果（ws join 与 HTTP GET /games/:id 均无成员校验） | 🟠 |
| 8 | 封禁（is_banned）在登录/鉴权/所有业务路径零校验，封禁功能形同虚设；admin 角色（super/normal）亦无任何权限区分 | 🟠 |
| 9 | 无任何限流：登录爆破、房间/订单刷量、头像上传刷盘；shop buyItem 扣款 UPDATE 不检查 affectedRows，竞态下可白嫖商品 | 🟠 |
| 10 | 无 graceful shutdown、无迁移运行器、docker-compose 把 MySQL 3306 暴露公网且默认弱口令；Socket.IO 与原生 ws 双通道并存（前者是客户端不用的死代码攻击面） | 🟠 |

---

# 1. 联网对局正确性

## 1.1 🔴 机器人补位导致 <4 人房间永远开不了局（NaN 写入数据库）

**位置**：`back/src/game-engine/game-engine.js:106-124`、`back/src/services/game-service.js:235-259`、`back/src/routes/rooms.js:151-166`

**证据**：
- 机器人 id 为字符串：`id: overrides.id || 'robot-${seat}-${Math.floor(random() * 100000)}'`（game-engine.js:111）。
- `startGameSession` 第 7 步把引擎玩家写回 `game_players` 时**没有跳过机器人**：

```js
for (const p of paired.players) {
    if (!existingUserIds.has(Number(p.id))) {
      await db.execute(
        'INSERT INTO game_players (session_id, user_id, seat, team_id, initial_score, final_score) VALUES (?, ?, ?, ?, ?, ?)',
        [sessionId, Number(p.id), p.seat, p.teamId, p.score, p.score]   // robot → Number() = NaN
      );
```

- 房间 <4 真人时 `buildOnlinePlayers → engine.ensureMinimumPlayers`（game-engine.js:174-188）会补机器人至 4 人（`MIN_PLAYERS=4`）；奇数再补 1 个（`ensureEvenPlayers`）。
- 实测 `mysql2.escape(NaN) === 'NaN'`（字面量裸写）；MySQL 8 默认 STRICT_TRANS_TABLES 下 `INSERT ... user_id = NaN`（INT UNSIGNED）直接报错；即使非严格模式，多个机器人 `user_id=0` 会撞 `uk_session_user (session_id, user_id)` 唯一键，同样抛错。
- 抛错位置发生在 `activeGames.set(sessionId, gameState)`（game-service.js:279）**之前**，且调用方是 fire-and-forget：

```js
// rooms.js:160-166
const arenaRealtime = req.app.get('arenaRealtime');
if (arenaRealtime && result && result.sessionId) {
  gameService.startGameSession(result.roomId, req.user.userId, arenaRealtime).catch(err => {
    console.error('[rooms] startTickLoop error:', err);   // 吞掉错误，HTTP 已返回"游戏开始"
  });
}
```

**后果**：主机开 1-3 人局（后端 `room-service.js:384` 只校验 `current_players < 1`，前端开始按钮对人数无任何限制）→ 接口返回成功、房间变 playing → 内存中无对局、无 tick → 客户端 ws 收到空状态、HTTP 轮询只拿到 `{sessionId, status:'playing'}`（games.js:15）→ 页面永久卡死，房间永远无法结束（只有管理员强制关闭）。

**修复**：插入循环跳过 `p.isRobot`（机器人本就是内存态）；`rooms.js` 改为 `await gameService.startGameSession(...)` 并回传错误；补一个覆盖「<4 真人开局」的集成测试。

## 1.2 🔴 finishGame 无事务 + 无幂等守卫，可重复结算/部分结算

**位置**：`back/src/services/game-service.js:391-453`

**证据**：
- `finishGame` 开头只清 timer，**不检查 `game.status === 'finished'`**；逐玩家循环执行 `UPDATE game_players` 和 `UPDATE users SET coins = coins + ?, game_count = game_count + 1, ...`（405-428），再 `INSERT INTO game_results`（431-434），全程无 `beginTransaction`。
- tick 定时器不等待上一次异步 tick 完成（300-307 行 `setInterval(async () => { await tick(...) })` 每次 1s 必触发）。当某次 tick 因 DB 变慢耗时 >1s 时，下一个 tick 与 `finishGame` 并发执行：第二次 tick 把 `timeLeft` 减到 -1 后再次进入 `finishGame` → **金币/收益/胜场重复入账**；`INSERT INTO game_results` 则撞 `uk_session_id` 唯一键报错（被 tick 的 catch 吞掉，日志轰炸）。
- 中途进程被杀 → 部分玩家已发奖、部分没有，`game_sessions` 可能还没置 finished。

**修复**：`finishGame` 首行加 `if (game.status === 'finished') return;` 并立即置 finished（内存锁）；整个结算包进一个事务（`SELECT ... FOR UPDATE` 对局行）；tick 循环改为串行（`await` 完成后再 setTimeout 下一次）；`game_results` 用 `INSERT ... ON DUPLICATE KEY` 或捕获 ER_DUP_ENTRY。

## 1.3 🔴 进程重启/崩溃后活跃对局永久卡死（无恢复机制）

**位置**：`back/src/services/game-service.js:13-14`（`const activeGames = new Map()`）、`back/src/routes/games.js:8-19`

**证据**：对局状态只存内存；没有任何启动时的对账逻辑处理 `game_sessions.status='playing'` 的遗留记录。重启后：
- `getGameState()` 返回 null → `GET /api/games/:id` 退化为 `success({sessionId, status:'playing'})`（games.js:15）——不带 players/teams；
- 客户端 `pages/arena/index.js` 的轮询/ws 收到后既不渲染也不结束（`syncArena` 要求 `state.players` 存在），页面卡死；
- `rooms.status='playing'` 永远不变，房间列表里永远没有该房（listAvailableRooms 只查 waiting），也没有任何定时任务收尾。

**修复**：启动时跑一次性对账任务：把「无活跃内存态且 started_at 超过 180s」的 playing 对局按 robots 补位重放或直接标记 finished 并写入结果；或引入 Redis 保存会话态；至少加一个「孤儿 playing 房间/对局」巡检任务并告警。

## 1.4 🟠 双通道并存（Socket.IO + 原生 ws），Socket.IO 是客户端不用的死代码攻击面

**位置**：`back/src/app.js:50-68`、`back/src/socket/arena-handler.js`、`back/src/socket/arena-realtime.js`、`pages/arena/index.js:258-299`

**证据**：
- 小程序端只使用 `wx.connectSocket('wss://.../ws/arena?sessionId=...&token=...')`（pages/arena/index.js:264-267）；全仓 grep 无任何 socket.io 客户端、`socketTask.send` 也从未被调用（客户端 ws 是纯只读）。
- 服务端 `emitToSession` 同时向两套通道广播（app.js:60-63），当前 Socket.IO 房间永远没人 → 纯空转。
- Socket.IO 侧的 `join_arena`（arena-handler.js:26-37）**无任何成员校验**：任何持有效 JWT 的客户端可 join 任意 `arena:{sessionId}` 房间，接收每 1s/3s 的 `time_update`/`game_tick`（含全部玩家分数与队伍）。`fortune_buy`（56-62 行）把客户端传入的 `opportunity` 原样广播，无状态/金额/成员校验（当前客户端不用，属闲置攻击面）。
- 前端 `utils/arena-realtime.js`（107 行）与页面内联实现重复且**无任何文件引用它**——两处实现已漂移（utils 版处理 `game_tick/time_update/emote_broadcast`，页面版只处理 `game_state/game_finished`）。

**修复**：二选一通道，删除闲置的一套；若保留 Socket.IO 供后续 web 端，给 `join_arena`/`fortune_buy` 加成员校验与输入白名单；删除 `utils/arena-realtime.js` 或改造成唯一实现。

## 1.5 🟡 双通道共存的时序脆弱性（依赖 engine.io destroyUpgrade 的 1s 窗口）

**位置**：`back/src/app.js:50-58`、engine.io `build/server.js:640-682`

**证据**：engine.io（Socket.IO 先注册 upgrade 监听）对非 `/socket.io` 路径的 upgrade 请求会 `setTimeout(1000)` 后 `socket.end()`（除非已写出字节）；原生 ws 的握手响应恰好在该窗口内写出。我已本地实测：原生 ws 连接成功、1.6s 后仍 OPEN——**当前能工作纯属时序巧合**。若升级 engine.io 版本（destroyUpgrade 默认行为变化）或调整监听注册顺序，`/ws/arena` 会静默断连。

**修复**：`new SocketIOServer(server, { destroyUpgrade: false })` 显式声明互不干扰，或原生 ws 换独立端口/路径由反代分流。

## 1.6 🟠 任意登录用户可旁听任意对局（越权旁观 + 隐藏分数机制被绕过）

**位置**：`back/src/socket/arena-realtime.js:71-84`、`back/src/socket/arena-handler.js:26-37`、`back/src/routes/games.js:8-53`

**证据**：
- 原生 ws 连接成功后无条件推送 `gameService.getGameState(sessionId, userId)`（arena-realtime.js:81-84）；`getGameState`（game-service.js:460-478）**不校验请求者是否在该对局**，返回全部玩家的实时分数、队伍、状态。
- HTTP `GET /api/games/:id` 与 `GET /api/games/:id/result` 同样只有 auth、无成员校验（games.js:8、23）；`POST /api/games/:id/emotes`（games.js:55-85）也只查「对局在玩」，任何人可向任意对局刷表情。
- `sessionId` 是自增整数，可枚举；对局结束广播的 `game_finished`（含全员排名与收益）同样无成员门槛。
- 前端「分数分阶段可见」（visibleIds 机制）完全靠客户端自觉——服务端全量下发，抓包即可看到全部分数。

**修复**：所有对局相关接口（ws 连接、getGameState、result、emotes）先校验 `game_players.session_id + user_id` 成员关系；对局进行中下发的对手分数按 reveal 阶段裁剪（服务端执行 `buildVisibleScoreState`）。

## 1.7 🟡 在线对局画面几乎静止：客户端不消费 game_tick/time_update/emote_broadcast

**位置**：`pages/arena/index.js:301-322`、`back/src/services/game-service.js:356-378`

**证据**：`handleArenaRealtimeMessage` 只处理 `game_state` 与 `game_finished`；服务器每 1s 广播 `time_update`、每 3s 广播 `game_tick`（含回合事件与最新分数），客户端全部丢弃。在线模式下本地点子（`scheduleRemoteEmote` 等）也显式跳过（598-602 `if (!this.localMode) return;`）。结果：进入对局后画面与分数冻结在初始快照，180s 后直接跳结算；每个 session 白推约 240 条消息。

**修复**：客户端消费 `game_tick` 驱动回合动画/分数变化与倒计时；服务端按需降频（如只推 `game_tick`，去掉每 1s 的 `time_update`）。

## 1.8 🟡 房间锁竞态：并发 join 可超员、并发 start 可双开/重置对局

**位置**：`back/src/services/room-service.js:176-229、370-439`、`back/src/services/game-service.js:220-232`

**证据**：
- `joinRoom` 的满员检查（`room.current_players >= room.max_players`，185-187 行）在事务**外**执行，插入时 `UPDATE rooms SET current_players = current_players + 1` 无上限约束 → 并发 join 可超员；`MAX(seat)+1`（202-206）并发下同座位（无 `(room_id, seat)` 唯一键）；同用户并发 join 会撞 `uk_room_user` 唯一键 → 500 且 `fail(err.message)` 把 MySQL 报错原文回给客户端。
- `startGame` 的 `UPDATE rooms SET status = 'playing' WHERE id = ?`（398-401）没有 `AND status='waiting'` 守卫；并发 start（双击/两客户端）各自创建 `game_sessions`（404-408），产生孤儿对局；随后 `startGameSession` 取「最新 playing 对局」（game-service.js:220-224 `ORDER BY id DESC LIMIT 1`）→ 两次调用命中同一 session，第二次调用**重新随机初始化分数并覆盖内存状态**（第 8 步），相当于重复开局。
- 同一用户可在任意多个房间/对局并行存在：中途 `leaveRoom`（246-324）只删 room_players，对局引擎里的该玩家继续得分并在结算时照常领奖；离开后可立即再开新局。

**修复**：房间行 `SELECT ... FOR UPDATE` + 条件 UPDATE 守卫；`game_sessions` 加「room 唯一进行中对局」约束；对局期间禁止重复开局（用户级 in-game 标记）；结算跳过已退房玩家（或保留但记录）。

## 1.9 🟢 值得肯定的点

- tick 时钟完全由服务端驱动（`startTickLoop`，game-service.js:294-307），回合事件由服务端 `engine.playRound` 生成，客户端**无法通过改包影响最终成绩**；发奖金额也以服务端为准。
- 重连恢复路径存在：ws 连接成功即回放 `game_state` 全量快照（arena-realtime.js:80-84），客户端也有 1.2s 超时自动降级到 HTTP 轮询（pages/arena/index.js:269-274、330-341）。
- 机器人不参与发奖（finishGame 里 `if (player.isRobot) continue;`，game-service.js:406-407）。

---

# 2. 鉴权与安全

## 2.1 🔴 `back/.env` 被 git 跟踪，工作区已写入真实微信 AppSecret

**位置**：`back/.env`（git 跟踪）、根 `.gitignore`

**证据**：
- `git ls-files | grep -E '\.env'` → `back/.env` 与 `back/.env.example` 均被跟踪。
- 工作区未提交改动（`git diff back/.env`）已把真实密钥写入：
  `WX_APPID=wxd7f500f3f21f15dd`、`WX_SECRET=ae021a2cd4bd79317a71bce959ce7cb9`（git 历史中尚不存在，但任何一次 `git add back/.env && git commit` 即永久入库）。
- 根 `.gitignore` 只忽略 `.env.local`，不忽略 `.env`；仓库初始 commit 就提交了 `.env` 模板（含 `ADMIN_PASSWORD=admin123`）。
- 该 secret 同时是登录兜底配置源：`admin-config-service.js:271-272` `secret: String(secretValue || config.wx.secret || '')`——DB 未配置时直接生效。

**修复**：立即 `git rm --cached back/.env` 并把 `back/.env` 写入 `.gitignore`；到微信公众平台**重置 AppSecret**（按已泄漏处理）；生产环境密钥只经部署系统注入（环境变量/密钥管理），`.env.example` 只留占位。

## 2.2 🔴 JWT_SECRET 生产只查「存在」，占位值可通过校验；用户/管理员共用一钥

**位置**：`back/src/config/index.js:52-55`、`back/src/middleware/admin-auth.js:20-26`、`back/.env`

**证据**：

```js
jwt: {
  secret: requireProductionEnv('JWT_SECRET', 'dev-jwt-secret'),   // 只检查非空
  ...
}
function requireProductionEnv(name, fallback = '') {
  const value = process.env[name];
  if (value) return value;
  if (nodeEnv === 'production') throw new Error(...);
```

- 仓库自带 `.env` 写死 `JWT_SECRET=change-this-to-random-secret-in-production`。照此部署 → 生产环境用全天下皆知的密钥签名 → 任何人可自签 `{userId, openid}` 用户 token；而 admin token 的区分仅是 payload 里多了 `adminId` 字段（admin-auth.js:23-25 用**同一个 secret** 验证）→ 一并伪造管理员。
- 测试 `tests/security-config.test.js` 只断言源码不含该字符串，防不住「.env 带入生产」这条路径。

**修复**：生产校验改为「拒绝空值 + 拒绝已知弱值（change-this-to-random-secret-in-production、dev-jwt-secret）+ 最小长度/随机性」；admin 使用独立 `ADMIN_JWT_SECRET` 并加 `aud`/`typ` 声明区分；部署时强制生成随机密钥。

## 2.3 🔴 管理后台：登录无限流 + 空表引导建号（默认凭据可接管后台）

**位置**：`back/src/routes/admin/auth.js:11-22、25-78`

**证据**：

```js
async function ensureBootstrapAdmin(username, password) {
  const count = await db.queryOne('SELECT COUNT(*) as total FROM admins');
  if ((count?.total || 0) > 0) return;
  if (!config.admin.password) return;
  if (username !== config.admin.username || password !== config.admin.password) return;
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await db.execute('INSERT INTO admins (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)', [username, passwordHash, 'super']);
}
```

- `admins` 表为空时，任何人 POST `/api/admin/auth/login` 提交 `admin/admin123`（仓库 `.env` 里写死的种子凭据）→ 服务端**自动创建 super 管理员并登录成功**。
- 登录接口无验证码、无失败次数限制、无账号锁定（依赖里没有任何限流库）。

**修复**：删除「登录时引导建号」逻辑，改为一次性 CLI 脚本（`node scripts/create-admin`）生成随机密码并打印一次；登录接口加限流（如每 IP 5 次/分钟）+ 失败计数锁定 + 登录审计日志。

## 2.4 🟠 封禁（is_banned）在全部用户路径零校验——封禁形同虚设

**位置**：`back/src/middleware/auth.js`、`back/src/services/auth-service.js:52-72`

**证据**：grep 全仓：`is_banned` 只出现在 users 表定义、注册 INSERT（默认 0）、leaderboard 的 `WHERE is_banned = 0`（stats-service.js:146）三处。`authMiddleware` 只验 JWT 签名；`findOrCreateUser` 登录时不检查封禁状态。被封用户：现有 token（7 天有效）照常建房/开局/领奖；token 过期后重新 `wx.login` 又拿到新 token，无限循环。

**修复**：auth 中间件按 `userId` 查库（带短 TTL 缓存）拦截 `is_banned=1`；`/auth/login` 对封禁用户返回 403。

## 2.5 🟠 无任何接口限流

**位置**：`back/package.json`（无 rate-limit 依赖）、`back/src/app.js:16-45`

**证据**：全链路无限流中间件。高危面：
- `POST /api/admin/auth/login`（爆破，见 2.3）；
- `POST /api/auth/login`（可批量注册刷号）；
- `POST /api/rooms`、`/api/rooms/:id/join`（刷房间/占座，写 DB 行）；
- `POST /api/user/avatar`（multer 2MB/次，磁盘可被刷爆）；
- `POST /api/payments/wechat/jsapi`（无限创建 pending 订单，DB 增长 + 微信 prepay 限额消耗）。

**修复**：引入 `express-rate-limit`（或反代层限流），按 IP 与 userId 双维度，重点覆盖上述端点与支付/登录。

## 2.6 🟠 生产环境错误信息回传客户端（内部细节泄漏）

**位置**：`back/src/middleware/error-handler.js:8-16`、`back/src/routes/rooms.js:26,95,108,126,144,171`

**证据**：全局错误处理把 `err.message` 原样放进响应（`res.status(statusCode).json(fail(message, statusCode))`）；rooms 全部路由 catch 分支 `fail(err.message)` —— DB 报错原文（含重复键值、连接串、SQL 片段）直接暴露给客户端。

**修复**：生产环境统一 `fail('服务开小差了，请稍后重试', 500)`，错误详情只进服务端日志；业务错误用自定义 `statusCode` 的受控文案。

## 2.7 🟡 微信登录流程：session_key 不落地、openid 进 JWT 载荷

**位置**：`back/src/services/auth-service.js:80-86、95-126`

**证据**：
- `wechatCode2Session` 流程完整（https 调 `jscode2session`、errcode 检查），但返回的 `session_key` 用后即弃、不落库——当前无「开放数据解密」需求尚可接受，后续接手机号等能力时必须先补。
- `jwt.sign({ userId: user.id, openid: user.openid }, ...)` —— JWT payload 明文可解，任何拿到 token 的人（设备失窃/日志泄漏）都能看到 openid；服务端并不需要把 openid 放进 token。`findOrCreateUser` 的并发注册由 `uk_openid` 唯一键兜底（duplicate 会抛 500 而非幂等返回）。
- 登录配置双源：DB `wechat.login_secret` 与 env `WX_SECRET`（admin-config-service.js:261-274），两处不一致时行为取决于 DB 是否为空，易误配。

**修复**：token 只放 `userId`；`findOrCreateUser` 捕获 ER_DUP_ENTRY 后重查返回；明确唯一配置源并加配置一致性校验（appid 与 secret 是否配对）。

## 2.8 🟡 ws 鉴权 token 走 URL query（日志泄漏面）

**位置**：`pages/arena/index.js:67-77`、`back/src/socket/arena-realtime.js:12-13`

**证据**：`wss://host/ws/arena?sessionId=N&token=<JWT>`。JWT 在 query 串中 → 任何记录完整请求行的前置代理（nginx `$request`）日志都会落盘 token；浏览器/网关缓存与 Referer 链同样存在泄漏面。`wx.connectSocket` 支持 `header` 字段，可改用。

**修复**：token 改走 `Sec-WebSocket-Protocol` 或自定义 header（服务端 `parseUpgradeRequest` 同步读取）；短期可先用短时效的一次性 ticket 换连接。

## 2.9 🟠 管理后台无角色区分（super/normal 权限相同）

**位置**：`back/src/routes/admin/*.js`（全部只用 `adminAuth`）、`back/src/routes/admin/admins.js:17-55`、`admin/configs.js:27-67`

**证据**：`admins.role ENUM('super','normal')` 已建模但全仓无任何 role 校验。任何 normal 管理员可以：增删改管理员（含重置他人密码）、改系统配置（含微信支付商户私钥 `wechat.pay_private_key`、APIv3 密钥、AI API key）、给用户调金币。操作日志（operation-logger.js）只在 fortune 路由使用，其他管理操作无审计（且 `detail: { body: req.body }` 若日后用于 config 更新会把支付私钥明文写进日志表）。

**修复**：加 role 中间件（super 专属：管理员管理/敏感配置）；敏感配置编辑前后值脱敏；全量管理写操作接入 operationLogger。

## 2.10 鉴权覆盖盘点（写接口清单）

| 无 auth 的写接口 | 说明 | 风险 |
|---|---|---|
| `POST /api/auth/login` | 微信登录（合法公开，code 一次性） | 🟡 无限流 |
| `POST /api/admin/auth/login` | 管理员登录 | 🔴 见 2.3 |
| `POST /api/payments/wechat/notify` | 微信支付回调 | 🟢 验签（2.11） |
| `GET /api/configs/public`、`GET /api/fortune-bags/public`、`GET /api/health` | 只读公开 | 🟢 |

其余 user/rooms/games/shop/payments/stats/leaderboard 全部 `router.use(authMiddleware)`；admin 子路由全部 `adminAuth`（仅 login 除外）。覆盖完整，主要缺口是「有 auth 但无授权」（1.6）与「有 auth 但无频率限制」（2.5）。

## 2.11 🟢 微信支付回调（值得肯定的点）

`back/src/services/wechat-pay-service.js`：
- 验签链路完整：`wechatpay-{timestamp,nonce,signature,serial}` 头 + 平台公钥 RSA-SHA256 验签（96-120），序列号与配置比对（104-106）；`express.json({verify})` 保留 `req.rawBody` 用于原始报文验签（app.js:22-26）。
- 资源解密（AES-256-GCM，339-350）→ 再服务端主动 `queryWechatOrder` 反查订单（363）→ `grantPaidOrder` 以 `SELECT ... FOR UPDATE` + status 判重，重放通知幂等（298-324）。
- 客户端主动 `sync` 有订单归属校验（326-337 `user_id` 比对）。

🟡 硬化建议：`grantPaidOrder` 未比对 `transaction.amount.total` 与 `order.amount_cents`、未校验 `transaction.mchid/appid` 与本地配置一致；建议补上，并把 `pending` 订单加超时关闭任务（微信侧 2h 自动关单，本地无对应清理）。

## 2.12 🟡 SQL 注入与越权小结（总体良好）

- 全部查询走 `db.execute/queryOne/queryAll` 的 `?` 参数化（db.js:22-47）；动态 `ORDER BY`（stats-service.js:121-133）与 `WHERE`/`SET` 拼接（admin-* services）均为**白名单字段 + 参数绑定**，未发现注入点。
- 越权（用户 A 改用户 B）：`updateProfile`/`getProfile` 等均以 `req.user.userId` 为键，未发现横向越权；真正的横向问题是对局数据的「无成员校验可读」（1.6）。
- 头像上传：扩展名白名单 + 2MB 限制 + 随机文件名（user.js:22-32、upload-service.js:5-18），无路径穿越；但 `getUploadBaseUrl` 信任 `x-forwarded-host/proto`（user.js:38-45）——直连暴露时可用伪造 Host 头把存储的头像 URL 指向任意域名（展示型影响，🟡）。
- 福袋数据抓取 `fetchWithTimeout` 12s 超时（fortune-reality-service.js:523-540），endpoint_url 由管理员配置，admin 账号被接管时即 SSRF 面（🟡，随 2.3 一并收敛）。

---

# 3. 数据一致性

## 3.1 🟠 对局结算不写 coin_records 流水（收益页缺账目、审计缺失）

**位置**：`back/src/services/game-service.js:418-427`

**证据**：结算直接 `UPDATE users SET coins = coins + ?, game_count = game_count + 1, total_income = ..., total_exp = ..., win_count = ...`，不插入 `coin_records`。而收入明细页读的是 `/api/stats/coin-records`（pages/income/index.js:61）→ 玩家所有对局收益在明细页不可见；管理员调币（admin-user-service.js:76-99）和商城购买（shop-service.js:480-484）都写了流水，唯独最大宗的对局收益没有。

**修复**：结算事务内为每个真人玩家补 `INSERT INTO coin_records (user_id, amount, balance_after, type='game_reward', title=...)`。

## 3.2 🟡 `game_players.initial_score` 与内存口径不一致（历史记录失真）

**位置**：`back/src/services/room-service.js:413-421` vs `back/src/services/game-service.js:91、273`

**证据**：`roomService.startGame` 用 `randomInt(80,220)` 写入 `game_players.initial_score`；随后 `startGameSession` 的 `buildOnlinePlayers` **重新随机**生成一轮分数作为内存 `initialScores`（game-service.js:91），且不回写 DB。结算发币用内存 `game.initialScores`（409-412），而结果页回放用 DB `initial_score/final_score`（`personalizeStoredResultPayload`，game-service.js:162-165）→ 同一局两个口径，战绩历史的 gain 与实发金币对不上。

**修复**：开局只在一处生成初始分，`startGameSession` 用 `UPDATE game_players SET initial_score=?` 同步；或干脆以 DB 值为准回读。

## 3.3 🟡 服务端从不更新 users.level（等级字段永久过期）

**位置**：`back/src/services/game-service.js:418-427`、`back/src/game-engine/progression.js`

**证据**：结算不更新 `level`；`progression.js` 的 `buildExpProgress` 服务端存在但无任何调用方（grep 无路由引用）。`GET /api/user/profile`、`/api/leaderboard` 返回的 `level` 恒为注册时的 1；前端则本地用 `totalExp` 推算等级 → 前后端显示不一致。

**修复**：结算时用 `buildExpProgress(totalExp).level` 同步更新 `users.level`（或干脆 leaderboard/profile 实时推算，废弃该列）。

## 3.4 🟠 shop buyItem 竞态白嫖（UPDATE 未检查 affectedRows）

**位置**：`back/src/services/shop-service.js:434-489`

**证据**：预检查（余额、未拥有）在事务外；事务内 `UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?`（461-464）有守卫，但**不检查 affectedRows**：若并发下余额刚好被另一笔扣光，本次 UPDATE 影响 0 行（不扣钱）→ 代码继续读余额、`INSERT user_items`、记流水 → 免费拿到商品。`user_items` 的 `uk_user_item` 只防同商品重复，防不住「并发买两件不同商品」时第二件白嫖。

**修复**：`const [res] = await conn.execute(...); if (res.affectedRows === 0) throw 余额不足;` 并回滚；或全程 `SELECT ... FOR UPDATE` 锁用户行。

## 3.5 🟡 并发更新与排行榜

- 结算的用户累加用 `coins = coins + ?` 原子自增（无丢失更新），并发对局安全；真正的翻倍风险来自 1.2 的重复结算。
- `getLeaderboard` 直接 `ORDER BY total_income DESC LIMIT ?`（stats-service.js:135-150），无缓存；当前量级可接受，量起来后建议物化视图/定时快照。
- `listAvailableRooms` 对每个房间一次 COUNT 子查询（room-service.js:148-167）——N+1，房间多时注意（🟡）。

## 3.6 事务使用清单

| 写操作 | 事务 | 备注 |
|---|---|---|
| createRoom / joinRoom / leaveRoom / startGame（房间+玩家） | ✅ | 但存在 1.8 的检查-执行竞态 |
| startGameSession（对局初始化 + 玩家行） | ❌ | 逐条插入，且含 1.1 的机器人 NaN 缺陷 |
| finishGame 结算发奖 | ❌ | 1.2 重复/部分结算 |
| shop buyItem / equipItem | ✅ | buyItem 有 3.4 的 affectedRows 缺口 |
| 支付 grantPaidOrder | ✅（FOR UPDATE + 幂等） | 2.11 |
| 管理员 adjustCoins | ✅ | 含流水 |
| 对局奖励流水 | ❌ | 3.1 |

---

# 4. 生产运维

## 4.1 🔴 密钥管理（详见 2.1/2.2）

`.env` 被跟踪 + 真实 AppSecret 已在工作区 + JWT_SECRET 占位值可过生产校验——三件事叠加，属于上线前必须处理的合规/安全红线。

## 4.2 🟠 docker-compose 把 MySQL 3306 暴露公网 + 默认弱口令

**位置**：`back/docker-compose.yml:6-13`

**证据**：`ports: "3306:3306"`（无绑定地址限制），root 密码默认 `game_codex_pass`（来自 `.env`，且同样在仓库里）。照此部署等于把数据库直接放到公网。

**修复**：去掉 ports 映射（仅内网容器互通），root 密码强制注入，业务账号最小权限（只授 game_codex 库），生产禁止用 compose 里的默认值。

## 4.3 🟠 无 graceful shutdown

**位置**：`back/src/app.js:74-83`

**证据**：`server.on('close')` 里写了清理逻辑（关 ws hub、停定时任务），但**没有任何 SIGTERM/SIGINT 处理器去调 `server.close()`**，`db.pool.end()` 也没人调用。发布/重启时进程被直接杀死：进行中的 tick 事务中断（1.2）、内存对局丢失（1.3）、连接池没有正常排空。也没有 `uncaughtException`/`unhandledRejection` 兜底策略。

**修复**：加信号处理器：停止接收新请求 → `server.close()` → 关 interval → `db.pool.end()` → 超时强退；接入进程管理器（PM2/systemd）的 stop 信号。

## 4.4 🟡 数据库迁移无运行器

**位置**：`back/sql/001-006*.sql`、`back/docker-compose.yml:14-19`

**证据**：SQL 只挂载在 `docker-entrypoint-initdb.d`（**仅全新数据卷首次初始化时执行**）；无迁移版本表、无 `npm run migrate`；`src/services/wechat-pay-service.js:12-32` 与 `admin-config-service.js:20-34` 在**请求路径内**执行 `CREATE TABLE IF NOT EXISTS`（每次支付/配置请求都跑一遍 DDL，且要求业务账号有 DDL 权限）。已在跑的环境升级 schema 全靠手工。

**修复**：引入轻量迁移脚本（版本表 + 顺序执行），启动时跑迁移；请求内 DDL 移到启动/迁移阶段。

## 4.5 🟡 fortune-reality-job 单机行为与多实例风险

**位置**：`back/src/jobs/fortune-reality-job.js`

**证据**：单进程 `setInterval`（默认 5 分钟），`running` 布尔防重入（6-24 行）；重启后 `setTimeout(5000)` 很快补跑（32 行）——单机重启行为可接受。但：多实例/PM2 cluster 下每个实例都会抓取并 `INSERT fortune_snapshots`（无去重，fortune-reality-service.js `insertSnapshot` 无唯一约束），且无 leader 选举/分布式锁；`ENABLED=false` 才关闭。另有 `npm run fortune:refresh` 独立 CLI 可手动补跑（会与定时任务并发，靠 `running` 是进程内的，CLI 是另一个进程，不受保护）。

**修复**：声明单实例部署；或快照表加 `(source_id, observed_at)` 唯一键 + `INSERT IGNORE`；CLI 与常驻任务加 DB 级锁。

## 4.6 🟡 单机内存态与扩展性硬限制

`activeGames`（game-service.js:14）、`connectedClients`（arena-handler.js:6）、`sessionClients`（arena-realtime.js:40）全是进程内 Map：无法水平扩展；PM2 cluster 下对局 tick 只在创建它的 worker 跑，而客户端 ws 可能连到其它 worker（拿不到状态）。上线文档必须写死「单实例」，后续扩展需引入 Redis（pub/sub + 会话态外置）。

## 4.7 🟡 日志与可观测性

- morgan `combined` 不含 Authorization 头（好）；但 ws token 在 URL query（2.8）会被反代日志记录。
- 无结构化日志、无 trace id；错误仅 `console.error`（生产 error-handler 不打印堆栈是「少」，但 morgan 之外的业务错误散落各处）。
- `/api` 未知路径返回 Express 默认 HTML 404，与 `{code,message}` 统一契约不一致；建议加 JSON 404 handler。

---

# 5. 前端-后端契约

## 5.1 🟡 baseURL 与环境切换

**位置**：`utils/api-client.js:4-20`、`pages/arena/index.js:67-77`

- 默认 `https://xcx.ukb88.com/api` 硬编码；支持运行时覆盖（storage key `game_codex_api_base_url_v1`，`setBaseUrl`）；**无环境自动切换**（dev/prod 靠手工 setBaseUrl 或远端下发的逻辑不存在），文档未写明上线前如何切换。
- 上线必须满足：域名 `xcx.ukb88.com` 已备案 + 微信后台 request/ws 合法域名配置（`wss://xcx.ukb88.com`、`https://xcx.ukb88.com`），且 CDN 资源与 API 同域（当前一致）。
- 注意 `project.config.json` 的 `urlCheck: false` 只影响开发者工具，真机不豁免域名校验。

## 5.2 🟢 API 路径全部对齐（逐条核对通过）

| 前端调用 | 后端路由 | 状态 |
|---|---|---|
| `POST /auth/login`（user-profile.js:78） | routes/auth.js:8 | ✅ |
| `POST /rooms`（room/index.js:280） | routes/rooms.js:14 | ✅ |
| `GET /rooms/:id`（room/index.js:336） | routes/rooms.js:46 | ✅ |
| `POST /rooms/:id/join`（room/index.js:266） | routes/rooms.js:84 | ✅ |
| `POST /rooms/:id/start`（room/index.js:358） | routes/rooms.js:151 | ✅ |
| `GET /games/:id`（arena/index.js:345） | routes/games.js:8 | ✅（无成员校验，1.6） |
| `POST /games/:id/emotes`（arena/index.js:388） | routes/games.js:55 | ✅ |
| `GET /games/:id/result`（result/index.js:448） | routes/games.js:23 | ✅ |
| `POST /payments/wechat/jsapi`（shop/index.js:265） | routes/payments.js:8 | ✅ |
| `POST /payments/wechat/orders/:orderNo/sync`（shop/index.js:269） | routes/payments.js:24 | ✅ |
| `GET /stats/coin-records`（income/index.js:61） | routes/stats.js:36 | ✅ |
| `GET /user/profile`（income/index.js:63 等） | routes/user.js:64 | ✅ |
| `GET /configs/public`（runtime-config.js:58） | routes/configs.js:7 | ✅ |

## 5.3 🟢 前后端引擎与常量当前一致（逐项 diff 通过）

- `back/src/game-engine/constants.js` vs `utils/constants.js`：`GAME_DURATION_SECONDS=180`、`ROUND_INTERVAL_SECONDS=3`、`INITIAL_SCORE_RANGE {80,220}`、`MIN/MAX_PLAYERS 4/10`、`TEAM_SIZE=2`、全部概率参数、STAGES 1-7（id/name/income 完全一致）✅。
- `back/src/game-engine/game-engine.js` vs `utils/game-engine.js`：逐行 diff 仅 24 行差异，全部为前端本地模式附加能力（selfAvatar/selfName、resolveStage）；`playRound/pairPlayers/buildResult/buildRanking/applyRoundEvents` 核心逻辑一致 ✅。
- 商城：`shop-service.js GOODS`（34 项）与 `utils/shop-store.js` 的 id/price 全量比对一致（34/34，0 diff）✅。

## 5.4 🟡 「拷贝式同步」的漂移风险（当前已出现实例）

三处关键逻辑是手工双份维护（无共享包/契约测试）：game-engine 引擎、constants、商城 GOODS。已有漂移实例：
- `utils/arena-realtime.js`（支持 `game_tick/time_update/emote_broadcast` 事件）与 `pages/arena/index.js` 内联实现（只处理 `game_state/game_finished`）并存，前者死代码——两套对「实时协议应该有什么事件」的认知已经分叉；
- `room-service.js:4-7` 内联复制了 `MIN_PLAYERS/GAME_DURATION_SECONDS/INITIAL_SCORE_RANGE` 常量（其中 `MIN_PLAYERS=4` 在该文件里定义了却从未使用——最小人数校验写成了 `current_players < 1`）；
- 模式文案：后端在线模式 `modeText='联网对战'`（game-service.js:11），前端常量 `MATCH_MODE_TEXT='本地体验'`（constants.js:8）——在线结果由后端字段覆盖，目前行为正确但依赖隐性约定。

**建议**：建一个 `shared/` 常量/引擎包（npm workspace 或发布私有包）+ CI 契约测试（快照 diff 两端常量、引擎函数输出对拍）。

## 5.5 🟡 在线模式的功能契约缺口

- 服务端推送的 `game_tick`（回合事件）客户端不消费 → 在线对局过程画面静止（1.7）。
- 福袋投资在在线模式为纯本地演出：`onConfirmOpportunity` 只改本地 shopStore 金币（pages/arena/index.js:815-830），服务端 `fortune_buy` 事件又无人调用（1.4）→ 玩家在局内「买卖」对最终成绩零影响，结算收益与局内操作无因果，容易造成「充了钱没效果」的体验/投诉。
- 表情：客户端走 HTTP `POST /games/:id/emotes`，服务端广播 `emote_broadcast`，但在线对局页面不处理该事件 → 在线模式表情功能实际不可见（本地模式的随机表情在在线模式也被 `if (!this.localMode) return;` 关掉）。

---

## 附：核对结论（正面清单）

1. JWT 覆盖完整：除登录/支付回调/公开配置外全部接口有鉴权；支付回调验签+解密+反查+幂等发放链路完整。
2. SQL 全部参数化，动态 SQL 片段均为白名单字段，未发现注入点。
3. 结算以服务端引擎为准，客户端无法直接改分数/金币（主要作弊面是信息泄露与重复结算，而非伪造）。
4. 商城/引擎/常量前后端当前完全同步；前端 API 路径与后端路由 13/13 对齐。
5. 测试基线健康：后端 31/31、前端 178/178 全绿（但未覆盖：机器人开局落库、finishGame 幂等、对局成员校验、限流、封禁拦截）。
6. 公开配置接口按 `isPublic` 白名单过滤，不会外泄支付密钥等敏感项。

## 上线前必修清单（按优先级）

1. 修 1.1 机器人落库 NaN（否则 <4 人局全废）。
2. 把 `back/.env` 移出 git + 重置微信 AppSecret + 生成强 JWT_SECRET（用户/管理员分钥）。
3. 删掉 admin 引导建号逻辑 + 管理员登录限流 + 改默认密码。
4. finishGame 加幂等守卫 + 事务 + 补 coin_records 流水。
5. 对局成员校验（ws join、GET /games/:id[/result]、emotes）+ 启动对账任务兜底进程重启。
6. 封禁拦截接入 auth 中间件；admin 角色权限拆分。
7. 全局限流；shop buyItem affectedRows 检查。
8. graceful shutdown、MySQL 不暴露公网、迁移运行器、生产错误脱敏。
