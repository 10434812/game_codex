# 代码健壮性与边界条件分析（上线前）

> 分析范围：微信小程序前端（utils/*、pages/*/index.js、app.js）+ 后端（back/src/services、back/src/routes、socket、jobs）
> 分析方法：逐文件精读实际代码 + 实测运行测试 + 程序化比对前后端常量/商品目录 + npm audit + git 仓库体检
> 验证时间：本地实测 `npm test` 前端 178 例全绿、后端 31 例全绿（无 fail / 无 skip）

## 0. 结论速览（TOP 风险）

| # | 问题 | 等级 |
|---|---|---|
| 1 | 在线对局状态只存内存（activeGames），服务重启即全部丢失，DB 里 `game_sessions.status='playing'` 成为永久孤儿，前端轮询返回无 players 的裸状态 → 玩家卡死在冻结的对局页 | 🔴高 |
| 2 | `game-service.finishGame` 结算（加金币/加经验/写结果）无事务、无重试，中途 DB 故障会造成半结算（部分玩家已加币、结果缺失），且无任何对账修复手段 | 🔴高 |
| 3 | `back/.env` 被提交进 git，含疑似真实的 WX_SECRET 与弱管理密码 admin123（且 .env 中的 WX_APPID 与小程序真实 AppID 不一致） | 🔴高 |
| 4 | 后台管理员登录无速率限制/锁定，管理接口暴露公网时可被暴力破解 | 🔴高 |
| 5 | `shop-service.buyItem` 的扣款 UPDATE 不检查 affectedRows，并发双击购买竞态下可"发物品不扣款"，流水与余额脱节 | 🔴高 |
| 6 | 前端 game-store 持久化恢复只存 5 个字段（不含 players/teams），App 被系统杀掉后重开会恢复出"playing 但 0 玩家、计时器不跑"的僵尸中间态 | 🔴高 |
| 7 | 房间开局链路存在双重启动竞态：`startGame`（UPDATE 无 WHERE status 条件）与 `startGameSession`（existingSession 查重非原子）并发时会产生双 session/双 tick 循环 → 结算双倍加币 | 🟠中 |
| 8 | `wx.request`/`wx.uploadFile`/`https.get`（code2session）全部无超时配置；arena 轮询 1s 一次、无退避、失败完全静默，弱网下无任何用户提示 | 🟠中 |
| 9 | 后端依赖 npm audit：10 个漏洞其中 3 个高危（ws 未初始化内存泄露+DoS、multer DoS、socket.io-parser 内存耗尽、brace-expansion DoS） | 🟠中 |
| 10 | 前后端契约漂移点：`system.maintenance_mode` 维护模式后端已实现但前端 8 个页面无任何消费（等于失效）；`/rooms/code/:code/join` 后端有、前端从未调用（用 id 接口传房间码）；`utils/arena-realtime.js` 与 `back/src/socket/native-arena-ws.js` 是未引用的死代码 | 🟠中 |

---

## 1. 异常与兜底

### 1.1 api-client 无超时、无重试（🟠中）

- 位置：`utils/api-client.js` L88-138（request）、L151-196（uploadFile）
- 证据：`wx.request({url, method, data, header, success, fail})` 未配置 `timeout` 字段；`wx.uploadFile` 同样没有。小程序默认超时 60s，且部分安卓机型行为不一致。弱网/服务器挂起时用户最长要等 60s 才收到错误，所有页面按钮无 pending 状态，可重复触发请求。
- 影响：登录、买皮肤、支付下单、轮询等所有网络路径。arena 页 `fetchArenaState` 失败仅 `console.warn`（`pages/arena/index.js` L360-362），用户看到的是"画面冻结"而不是错误提示。
- 建议：
  1. `request()` 统一加 `timeout: 10000`，uploadFile 加 `timeout: 15000`；
  2. 对幂等 GET 增加 1 次退避重试（如 500ms 后重试一次）；
  3. 失败时给调用方带回可展示的错误（现有 err.message 已可用，页面侧统一 toast 兜底）。

### 1.2 后端 code2session 无超时（🟠中）

- 位置：`back/src/services/auth-service.js` L17-43（wechatCode2Session）
- 证据：`https.get(url, ...)` 无 `req.setTimeout` / AbortController。微信接口偶发慢响应时，登录请求会挂起直到系统默认超时（可能数分钟），期间用户卡在 boot/登录流程。
- 建议：加 `req.setTimeout(8000, () => req.destroy(new Error('timeout')))`，并在 catch 中给用户"网络繁忙请重试"。

### 1.3 管理员登录无速率限制/锁定（🔴高）

- 位置：`back/src/routes/admin/auth.js` L25-77
- 证据：`POST /api/admin/auth/login` 只做 `bcrypt.compare`，无失败次数记录、无 IP/账号锁、无验证码。`config.admin.password` 生产环境虽强制设置，但 `ADMIN_USERNAME` 默认 'admin'；配合 1.4 的 admin123 弱密码，公网部署后管理后台是直接爆破面。
- 建议：加内存级限速（如同 IP 15 分钟 5 次失败锁 30 分钟）+ 失败操作日志；生产强密码策略（长度≥12）；条件允许加 IP 白名单/二次验证。

### 1.4 已提交的 .env 含弱密码与疑似真实密钥（🔴高）

- 位置：`back/.env`（git 跟踪中，唯一一次提交 `dd8a794`）
- 证据：`ADMIN_PASSWORD=admin123`、`WX_SECRET=ae021a2cd4bd79317a71bce959ce7cb9`（非占位字符串，疑似真实 AppSecret）、`WX_APPID=wxd7f500f3f21f15dd`。
- 注意：小程序 project.config.json 的 AppID 是 `wx72a4b552a87b44cf`（.env.example 中也是它），与 .env 中 WX_APPID **不一致** —— 若上线直接用这份 .env，微信登录会因 appid 不匹配而全部失败（40029/40013）。
- 建议：
  1. 立即从 git 历史中清除（`git filter-repo` 或重建仓库），轮换 WX_SECRET 与所有密码；
  2. 把 `.env` 加入 .gitignore（当前根 .gitignore 只忽略了 `.env.local`）；
  3. 上线前核对 WX_APPID/WX_SECRET 属于小程序 `wx72a4b552a87b44cf`。

### 1.5 音频中文 URL 未编码（🟡低）

- 位置：`utils/audio.js` L16-17（`富士山下音频.mp3`、`埃菲尔音频.mp3`、`美洲大峡谷音频.mp3` 等）
- 证据：`audio.src = src` 直接赋含中文/非 ASCII 字符的 URL。iOS/部分安卓 InnerAudioContext 对未编码中文路径可能解析失败，且 URL 编码也影响 CDN 签名。所有播放调用虽有 try/catch，但失败即静默无音。
- 建议：统一 `encodeURI()` 每个 audio src（或后端/CDN 上传时重命名为 ASCII 文件名），加 onError 日志便于真机排查。

### 1.6 前端已有良好兜底（🟢肯定项，供对照）

- `boot-loader.js`：单张图预加载失败只 warn 并继续，Promise.all 包装 catch，boot 页还有 maxTimer 兜底（`pages/boot/index.js` L93-105），启动流程不会因资源失败卡死。
- `user-profile.js` login/requestUpdate/uploadAvatar/fetchProfile 全部 try/catch 并回退本地缓存。
- `shop-store.js` `loadState`/`saveState` 对 storage 异常有 catch 且 normalize 兜底（coins 负数钳制为 0、非法数组转 []、装备了未拥有物品时回退默认）。
- `player-stats.js` 同款 normalize + catch。
- `nav.js` 双 API 降级 + try/catch + 默认值。
- `runtime-config.js` / `fortune-reality.js`：网络失败回退默认配置/本地机会生成，60s 缓存 + 单飞（pendingPromise 去重）。
- `audio.js`：所有 API 调用 try/catch，onError 销毁音频实例，voice 与 BGM 做 duck/restore。

---

## 2. 状态一致性

### 2.1 在线对局 = 内存态，服务重启即丢局（🔴高）

- 位置：`back/src/services/game-service.js` L16（`const activeGames = new Map()`）、L391-441（finishGame）、`back/src/routes/games.js` L11-16
- 证据链：
  1. 对局状态（players/teams/timeLeft）只存在于 `activeGames` Map，重启清零；
  2. DB 中 `game_sessions.status` 保持 'playing'，没有任何启动时恢复/兜底任务（grep 全后端无 orphan/recover 逻辑）；
  3. 重启后前端轮询 `GET /api/games/:id` → `getGameState` 返回 null → 路由回退返回 `{sessionId, status: 'playing'}`（`routes/games.js` L15）；
  4. 前端 `syncArena` 有 `Array.isArray(state.players) && Array.isArray(state.teams)` 保护（`pages/arena/index.js` L307），于是永远不同步 → 玩家永久卡在冻结的对局页，1s 轮询永不停止。
- 建议（按优先级）：
  1. 上线前最小修复：`GET /games/:id` 在内存态缺失且 DB status='playing' 且 `started_at` 早于当前进程启动时间时，直接返回 `{status:'finished'}` 或 409，前端收到后跳回首页/房间并提示"对局已失效"；
  2. 中期：启动时把遗留 'playing' 的 session 标记为 finished（或按 game_rounds 重放结算）；
  3. 长期：对局状态落库（round events 已在写 game_rounds，可基于它重建），finishGame 幂等化（按 session 加结算版本号/状态机）。

### 2.2 finishGame 无事务的半结算（🔴高）

- 位置：`back/src/services/game-service.js` L391-441
- 证据：结算顺序为 `UPDATE game_sessions` → 逐玩家 `UPDATE game_players` → `UPDATE users SET coins = coins + ...` → `INSERT game_results`，全部裸 `db.execute`，无 `beginTransaction`。任何一步失败：
  - 部分玩家已加币/加经验/game_count+1，其余没有；`game_results` 缺失 → 结果页 404；
  - tick 循环 catch 只 `console.error`（L306-308），无重试；
  - 无对账任务，用户申诉只能人工改库。
- 建议：整个结算包进一个事务（+ `SELECT ... FOR UPDATE` 锁 session 行）；`INSERT game_results` 用 `INSERT IGNORE`/先查重保证幂等；事务提交前把 coins_earned 一并算好；失败打错误日志到独立文件并告警。

### 2.3 开局双重启动竞态（🟠中）

- 位置：`back/src/services/room-service.js` L399（`UPDATE rooms SET status = 'playing' WHERE id = ?` 无 status 条件）、`back/src/routes/rooms.js` L163（fire-and-forget 调 startGameSession）、`back/src/services/game-service.js` L220-225（existingSession 查重非原子）
- 证据链：房主双击开始按钮/客户端重试 → 两次 POST /rooms/:id/start：
  1. `room-service.startGame` 两次都通过 `status='waiting'` 检查（UPDATE 不带 `WHERE status='waiting'`，不防重）；
  2. 两次都 INSERT game_sessions（重复 session）；
  3. 两个 `startGameSession` 并发跑，`existingSession` 查重有窗口期 → 两个 tick loop 各自持有自己的 game 对象（`startTickLoop` L300 的 interval 闭包捕获旧对象，L298 `if (game.timer) clearInterval` 清的是新对象）；
  4. 两个 finishGame → 双倍加币、双倍 game_count。
- 建议：`UPDATE rooms SET status='playing' WHERE id=? AND status='waiting'` 并检查 affectedRows（0 则返回"游戏已开始"）；`startGameSession` 内对 `game_sessions` 插入加 `INSERT IGNORE` 或 `SELECT ... FOR UPDATE`；`startTickLoop` 在注册新 timer 前清掉同 sessionId 的旧 timer。

### 2.4 joinRoom 满员竞态（🟠中）

- 位置：`back/src/services/room-service.js` L185-190（先查后插）
- 证据：`room.current_players >= room.max_players` 的检查与 `INSERT room_players` + `UPDATE rooms SET current_players = current_players + 1` 不在同一事务/无行锁。9/10 满员时两个用户同时加入 → 11 人。`uk_room_user` 只防同一用户重复，不防超员。
- 建议：在事务内先 `SELECT ... FOR UPDATE` 锁 rooms 行再校验；或把校验并入 `UPDATE rooms SET current_players = current_players + 1 WHERE id=? AND current_players < max_players` 并检查 affectedRows。

### 2.5 buyItem 扣款 UPDATE 不检查 affectedRows（🔴高）

- 位置：`back/src/services/shop-service.js` L466-483
- 证据：`UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?`（L466）执行后**没有检查 affectedRows**，直接继续 `INSERT INTO user_items`（L475）、写流水（L481）、commit。并发双击购买（两个请求都先 SELECT 到足够余额）时：第二个 UPDATE 因余额不足影响 0 行，但物品照发、流水照记（balance_after 读出来是实际余额）→ **免费拿物品 + 流水造假**。
- 建议：`const [result] = await conn.execute(...); if (result.affectedRows !== 1) { await conn.rollback(); throw ...'余额不足' }`；同时对 `user_items` 的唯一键冲突（ER_DUP_ENTRY）做友好错误映射，避免向用户泄露 SQL 错误文本（当前 errorHandler 在 500 分支直接返回 err.message，`Duplicate entry '1-skin-xxx'` 会泄露表结构）。

### 2.6 前端 buyViaApi 失败回退本地 → 双重扣款/重复发放（🟠中）

- 位置：`utils/shop-store.js` L773-787（buyViaApi）、`pages/shop/index.js` L208-230（api 失败 fallback 本地 purchaseItem）
- 证据：`buyViaApi` 网络失败返回 false → 页面 catch 后调用本地 `purchaseItem` 再扣一次本地余额并本地发物品。若服务器实际已成功扣款发物品（响应丢失），用户本地被扣两次（本地与服务端余额从此漂移，下次 `refreshInventory` 只合并物品不清余额）。
- 建议：API 失败时改为仅提示"网络异常，请重试"，不自动回退本地购买；或服务端购买接口改为幂等（客户端生成 requestId，服务端按 requestId 去重）。

### 2.7 异步交错的余额覆盖（🟠中）

- 位置：`utils/shop-store.js` L779（`state.coins = result.coins || state.coins` 再 saveState）
- 证据：`buyViaApi`/`refreshInventory` 在 await 之间读-改-写 storage，而 `addCoins`（对局结算）、`applyCoinsDelta`（福袋买卖）走的是另一条同步路径。场景：对局结算 +1000 → 随后 buyViaApi 的 await 返回，用旧的 `loadState()` 基础覆盖 saveState → 1000 币丢失（对用户有利有弊，但流水对不上）。`result.coins === 0` 时 `0 || state.coins` 还会保留旧余额（应显示 0）。
- 建议：shop-store 引入内存单例缓存 + 写队列（或所有变更走同一个 `mutate(fn)`），避免 storage 作为读写中转；`??` 替代 `||` 判断服务器余额。

### 2.8 game-store 持久化恢复产生僵尸对局（🔴高）

- 位置：`utils/game-store.js` L37-51（只保存 roomId/stage/status/timeLeft/round）、L65-79（模块加载时恢复）
- 证据链：
  1. 保存的 payload 不含 players/teams/scoreLog/initialScores；
  2. 恢复条件只是 `persisted.status === 'playing'` → 得到 status='playing'、players=[]、且模块级 timer 不会重新启动；
  3. 用户重开小程序后从 tab 进 arena：`gameStore.ensureRoom` 因 status='playing' 直接返回（L150-153），room 页 `observeState` 看到 playing 就 redirect arena（`pages/room/index.js` L126-130），arena `onShow` 对 `snapshot.status === 'playing'` 执行 `syncArena(snapshot)`（L188-190）→ 渲染 0 玩家、倒计时冻结的僵尸战场；
  4. 同一时刻 `onShow` 的 `snapshot.status === 'finished'` 分支缺失（本地模式只有 subscribe 回调里处理 finished，返回页面时不会重放），用户从商城返回 arena 时若游戏已结束同样卡在旧画面（`ensureArenaState` 已定义但**从未被调用**，L398）。
- 建议：
  1. 恢复时校验完整性：`players.length === 0` 或 `timeLeft<=0` 一律 `clearPersistedState` + 重置为 idle；
  2. 要么完整持久化 players/teams/scoreLog（体积可控：10 人 × ~150B ≈ 1.5KB），要么干脆不恢复 playing 态；
  3. arena `onShow` 补 `if (snapshot.status === 'finished') redirect result` 分支，并让 `ensureArenaState()` 真正接入 onShow。

### 2.9 每秒同步写 storage（🟡低）

- 位置：`utils/game-store.js` L473（tick 内每 1s 调 savePersistedState）
- 证据：180s 对局每 tick 同步 `wx.setStorageSync` 一次，且 payload 不含玩家数据（写了也恢复不了），纯属无收益 I/O。低端安卓上同步写卡顿可感知，也放大 2.10 的崩溃窗口。
- 建议：降频为每 5-10s 或仅在开局/关键节点写；或按 2.8 建议改为完整快照 + 降频。

### 2.10 后端失败重试路径小结（🟡低）

- `startGameSession` 的 fire-and-forget（`routes/rooms.js` L163-165）：失败只 console.error，房主已收到"游戏开始"，实际没有 tick 循环 → 房间 playing、无人驱动 → 与 2.1 的孤儿状态同病。
- `operation-logger` monkey-patch `res.json`：多页路由无碍，但若 handler 抛错未走 res.json 则漏日志——可接受。

---

## 3. 数值边界

### 3.1 积分负值钳制（🟢安全，说明边界已处理）

- 前端 `game-engine.js` L155 `normalizePlayers` 钳 `Math.max(0, floor(score))`；`applyRoundEvents` L263 同样钳制；`game-store.applyPlayerScoreDelta` L418 钳制。福袋买入扣分也不会把积分扣成负数。
- 后端同一份引擎逻辑（`back/src/game-engine/game-engine.js` 相同实现）。
- 遗留注意：`game-store.applyPlayerScoreDelta` 与 `applyRoundEvents` 都静默钳 0，意味着"买入 > 剩余积分"时玩家免费买入了福袋（只扣到 0）。`pages/arena/index.js` L822 先扣币（有余额检查）再扣分，币够但分不够时会出现币少分不少——属于产品规则，建议上线前明确"买入价格同时受积分上限约束"。

### 3.2 progression 无上界防护（🟡低）

- 位置：`utils/progression.js` L11（`while (remaining >= required)`）
- 证据：`getLevelRequirement` 恒正，正常数据必收敛；但若 totalExp 来自后端（`fetchSummary` 直接透传 `data.totalExp`）被运营/脏数据写成天文数字（如 1e21），`buildExpProgress` 将循环 ~10^19 次 → 首页/结算页永久卡死（同步阻塞 JS 线程）。本地 storage 因 JSON 序列化不会出现 Infinity，风险主要在服务端数据。
- 建议：循环加最大迭代上限（如 10000 级）或改用闭式求解 `level = floor((sqrt(...)+...))`；后端 getSummary 对 totalExp 做上限钳制。

### 3.3 formatDateTime 的本地时区与 0 值（🟡低）

- 位置：`utils/format.js` L15-23
- 证据：直接用 `getFullYear/getMonth/getDate` 取设备本地时区，用户改时区后同一流水时间显示漂移（展示层，可接受）；`Number(timestamp) || Date.now()` 把合法时间戳 0（1970）当无效值（实际上流水 createdAt 都是 Date.now()，无实际影响）。跨时区用户（海外）看到的时间与北京时间不一致，若运营靠流水时间对账会产生困惑。
- 建议：统一用北京时间（UTC+8）格式化：`new Date(timestamp + 8*3600*1000)` 后取 UTC getter。

### 3.4 投资/福袋浮点与时钟（🟢安全 + 🟡低）

- `utils/investment.js` settlePosition：`holdSeconds = Math.max(0, ...)` 已防用户改系统时间导致负持有；multiplier 结果 Math.round 取整，无浮点展示问题。风险点：`Date.now()` 被用户回调后，持有时间变短/变长直接影响收益波动（本地上报无服务端校验），属演示级产品可接受，上线前建议记录。
- `proceeds` 为 0 时（multiplier 极小）`applyCoinsDelta(0)` 返回 NO_CHANGE，不产生流水，无崩溃。

### 3.5 人数/时间边界（🟢安全）

- 4/10 边界：前端 engine `clamp(options.count || MIN_PLAYERS, 1, MAX_PLAYERS)`、`ensureMinimumPlayers` 补机器人、`slice(0, MAX_PLAYERS)`；`createRoomState` 的 `clamp(roomSize, MIN_PLAYERS, ROOM_UI_LIMIT)`。
- 后端 `room-service.startGame` L384-388 允许 1 人开局（注释"至少需要1名玩家"），靠引擎补机器人到 4 —— 与前端房主视角行为一致，但与 `MIN_PLAYERS=4` 常量的语义不符（`room-service.js` L4 里 MIN_PLAYERS 定义了但从未使用）。建议删除或真正启用。
- 时间为 0：`game-engine.buildVisibleScoreState` 对空 players 有 `phase:-1` 兜底；`formatTimeLeft` 钳 `Math.max(0, ...)`。

### 3.6 支付金额单位耦合（🟡低）

- 位置：`back/src/services/wechat-pay-service.js` L225（`amountCents = Math.max(1, Math.round(Number(item.price) || 0))`）、前端 `pages/shop/index.js` L8（`COINS_PER_CNY = 100`）
- 证据：后端把"锦鲤币价格"直接当"分"提交（1280 币 = ¥12.80 恰巧正确，因为前端 1 元=100 币）。该等价关系没有任何注释或共享常量，任何一方改价格体系即静默错价。
- 建议：后端显式 `amountCents = Math.round(item.price / COINS_PER_CNY * 100)`，并在 comment/常量中固化 100 币=1 元的规则；商品价格以服务端为准并加一条契约测试（已有 shop 商品 diff 可扩展）。

---

## 4. 测试覆盖

### 4.1 实测结果（🟢）

- 前端：`npm test` → **178 pass / 0 fail / 0 skip**（tests/*.test.js 共 17 个文件）。
- 后端：`cd back && npm test` → **31 pass / 0 fail / 0 skip**（10 个文件）。
- 结论：测试套件当前全绿，但覆盖率结构性问题见 4.2/4.3。

### 4.2 无测试覆盖的关键模块

前端（utils 23 个模块中 8 个零测试）：

| 模块 | 缺失的关键路径 |
|---|---|
| `utils/api-client.js` | 401 清 token、超时、非 JSON 响应、`body.code!==0`、上传失败 —— 完全无测试 |
| `utils/boot-loader.js` | 预加载失败不阻塞、进度回调 |
| `utils/audio.js` | playVoice 防抖、BGM duck/restore、onError 销毁 |
| `utils/user-profile.js` | login 失败回退、requestUpdate 降级、uploadAvatar |
| `utils/runtime-config.js` | 拉取失败回退默认值、boolean 解析 |
| `utils/fortune-reality.js` | API 失败缓存、pendingPromise 单飞 |
| `utils/stage-theme.js` / `utils/share-config.js` / `utils/page-helpers.js` | 全无 |
| 8 个页面 index.js 的**运行时行为** | page-ui.test.js 仅覆盖少数场景（见 4.3） |

后端无测试的路径：`routes/` 全部（仅个别路由在 security-config.test.js 静态检查）、`socket/arena-handler.js`、`middleware/`（auth/admin-auth/error-handler）、`jobs/fortune-reality-job.js`、`admin-*-service`（除 admin-config/admin-presenters）。

### 4.3 假绿（mock 过度/断言过弱）

1. **page-ui.test.js 大量用正则断言源码文本**（例如 L243-252 `assert.match(arenaJs, /startArenaPolling\(sessionId\)/)`、income 页断言 `/stats/coin-records` 存在）。这类断言验证"代码长这样"，不验证行为：即使轮询逻辑写错（比如定时器永远不启动、redirect 参数错误），测试照样绿。真正的行为测试只有 room 槽位、profile 头像流程等少数几个。
2. **后端 game-service.test.js monkey-patch `db.execute` 恒返回 `{affectedRows: 1}`**（L95-98）→ 2.5 的 affectedRows 竞态、2.2 的事务原子性在测试层面被系统性屏蔽，永远测不出来。
3. `createWxStub` 里 `wx.request` 对未匹配 URL 一律返回 `{code:0, data:{}}`（空对象）→ 页面拿到空数据后的容错路径其实从未被真实压测（例如 `result.token` 对 null 的崩溃只在真机出现）。
4. 后端测试全部使用内存假 DB，没有任何 MySQL 集成/并发测试：事务、行锁、唯一键冲突、重启恢复（2.1/2.2/2.3/2.4/2.5 全类问题）均无覆盖。

### 4.4 建议补测的最小清单（按收益排序）

1. `api-client`：401/网络失败/超时/`code!==0`/字符串响应 JSON 解析失败；
2. game-store：持久化恢复完整性校验（写坏 payload、players 为空、timeLeft 为负）；
3. shop-service.buyItem：并发双买（affectedRows=0）必须拒绝；
4. game-service.finishGame：中途 DB 抛错 → 断言无部分结算（事务回滚）；
5. room-service.startGame 幂等：并发两次 start 只产生一个 session；
6. arena 页：onShow 收到 `{status:'playing'}` 无 players 状态 → 必须给用户可恢复路径。

---

## 5. 前后端契约漂移（逐项比对结果）

### 5.1 引擎常量（✅ 完全一致）

程序化逐项比对 `utils/constants.js` vs `back/src/game-engine/constants.js`：

| 常量 | 结果 |
|---|---|
| MIN_PLAYERS=4 / MAX_PLAYERS=10 / ROOM_UI_LIMIT=10 | ✅ 一致 |
| GAME_DURATION_SECONDS=180 / ROUND_INTERVAL_SECONDS=3 / TEAM_SIZE=2 | ✅ 一致 |
| ROOM_PLAYER_COUNT_OPTIONS=[4..10] / MATCH_MODE_TEXT='本地体验' | ✅ 一致 |
| INITIAL_SCORE_RANGE {80,220} / POSITIVE {20,80} / NEGATIVE {10,60} | ✅ 一致 |
| POSITIVE_PROBABILITY=0.6 / SELF=0.65 / TEAMMATE=0.62 / RESHUFFLE=0.35 | ✅ 一致 |
| STAGES 7 个景区的 id/code/name/hot/income/online/image | ✅ 一致（前端多 video/theme/titleColor 字段，后端无——`resolveStage` 有兜底，安全） |
| ROBOT_NAMES / HUMAN_NAMES / AVATAR_POOL | ✅ 一致 |

### 5.2 商城商品目录（✅ 一致）

程序化比对 `utils/shop-store.js GOODS` vs `back/src/services/shop-service.js GOODS`：34 项（15 皮肤 + 12 宠物 + 7 光环），id/name/price/category 全部一致，0 差异。

### 5.3 已确认的漂移/隐患点

| # | 问题 | 位置 | 等级 |
|---|---|---|---|
| 1 | **维护模式失效**：后端 `system.maintenance_mode` 配置、`getPublicConfigs().features.maintenance` 已实现；前端 `runtime-config.js` 虽然拉取 configs，但 8 个页面没有任何代码消费 maintenance → 运营开启"维护模式"用户无感知 | `utils/runtime-config.js` L21-22 vs pages/*（grep 0 引用） | 🟠中 |
| 2 | **房间码 join 契约断层**：后端有 `GET/POST /api/rooms/code/:code/join`，前端 `initRoom` 只用 `/rooms/${inviteRoomId}/join`（`pages/room/index.js` L266），分享出去的 `roomId` 是房间码字符串时被 MySQL 隐式转换为数值 id → 可能加入错误房间或 404 | `back/src/routes/rooms.js` L85-95 vs `pages/room/index.js` L266 | 🟠中 |
| 3 | **死代码双份实现**：`utils/arena-realtime.js`（connect/disconnect/reconnect 封装）无任何页面引用，arena 页自己内联了一套 `buildArenaRealtimeUrl`/`parseRealtimePayload`；`back/src/socket/native-arena-ws.js` 无任何引用（app.js 用的是 arena-realtime.js hub）→ 三套 WebSocket 逻辑并存，修 bug 容易改错地方 | grep 全仓库确认 | 🟡低 |
| 4 | **WX_APPID 三处不一致**：小程序 project.config.json=`wx72a4b552a87b44cf`，`.env.example` 同；`back/.env` 与 `back/src/config/index.js` L42 默认=`wxd7f500f3f21f15dd` → 上线配置一旦漏设，登录全挂 | 见 1.4 | 🔴高 |
| 5 | **后端内部常量重复**：`room-service.js` L4-7 手抄 MIN_PLAYERS/MAX_PLAYERS/GAME_DURATION_SECONDS/INITIAL_SCORE_RANGE，而不是 require `game-engine/constants` → 后端内部二次漂移源 | `back/src/services/room-service.js` | 🟡低 |
| 6 | **在线模式福袋/投资功能空转**：`pages/arena/index.js` L921 `scheduleNextBagDrop` 依赖 `gameStore.getState().status === 'playing'`，在线局（sessionId 模式）gameStore 恒为 idle → 福袋永不掉落；`onConfirmOpportunity` L821-832 里 `gameStore.applyPlayerScoreDelta` 也因 status 非 playing 而 no-op（钱照扣、分不加）→ 在线局的投资体系实际不可用，与界面展示矛盾 | `pages/arena/index.js` | 🟠中 |
| 7 | **在线局退出路径**：`toResult`/switchTab 直接调 `gameStore.finishGame()`（L389-396），在线模式下会对空状态造一条 resultId 的本地空结算记录写入 player-stats（income 页出现一条 0 收益"对局结算"），而服务端对局仍在继续并在结束后正常发奖 → 用户中途退出的行为与奖励不一致 | `pages/arena/index.js` L390-397 | 🟡低 |
| 8 | **结果页在线模式下分数明细为零**：`onTapPlayer` 从本地 gameStore 的 `scoreBreakdownMap` 取数（L568-575），在线局本地无此数据 → 弹窗四行全 0 | `pages/result/index.js` | 🟡低 |

---

## 6. 依赖与工程卫生

### 6.1 根 package.json 无 dependencies（🟢）

- `package.json` 无任何依赖/开发依赖，`npm test` 用 Node 内置 `node:test`；tests 里 require 的 utils 模块均为纯 JS（wx 由测试 mock），无隐藏三方依赖。健康。
- 后端依赖集中且合理：express/helmet/morgan/cors/jsonwebtoken/bcryptjs/mysql2/socket.io/ws/uuid/multer/dotenv。无 axios 等冗余（auth-service 用内置 https，fortune 用内置 fetch）。

### 6.2 npm audit：10 漏洞 / 3 高危（🟠中）

`cd back && npm audit` 实测结果：

| 包 | 版本 | 严重度 | 问题 |
|---|---|---|---|
| ws（直接依赖 ~8.18.3） | 8.0.0-8.20.1 | 🔴 high | 未初始化内存泄露（GHSA-58qx-3vcg-4xpx）+ 小分片内存耗尽 DoS（GHSA-96hv-2xvq-fx4p），fix 需升 8.21.3（超出 ~8.18.3 范围） |
| multer | 1.0.0-2.1.1 | 🔴 high | 嵌套字段名 DoS + 中止上传清理不完整（GHSA-72gw-mp4g-v24j / GHSA-3p4h-7m6x-2hcm） |
| socket.io-parser | 4.0.0-4.2.6 | 🔴 high | 零附件内存耗尽（GHSA-2m8v-j782-fhvr） |
| brace-expansion | 3.0.0-5.0.8 | 🔴 high（传递） | 指数级展开 DoS |
| body-parser（express 传递） | <1.20.6 | 🟠 moderate | 非法 limit 值静默关闭大小限制 |
| qs（express 传递） | 6.11.1-6.15.1 | 🟠 moderate | 远程触发 DoS |
| morgan | 1.2.0-1.10.1 | 🟠 moderate | 日志伪造（:remote-user 控制字符） |
| uuid | <11.1.1 | 🟠 moderate | v3/v5/v6 缓冲区越界（fix 需升 14.x，breaking） |

- 备注：socket.io-parser 的零附件内存耗尽需要攻击者能建立 socket 连接（本项目 ws/arena 有 JWT 校验，但 token 本身可从任意登录用户获取——注册即攻击面）。
- 建议：`npm audit fix`（可自动修复多数传递依赖）→ 手动把 ws 升到 8.21.x、multer 升到 2.x 最新、socket.io 升到 4.8+；上线前锁 `package-lock.json` 并纳入 CI 的 `npm audit --audit-level=high` 门禁。

### 6.3 git 仓库卫生（🟠中）

| 问题 | 证据 |
|---|---|
| `back/.env` 被跟踪（含疑似真实 WX_SECRET、admin123） | `git ls-files` 命中 `back/.env`，提交 dd8a794 |
| 根 .gitignore 未忽略 `.env`（只忽略 `.env.local`）、back/ 无 .gitignore | `.gitignore` 内容 |
| 11 个 `.DS_Store` 被跟踪（根/各 assets/docs 目录） | `git ls-files` 命中 11 条 |
| 构建产物 `back/admin-web/dist/`（3 个文件）被跟踪 | `git ls-files back/admin-web/dist` = 3 |
| 工具目录 `.i18n_work/`、`.sisyphus/`、`.superpowers/`、`素材/` 共 34 个文件被跟踪 | `git ls-files` 统计 |
| `node_modules/` 未被跟踪 ✅ | grep 0 命中 |
| 工作区有未提交变更（含 `tests/remote-assets.test.js` 未跟踪） | `git status` |

建议：上线前做一次仓库瘦身 + `git filter-repo` 清除 .env 历史；补充 `.gitignore`（`.env`、`back/.env`、`back/uploads/`、`back/admin-web/dist/`）；轮换所有已泄露密钥。

---

## 7. 修复优先级清单（建议上线前必做 vs 可延后）

**上线前必做（P0）**：
1. .env 出库 + 轮换 WX_SECRET/密码 + 核对 AppID（1.4 / 5.3-4）
2. 在线对局重启丢失的兜底（2.1：games/:id 返回失效状态 + 前端跳转提示）
3. finishGame 事务化 + 幂等（2.2）
4. buyItem affectedRows 检查（2.5）
5. 管理后台登录限速/强密码（1.3）
6. game-store 恢复完整性校验（2.8）
7. ws/multer/socket.io 高危漏洞升级（6.2）

**上线后首周迭代（P1）**：开局/加入竞态（2.3/2.4）、api-client 超时+重试（1.1）、维护模式前端接入（5.3-1）、在线局福袋/投资（5.3-6）、buyViaApi 双扣（2.6/2.7）、房间码 join 路由（5.3-2）、补关键测试（4.4）。

**可延后（P2）**：音频 URL 编码（1.5）、时区格式化（3.3）、progression 上限（3.2）、死代码清理（5.3-3）、每秒写存储降频（2.9）、仓库瘦身（6.3）。

---

*分析方式说明：本报告所有行号均为分析时实际代码的行号；"实测"项均在本地执行验证。本报告仅做分析，未修改任何代码文件。*
