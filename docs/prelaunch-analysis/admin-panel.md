# 管理后台（Admin Panel）产品完整性分析

> 分析范围：`back/admin-web/`（Vue3 + Element Plus + Vite）、`back/src/routes/admin/*`、`back/src/services/admin-*-service.js`、`back/src/middleware/admin-auth.js`、`back/src/middleware/operation-logger.js`，并交叉核对 `back/src/app.js`、`back/src/routes/index.js`、`back/src/services/{auth,room,game,wechat-pay}-service.js`、`back/sql/*.sql`、`back/.env`、小程序端 `utils/runtime-config.js`。
> 分析方式：逐一阅读全部 13 个 admin 路由文件、9 个 admin service、2 个中间件、14 个 Vue 视图，程序化比对「后端端点 ↔ 前端调用」全量映射，并用一次临时目录构建验证 `src` 可编译性与 `dist` 新旧差异。
> 结论先行：**后端接口与前端页面基本一一对应、无「前端调用不存在的 API」的悬空问题**；但存在 **1 个可被公开接管的后台自举后门 + 登录爆破无防护、封禁不生效、RBAC 形同虚设、强制关闭房间无效、操作日志几乎不记录、公告无消费端、支付订单无任何后台入口、dist 构建过期** 等重大缺口。风险统计：🔴 高 12 项，🟠 中 10 项，🟡 低 6 项。

---

## 一、功能覆盖：后端接口 ↔ 管理后台页面 全量比对

### 1.1 比对方法

对 `src/routes/admin/*.js` 的所有 `router.get/post/put/delete` 端点（共 51 个）与 `admin-web/src` 所有视图中的 `request.*('/api/admin/...')` 调用（含模板字符串动态路径）做双向比对，结果如下。

### 1.2 后端有接口但管理后台无页面/无调用（🟡 低，半成品死代码）

| 端点 | 位置 | 前端调用情况 |
|---|---|---|
| `GET /api/admin/configs/:key`、`PUT /api/admin/configs/:key` | `routes/admin/configs.js:41-67` | 无。SystemConfig.vue 只用 `GET /configs`、`GET /summary`、`PUT /configs`（批量） |
| `GET /api/admin/logs/:id` | `routes/admin/logs.js:38-47` | 无。OperationLogs.vue 只调 `/logs/stats` 和 `/logs` |
| `GET /api/admin/admins/:id` | `routes/admin/admins.js:12-15` | 无。AdminList.vue 只调列表/增删改 |
| `GET /api/admin/items/:id`、`PUT /api/admin/items/:id/toggle` | `routes/admin/items.js:17-26, 60-68` | 无。ItemList.vue 只调 `GET /items`、`POST`、`PUT /:id`、`DELETE /:id` |
| `GET /api/admin/announcements/:id` | `routes/admin/announcements.js:22-31` | 无。AnnouncementList.vue 只调列表/增删改/发布/归档 |

另有 2 个 service 能力**根本没有路由暴露**：

- `admin-config-service.js:203-233` 的 `exportConfigs()` / `importConfigs()`——配置导入导出已写好但无路由接线，数据导出能力缺失（见 2.7）。
- `admin-config-service.js:295-293` 之外，`updateConfig()` 支持任意 key 写入，但批量接口 `routes/admin/configs.js:27-39` 只校验 `configs` 是非空数组，**不校验 key 是否在 `CONFIG_DEFINITION_MAP` 中**（与 `importConfigs` 的过滤逻辑不一致），可写入垃圾 key 污染配置表。

### 1.3 管理后台有入口但后端缺接口

**未发现**。前端所有 31 个 API 调用（含 `PUT /api/admin/users/:id/ban`、`/coins`、`PUT /api/admin/rooms/:id/close`、`POST /api/admin/fortune/refresh` 等）均在后端有真实实现。

但存在一类「**页面有入口、后端有接口、功能却是死的**」的隐性缺口（接口存在但无效/无消费端），分别见 2.1 公告、2.2 封禁、2.3 房间干预、2.8 操作日志、2.9 维护模式。

### 1.4 Dashboard 统计是否够用（🟠 中）

`dashboard-service.js` 只返回 4 个数字：`totalUsers`（累计用户）、`todayGames`（今日开局数）、`activeRooms`（`rooms.status='playing'` 计数）、`todayRevenue`（今日 `coin_records.amount>0` 求和）。三个问题：

1. **`activeRooms` 永远失真**：`game-service.js:finishGame()`（395-440 行）结束对局时只把 `game_sessions` 置为 `finished`，**从不回写 `rooms.status`**；全仓只有 `admin-room-service.js:61`（管理员手动关房）会把房间置为 `finished`。因此房间一旦开局就永远是 `playing`，Dashboard 的「进行中房间」和 RoomList 的状态栏都会显示大量早已结束的房间。
2. **「近 7 日运营概览」实为全量数据**：`Dashboard.vue:637` 调 `GET /api/admin/stats/overview` 只传 `{ limit: 7 }`，而 `routes/admin/stats.js:8` 的接口只认 `from/to`，默认 `1970-01-01 ~ 2099-12-31`。图表标题写「近 7 日」，实际画的是**全部历史**趋势；「较前一日」环比也算的是全量序列的最后两点。
3. **`todayRevenue` 不是真实收入**：`coin_records` 包含 `admin_adjust`（管理员调币，`admin-user-service.js:60` 写入）、签到奖励、对局收益等所有正数流水，且是游戏内金币而非人民币；`payment_orders`（006 SQL）里的真实支付订单完全没有进入统计。管理员给自己调 100 万金币，Dashboard 收入曲线立刻 +100 万。

建议：dashboard 增加今日 DAU/在线人数（socket 连接数）、支付订单金额（RMB）、7 日留存趋势、异常项（被举报/封禁数）；`stats/overview` 支持 `limit` 或 Dashboard 显式传 `from/to`；`finishGame` 回写房间状态；收入统计区分「金币流水」与「支付订单」。

---

## 二、运营必需功能缺失清单

### 2.1 公告管理：后台能发布，但**没有任何消费端**（🔴 高）

- 后台侧完整：`routes/admin/announcements.js` 提供列表/详情/创建/更新/删除/发布/归档 7 个接口，AnnouncementList.vue 全部接上，可用。
- 但全仓搜索：`routes/index.js` 没有面向小程序的 announcements 路由；小程序端 `pages/`、`utils/` 中 **0 处** 引用「公告/announcement」。`/api/configs/public`（`admin-config-service.js:235-259`）只返回 features/maintenance，不含公告。
- 后果：运营发布的公告**永远没人能看到**，这是上线前必须补的功能断头路。
- 修复：新增 `GET /api/announcements`（公开，仅返回 `status='published'` 的记录），小程序 home 页拉取并展示弹窗/跑马灯。

### 2.2 用户封禁：**封了等于没封**（🔴 高）

- `admin-user-service.js:47-51` `toggleBan()` 只写 `users.is_banned/banned_reason`。
- 全后端唯一读取 `is_banned` 的地方是 `stats-service.js:146`（排行榜排除封禁用户）。`auth-service.js:login()`（90-127 行）**登录时不检查封禁**、`auth.js` 中间件不检查、`room-service.js` 建房/加房不检查——被封用户可正常登录、建房、开局、领币。
- 且已签发的用户 JWT（7 天）在封禁后依然有效，没有任何撤销机制。
- 修复：在 `auth.js` 中间件或登录/建房入口查 `is_banned` 并拒绝（403「账号已被封禁」）；封禁接口需同步踢下线（至少让 token 失效，可加 `users.token_version` 或短期缓存黑名单）。
- 「禁言」需求：本项目无文字聊天（只有 emote），禁言暂不适用；但 emote 刷屏、昵称违规同样没有处理手段，建议至少支持「踢出房间」。

### 2.3 房间/对局干预：**强制关闭只是改了个数据库字段**（🔴 高）

- `admin-room-service.js:59-65` `forceCloseRoom()`：`UPDATE rooms SET status='finished'` 后直接返回。
- 实际对局状态在 `game-service.js` 的**内存 `activeGames` Map** 中，由 `startTickLoop()` 每秒 tick 驱动。强制关房：
  - 不清理 `activeGames`、不清 interval，**对局照常跑完 180 秒并结算发币**；
  - 不向 `arena:{sessionId}` 的 socket 房间下发任何事件，玩家毫无感知，继续操作；
  - `game_sessions` 行仍是 `playing`，GameList「进行中」依旧显示；
  - 结算写入（`finishGame`）不依赖 rooms 状态，所以关房后玩家**仍正常拿到收益**——干预完全无效。
- 同时**没有「查看实时对局」能力**：GameList/GameDetail 只读数据库快照（玩家初始分/最终分），看不到进行中的分数、回合、在线人数；后端内存态 `getGameState()` 只在用户侧 `/api/games/:id`（需 userId 的 token）暴露。
- 修复：新增 `admin-game-service.forceFinishSession(sessionId)`：调用 `gameService.getActiveGame()` → `clearInterval` → 广播 `game_finished`（可带 `aborted:true`）→ 回写 `game_sessions/rooms` 状态；新增 `GET /api/admin/games/active` + `GET /api/admin/games/:id/live` 输出 `getGameState()` 的实时快照；RoomList/GameList 增加「强制结束」「查看实时」按钮。

### 2.4 支付订单查询/退款：**完全缺失**（🔴 高）

- `payment_orders` 表已建（`sql/006_wechat_payment_orders.sql`），`wechat-pay-service.js` 有下单/查单（`queryWechatOrder`，273 行）/发货/回调，但 `routes/admin/` 下**没有任何 payments 相关路由**，admin-web 也无一页提及订单。
- 无退款能力（全仓 grep `refund` 为 0）；运营遇到「用户充值没到账/误购」只能直接改 `user_items` 或手工调币，无法对账、无法退款。
- 修复：新增 `routes/admin/payments.js`（订单列表/详情/手动同步微信状态/补发/退款）+ 后台「支付订单」页面；退款需在 wechat-pay-service 增加申请退款 APIv3 接口与退款流水表。

### 2.5 商品上下架：**部分可用**（🟡 低）

- ItemList.vue 支持新增/编辑/删除；后端 `PUT /items/:id/toggle`（上/下架切换）存在但前端没接按钮——「下架」只能靠编辑弹窗里改 `is_active`（`admin-item-service.js:101-119` 允许改）或删除（软删 `is_active=0`）。
- 另注意 `listItems()` 只返回 `is_active=1` 的行（`admin-item-service.js:47`），**已下架商品在后台列表里直接消失**，无法在后台看到/重新上架（toggle 接口因此在前端没法用）。
- 修复：列表接口支持 `status` 过滤或返回全部并标记状态，前端加「上架/下架」开关按钮。

### 2.6 数据导出：**缺失**（🟠 中）

- 全后台没有任何 CSV/JSON 导出入口；`exportConfigs()` 已实现但无路由（见 1.2）。用户列表、对局、支付订单、操作日志都只能翻页在线看。
- 修复：给 configs 接线 export/import 路由（需二次确认敏感字段导出策略）；为 users/games/logs/payments 增加 `?format=csv` 导出或前端导出当前筛选结果。

### 2.7 操作日志查看：页面有，**数据几乎是空的**（🔴 高，详见 3.3）

OperationLogs.vue 页面完整（筛选/统计/详情），但后端只有 fortune 模块 3 处会写日志，其余 90% 的运营操作不落库，页面打开就是空表。

### 2.8 维护模式：**配置存在但零执行**（🟠 中）

- `system_configs` 有 `system.maintenance_mode/message`，`/api/configs/public` 也返回 `features.maintenance`，小程序 `utils/runtime-config.js` 也拉取了这份配置，**但小程序所有页面没有任何地方判断 maintenance_mode 并拦截**（全仓 grep 0 命中）。运营切了维护模式，用户照样进游戏。
- 修复：小程序 `app.js`/home 页读取 `maintenance.enabled`，为真时全屏提示 `maintenance.message` 并阻断业务请求；后端可在 `auth.js` 加白名单外的统一 503。

---

## 三、权限体系

### 3.1 管理员角色分级：**表里有两级，服务端零强制**（🔴 高）

- 数据层：`sql/001_create_tables.sql:33` `role ENUM('super','normal')`；前端 `stores/auth.js:17` 有 `isSuper` getter，但**全 admin-web 没有任何地方用 `isSuper` 隐藏菜单/按钮**，`AdminLayout.vue` 的 menuItems 对所有人渲染全部 11 个菜单。
- 服务端：`admin-auth.js` 只验签 JWT，**所有 51 个端点没有一处检查 `req.admin.role`**。普通运营（role=normal）实际拥有全部能力：
  - `admins.js` 创建/删除/重置任意管理员密码（含把别人改成 super、把 super 停用）；
  - `configs.js` 读取/改写**全部密钥**（AppSecret、支付 APIv3 Key、商户私钥 PEM、AI API Key——`GET /api/admin/configs` 明文返回所有 `config_value`，`admin-config-service.js:116-123` 无脱敏）；
  - `users.js` 封禁任意用户、调整任意金额金币（`adjustCoins` 上限仅前端 `el-input-number` 的 999999，后端无上限校验）；
  - `fortune.js` 修改数据源地址（SSRF 入口，见 5.6）。
- 修复：`admin-auth.js` 增加 `requireRole('super')` 中间件，套在 admins 增删改/密码重置、configs 写、金币调整等敏感端点；前端按 `isSuper` 隐藏对应菜单与按钮。

### 3.2 登录态管理（token 过期处理）

- 做得对的部分：前端 `utils/request.js:21-31` 统一 401 → `logout()` + 跳登录页；JWT 有效期 `JWT_EXPIRES_IN`（默认 7d）；后端对过期 token 返回专用提示（`admin-auth.js:30-32`）。
- 问题：
  1. **停用/删除的管理员 token 不失效**（🔴 高）：`adminAuthMiddleware` 只 `jwt.verify`，**不查 `admins.is_active`**（`admin-auth.js` 全文 0 处 SQL）。`deleteAdmin` 是软删（`is_active=0`，`admin-admin-service.js:92-95`），但被删管理员拿着旧 token 还能操作 7 天；`resetPassword` 同样不吊销旧 token。
  2. 前端路由守卫只检查「有 token」不检查是否过期（`router/index.js:119-123`），过期 token 会先进入页面、第一个请求 401 后才弹回登录页——体验瑕疵（🟡 低）。
- 修复：`adminAuthMiddleware` 每次请求查库校验 `is_active=1`（可加 30-60s 内存缓存）；重置密码/停用时主动踢出（token_version 或 jti 黑名单）；前端守卫解码 exp 提前拦截。

### 3.3 操作日志（operation-logger）覆盖范围

- 机制：`operation-logger.js` 提供 `logOperation()` 和 `operationLogger()` 中间件工厂，表结构完整（`003_admin_features.sql:7-21`，含 admin_id/action/target_type/target_id/detail/ip）。
- **实际接线**：全后端只有 `routes/admin/fortune.js:32,66,81` 三处调用（update/refresh 数据源、生成报告）。以下操作**全部无审计**（🔴 高）：
  - 管理员登录（`auth.js` 无日志，虽然 operation_logs 注释里写了 `login`）；
  - 创建/更新/删除管理员、重置密码（`admins.js`）；
  - 用户封禁/解封、金币调整（`users.js`）；
  - 房间强制关闭（`rooms.js`）；
  - 商品增删改/上下架（`items.js`）；
  - 公告增删改/发布/归档（`announcements.js`）；
  - 系统配置修改——含密钥修改（`configs.js`）。
- 后果：OperationLogs 页面（前端已做好 action=ban/login/delete 的标签映射）基本是空表；发生「金币被调走」「密钥被改」时无迹可查。
- 修复：给上述路由统一挂 `operationLogger(action, targetType)` 或 handler 内 `logOperation`；登录成功/失败也记录（失败记录可用于爆破预警）。

---

## 四、管理后台自身质量

### 4.1 「src 只有 4 个文件」的疑虑——已澄清：页面实现完整（✅ 无问题）

`admin-web/src` 实际结构完整：`main.js / App.vue / router/index.js / stores/auth.js / utils/request.js / components/AdminLayout.vue` + **12 个视图文件**（views/ 下 Dashboard、Login、users×2、items、games×2、stats、announcements、configs、admins、rooms、logs、fortune 共 14 个 .vue，约 5000 行）。页面实现都在 `src/views/*`，不在 router 里内联，也没有缺失页面。当前 `src` 可正常构建（实测 `vite build` 3.6s 成功）。

### 4.2 dist 构建产物**已过期**（🔴 高）

- 证据链：
  1. `back/src/app.js:36-42` 线上后台直接伺服 `admin-web/dist`（`/admin` 路径），**dist 是实际生效的产物**；
  2. `dist/assets/index-DHk366mg.js` 中仍含旧 AppID `wx742cfddc2b05ccd4`（grep 命中 3 次）；
  3. 当前 `src/views/Dashboard.vue:187` 与 `SystemConfig.vue:228` 已改为 `wxd7f500f3f21f15dd`（`git status` 显示这两个文件是未提交修改，dist 未重建）；
  4. 临时目录重建当前 src 后，产物中为新 AppID（3 次命中），证明 dist 落后于 src。
- 后果：后台页面展示的微信配置默认值与后端 `.env`/小程序实际 AppID 不一致，运营看到的是旧数据；且未来任何 src 修复若不重建都不生效。
- 修复：上线前 `npm run build` 重建 dist 并提交；在 CI/部署脚本里加「src 变更后强制 build」或构建校验（对比 dist 与 src 的 git 状态）。

### 4.3 前端其它质量问题

- **新管理员默认密码硬编码 `123456`**（🟠 中）：`AdminList.vue` `data.password = form.password || '123456'`，创建账号弹窗密码可留空即得弱密码；后端 `admins.js:17-22` 只查「非空」不查复杂度。
- **删除管理员无二次确认、无自保护**（🟠 中）：`AdminList.vue` handleDelete 直接调接口；后端 `admin-admin-service.js:92-95` 不阻止删除自己/最后一个 super。
- **列表页暴露 openid**：`admin-user-service.js:10` `SELECT * FROM users`，presenter 原样展开返回（🟡 低，PII 面扩大）。
- **无 v-html/innerHTML**（✅）：公告内容、配置值等均用插值渲染，后台自身暂无存储型 XSS 面。
- 分页、加载态、错误提示（ElMessage）整体规范；`routes/admin/index.js:3-9` 用 try/catch 静默跳过加载失败的路由模块（`console.warn`），路由文件一旦写错语法，整个模块**无声下线**且健康检查不报错（🟡 低）。

---

## 五、安全问题

### 5.1 管理员自举后门 + 默认凭据入库（🔴 高）

- `routes/admin/auth.js:11-22` `ensureBootstrapAdmin()`：**每次登录请求**都会执行——只要 `admins` 表为空、且提交的用户名密码等于 `config.admin.username/password`，就直接创建 **role=super** 的管理员。
- `back/.env` **已提交进 git**（`git ls-files` 确认），内含：
  ```
  ADMIN_USERNAME=admin
  ADMIN_PASSWORD=admin123
  JWT_SECRET=change-this-to-random-secret-in-production
  WX_SECRET=ae021a2cd4bd79317a71bce959ce7cb9   ← 真实 AppSecret
  ```
- 组合后果：任何拿到仓库的人（或任何猜到 `admin/admin123` 的人）在 admins 表为空的新环境上打一次登录接口，就成为超级管理员；且真实小程序 AppSecret 已随仓库泄露。`tests/security-config.test.js` 只检查了**源码**不含 `admin123`，没检查提交的 `.env`——安全测试绿灯但实际裸奔。
- 修复：立即轮换 WX_SECRET；把 `.env` 加入 `.gitignore` 并从历史中清除（`git rm --cached` + 改密）；删除/改造自举逻辑——改为一次性 CLI 脚本（`npm run admin:init`）且强制改密；`requireProductionEnv` 已能保证生产必须有 ADMIN_PASSWORD，但需同时强制「非默认值」。

### 5.2 登录爆破无任何防护（🔴 高）

- `POST /api/admin/auth/login` 无验证码、无失败计数、无锁定、无 IP 限速；全仓无 `express-rate-limit` 依赖（`back/package.json` 无）。admin 登录接口直接挂在公网 Express 上（`app.js:30` `/api` 与 `/admin` 静态同源部署）。
- 修复：引入 `express-rate-limit`（按 IP + 用户名维度，如 5 次失败锁 15 分钟）；记录失败登录到 operation_logs；生产建议在 Nginx/网关层加基础防护；可选加图形验证码。

### 5.3 管理员 token 停用后仍有效 / 同一 JWT 密钥签发两类 token（🔴 高 / 🟠 中）

- 停用不失效：见 3.2。
- `config/index.js:52-55` 用户与管理员共用 `config.jwt.secret`；`admin-auth.js:20-21` 注释也自认「暂用同一密钥」。后果：**管理员 token 能通过用户侧 `auth.js` 中间件**（`auth.js:19-27` 只验签不查 `userId` 是否存在）——拿到 admin token 者可调 `/api/user/*`、`/api/payments/wechat/jsapi` 等用户接口（`req.user.userId` 为 undefined，部分接口可能异常或越权行为不可预期）；反之用户 token 因无 `adminId` 会被 adminAuth 拒绝（方向安全）。生产应拆分 `ADMIN_JWT_SECRET`。

### 5.4 前端硬编码检查（🟡 低）

- admin-web 源码中无密钥硬编码；仅 `Dashboard.vue:187`、`SystemConfig.vue:228` 硬编码了 AppID 作为降级默认值（AppID 非机密，可接受，但建议改为后端回退或统一常量）。
- dist 中残留旧 AppID（见 4.2）属于一致性风险。

### 5.5 敏感配置明文回传所有管理员（🔴 高，RBAC 缺失的放大面）

`GET /api/admin/configs` 返回全部 `config_value`：AppSecret、支付 APIv3 Key、**商户私钥 PEM 全文**（`wechat.pay_private_key`）、AI API Key。任何 normal 角色管理员打开「系统配置」页即可读取（前端 `valueType='password'` 只是遮显，值在 DOM/网络响应中明文）。修复：敏感字段默认脱敏（`***`），单独提供「查看/导出」接口并限定 super + 写审计日志。

### 5.6 服务端 SSRF：管理员可改数据源 URL（🔴 高）

`fortune-reality-service.js:480-518` `updateSource()` 允许任意修改 `endpoint_url`；`fetchWithTimeout()`（530-543 行）用全局 `fetch` 直接请求该 URL，并由后台定时任务（`jobs/fortune-reality-job.js` + 手动「刷新」按钮）触发。无协议/域名白名单、无内网地址校验 → 任意管理员可让服务器请求 `http://169.254.169.254/...`、`http://127.0.0.1:3306` 等内网地址，探测内网/云元数据。修复：限定 `https://` + 域名白名单；解析 DNS 后校验目标 IP 非私网/环回段；refresh 前做 URL 校验。

### 5.7 其他

- CORS/helmet 已合理配置（`app.js:19-20`，`config/index.js:24-38` 生产无 CORS_ORIGIN 时禁用跨域），✅。
- 金币调整后端无金额上限、无二次校验（前端 `el-input-number` 限制可绕过，`routes/admin/users.js:27` `Number(req.body.amount)||0` 直接入库），建议后端加 `|amount| <= 100000` 上限与审批记录（🟠 中，已并入 3.3 审计缺口）。
- `.env.example`（`wx72a4b552a87b44cf`）与 `.env`/`project.config.json`（`wxd7f500f3f21f15dd`）AppID 不一致，且 `AGENTS.md` 记录的是第三种 AppID——文档与配置漂移（🟡 低）。

---

## 六、修复优先级 TOP 10

| # | 问题 | 风险 | 修复动作 |
|---|---|---|---|
| 1 | 自举后门 + `.env`（admin/admin123、真实 WX_SECRET）入库 | 🔴 | 轮换密钥、.env 出库、删除登录自举、CLI 初始化+强制改密 |
| 2 | 封禁用户不生效（登录/建房/结算全不校验，token 不吊销） | 🔴 | auth/room 入口校验 is_banned，封禁即踢下线 |
| 3 | RBAC 零强制：normal 管理员可删改管理员、读改全部密钥、任意调币 | 🔴 | 服务端 requireRole 中间件 + 敏感字段脱敏 + 前端按角色隐藏 |
| 4 | 强制关闭房间无效（只改 rooms 表，内存对局继续结算发币） | 🔴 | forceFinishSession：停 timer + 广播 + 回写状态；补实时对局查看 |
| 5 | 操作日志仅覆盖 fortune 3 处，封禁/调币/改配置/管理员增删全无审计 | 🔴 | 全路由接 operationLogger；登录成败也记录 |
| 6 | 公告发布无消费端，小程序永远看不到 | 🔴 | 新增公开公告接口 + 小程序展示 |
| 7 | 支付订单无后台查询/对账/退款 | 🔴 | 新增 admin payments 路由与页面 + 退款 API |
| 8 | dist 过期：线上后台是旧构建（旧 AppID 残留） | 🔴 | 重建并提交 dist，CI 强制校验 |
| 9 | 登录无爆破防护 + 停用管理员 token 7 天内仍有效 + 双端共用 JWT 密钥 | 🔴 | rate-limit/锁定；adminAuth 查 is_active；拆分 ADMIN_JWT_SECRET |
| 10 | SSRF：管理员可把数据源 URL 指向内网 | 🔴 | URL 白名单 + 私网 IP 校验 |

**次优先（🟠）**：finishGame 回写房间状态（否则 activeRooms 恒失真）；Dashboard「近 7 日」改真 7 日；维护模式在小程序落地；游戏类配置（round_duration/min_players 等）要么接线要么从后台移除；管理员默认密码 123456 与无自保护删除；金币调整上限；数据导出接线。

**收尾（🟡）**：6 个未接线端点（configs/:key、logs/:id、admins/:id、items/:id、items/:id/toggle、announcements/:id）补齐页面或删除；批量配置写 key 白名单校验；openid 最小化返回；`.env.example`/AGENTS.md 的 AppID 对齐；admin 路由加载失败改为 fail-fast。
