# 锦鲤前程 — 后端计划书 v2

## 一、架构总览

```
┌──────────────────────┐      ┌───────────────────────────────────┐
│  微信小程序前端       │      │    后端服务 (back/)                 │
│  (pages/utils/*.js)  │◄────►│  Node.js + Express + Socket.IO     │
│                      │REST+ │                                    │
│  改造后：             │WebSkt│  ┌──────────┐  ┌───────────────┐  │
│  - wx.request → API  │      │  │ REST API │  │ Admin Panel   │  │
│  - 真实玩家对战       │      │  │ /api/*   │  │ /admin/*      │  │
└──────────────────────┘      │  │          │  │ Vue3+Element  │  │
                              │  └────┬─────┘  └───────┬───────┘  │
┌──────────────────────┐      │       │                  │         │
│  后台管理系统 Web     │      │  ┌────┴──────────────────┴─────┐  │
│  Vue 3 + Element Plus │◄───►│  │        MySQL 数据库           │  │
│  /admin/*             │REST  │  └──────────────────────────────┘  │
└──────────────────────┘      └───────────────────────────────────┘
```

## 二、技术选型

| 选型 | 理由 |
|------|------|
| **Node.js** | 与前端同语言，game-engine.js 可直接复用 |
| **Express** | 用户指定 |
| **Socket.IO** | 对局 3秒/轮 实时广播，REST 轮询延迟不可接受 |
| **MySQL** | 用户指定 |
| **mysql2** | Promise 支持 |
| **jsonwebtoken** | JWT 鉴权 |
| **bcryptjs** | 管理员密码哈希 |
| **Vue 3 + Element Plus** | 后台管理系统，用户指定 |
| **Vite** | Vue 3 构建工具 |
| **dotenv** | 环境变量管理 |
| **cors / helmet / morgan** | Express 标准中间件 |

## 三、环境变量 .env

```
# 服务
PORT=3000
NODE_ENV=development

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=game_codex

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=7d

# 微信小程序
WX_APPID=wx72a4b552a87b44cf
WX_SECRET=your-wx-secret

# 管理员种子账号
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

## 四、数据库设计（共 10 张表）

### 4.1 users — 用户表

```sql
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  openid        VARCHAR(64) NOT NULL UNIQUE,
  nick_name     VARCHAR(64) NOT NULL DEFAULT '微信用户',
  avatar_url    VARCHAR(512) NOT NULL DEFAULT '',
  level         INT UNSIGNED NOT NULL DEFAULT 1,
  total_exp     INT UNSIGNED NOT NULL DEFAULT 0,
  total_income  INT UNSIGNED NOT NULL DEFAULT 0,
  coins         INT UNSIGNED NOT NULL DEFAULT 8820,
  game_count    INT UNSIGNED NOT NULL DEFAULT 0,
  win_count     INT UNSIGNED NOT NULL DEFAULT 0,
  is_banned     TINYINT(1) NOT NULL DEFAULT 0,
  banned_reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_created (created_at DESC)
);
```

### 4.2 admins — 管理员表

```sql
CREATE TABLE admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super','normal') NOT NULL DEFAULT 'normal',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 rooms — 房间表

```sql
CREATE TABLE rooms (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_code     VARCHAR(10) NOT NULL UNIQUE,
  stage_id      INT UNSIGNED NOT NULL,
  status        ENUM('waiting','playing','finished') NOT NULL DEFAULT 'waiting',
  host_user_id  INT UNSIGNED NOT NULL,
  max_players   TINYINT UNSIGNED NOT NULL DEFAULT 10,
  current_players TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME NULL,
  INDEX idx_status (status),
  INDEX idx_room_code (room_code)
);
```

### 4.4 room_players — 房间玩家表

```sql
CREATE TABLE room_players (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id       INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  seat          TINYINT UNSIGNED NOT NULL,
  is_ready      TINYINT(1) NOT NULL DEFAULT 0,
  is_host       TINYINT(1) NOT NULL DEFAULT 0,
  joined_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_room_user (room_id, user_id)
);
```

### 4.5 game_sessions — 对局表

```sql
CREATE TABLE game_sessions (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id       INT UNSIGNED NOT NULL,
  stage_id      INT UNSIGNED NOT NULL,
  status        ENUM('playing','finished') NOT NULL DEFAULT 'playing',
  duration      INT UNSIGNED NOT NULL DEFAULT 180,
  round_count   INT UNSIGNED NOT NULL DEFAULT 0,
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME NULL,
  INDEX idx_room (room_id),
  INDEX idx_status (status),
  INDEX idx_started (started_at DESC)
);
```

### 4.6 game_players — 对局玩家表

```sql
CREATE TABLE game_players (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id    INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  seat          TINYINT UNSIGNED NOT NULL,
  team_id       VARCHAR(20) NULL,
  initial_score INT UNSIGNED NOT NULL DEFAULT 0,
  final_score   INT UNSIGNED NOT NULL DEFAULT 0,
  rank          TINYINT UNSIGNED NULL,
  coins_earned  INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uk_session_user (session_id, user_id)
);
```

### 4.7 game_rounds — 回合记录表

```sql
CREATE TABLE game_rounds (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id    INT UNSIGNED NOT NULL,
  round_num     INT UNSIGNED NOT NULL,
  events_json   JSON NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_round (session_id, round_num)
);
```

### 4.8 game_results — 对局结果表

```sql
CREATE TABLE game_results (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id    INT UNSIGNED NOT NULL UNIQUE,
  result_json   JSON NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 4.9 user_items — 用户物品表

```sql
CREATE TABLE user_items (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  item_id       VARCHAR(64) NOT NULL,
  category      ENUM('skin','pet') NOT NULL,
  is_equipped   TINYINT(1) NOT NULL DEFAULT 0,
  acquired_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_item (user_id, item_id)
);
```

### 4.10 coin_records — 金币流水表

```sql
CREATE TABLE coin_records (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  amount        INT NOT NULL,
  balance_after INT UNSIGNED NOT NULL,
  type          VARCHAR(32) NOT NULL,
  title         VARCHAR(128) NOT NULL DEFAULT '',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, created_at DESC)
);
```

> 增加 `admins` 表；`users` 增加 `is_banned`、`banned_reason`；`game_players` 增加 `coins_earned`。

## 五、微信登录完整流程

```
1. 小程序端调用 wx.login() 获取 code
2. 小程序端 POST /api/auth/login { code }
3. 服务端请求微信接口：
   GET https://api.weixin.qq.com/sns/jscode2session
     ?appid=APPID &secret=SECRET &js_code=CODE &grant_type=authorization_code
4. 微信返回 { openid, session_key }
5. 服务端查询/创建 users 表记录（按 openid）
6. 服务端生成 JWT token（payload: { userId, openid }）
7. 返回 { token, user: { id, nickName, avatarUrl, coins } }
```

## 六、REST API 设计（统一格式 `{ code, message, data }`）

### 6.1 小程序端（JWT 鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 微信 code 登录 |
| GET | `/api/user/profile` | 个人资料 |
| PUT | `/api/user/profile` | 更新昵称/头像 |
| POST | `/api/rooms` | 创建房间 |
| GET | `/api/rooms?status=waiting` | 房间列表 |
| GET | `/api/rooms/:id` | 房间详情 |
| POST | `/api/rooms/:id/join` | 加入 |
| POST | `/api/rooms/:id/leave` | 离开 |
| POST | `/api/rooms/:id/ready` | 准备 |
| POST | `/api/rooms/:id/start` | 开始（仅房主） |
| GET | `/api/games/:id` | 对局快照 |
| GET | `/api/games/:id/result` | 结算结果 |
| GET | `/api/shop/items` | 商品列表 |
| POST | `/api/shop/buy` | 购买 |
| POST | `/api/shop/equip` | 装备 |
| GET | `/api/shop/inventory` | 我的物品 |
| GET | `/api/stats/summary` | 统计摘要 |
| GET | `/api/stats/history` | 对局历史 |
| GET | `/api/leaderboard` | 排行榜 |

### 6.2 后台管理端（Admin JWT 鉴权）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 用户名密码登录 |
| GET | `/api/admin/me` | 当前管理员 |
| GET | `/api/admin/dashboard` | 仪表盘（用户/对局/收入） |
| GET | `/api/admin/users` | 用户列表（分页+搜索） |
| GET | `/api/admin/users/:id` | 用户详情+资产 |
| PUT | `/api/admin/users/:id/ban` | 封禁/解封 |
| PUT | `/api/admin/users/:id/coins` | 调整金币 |
| GET | `/api/admin/items` | 商品列表 |
| POST | `/api/admin/items` | 新增商品 |
| PUT | `/api/admin/items/:id` | 编辑商品 |
| DELETE | `/api/admin/items/:id` | 删除商品 |
| GET | `/api/admin/games` | 对局列表 |
| GET | `/api/admin/games/:id` | 对局详情 |
| GET | `/api/admin/stats/overview` | DAU/收入曲线 |
| GET | `/api/admin/stats/top-players` | 排行 TOP N |

## 七、Socket.IO 实时事件

### 客户端 → 服务端

| 事件 | 数据 | 说明 |
|------|------|------|
| `join_arena` | `{ sessionId }` | 进入对局房间 |
| `leave_arena` | — | 离开 |
| `emote` | `{ emoteId }` | 发送表情 |

### 服务端 → 客户端

| 事件 | 数据 | 说明 |
|------|------|------|
| `game_state` | 完整快照 | 进入时发送 |
| `game_tick` | `{ timeLeft, round, events, players, teams }` | 每秒同步 |
| `score_update` | `{ playerId, score, delta }` | 分数变化 |
| `fortune_bag` | `{ opportunity }` | 福袋出现 |
| `fortune_result` | `{ playerId, result }` | 福袋开奖 |
| `emote_broadcast` | `{ fromUserId, emoteId }` | 表情广播 |
| `player_disconnect` | `{ userId }` | 断线 |
| `game_finished` | `{ sessionId }` | 对局结束 |

## 八、游戏流程（服务端驱动）

```
房间阶段：
  创建房间 → 生成邀请码 → 玩家加入 → 房主开始
  → 服务端创建 game_sessions + 调用 engine.pairPlayers()
  → 通知所有人跳转 arena

对局阶段（服务端 setInterval）：
  每秒 tick → 每3秒 engine.playRound()
  → 随机福袋 engine.buildOpportunity()
  → 广播 game_tick（含分数/事件/福袋）
  → timeLeft=0 → engine.buildResult() → 写入DB → 广播 game_finished

结算阶段：
  客户端 GET /api/games/:id/result → 排行/金币
```

## 九、前端改造清单

| 文件 | 当前 | 改为 |
|------|------|------|
| `utils/game-store.js` | 本地 setInterval tick | 仅存 Socket.IO 状态快照，去掉 startTimer/tick |
| `utils/user-profile.js` | wx.getUserProfile 本地 | POST /api/auth/login + GET/PUT /api/user/profile |
| `utils/shop-store.js` | 本地 localStorage | API 调用（购买/装备/查询） |
| `utils/player-stats.js` | 本地 localStorage | GET /api/stats/history |
| `pages/boot/index.js` | 无变化 | 增加 login 调用 |
| `pages/room/index.js` | gameStore.ensureRoom() | POST /api/rooms + Socket 监听 |
| `pages/arena/index.js` | 本地 tick + 本地福袋 | Socket.IO 接收 game_tick |
| `pages/result/index.js` | gameStore.getState() | GET /api/games/:id/result |
| `pages/shop/index.js` | shopStore.buy() | POST /api/shop/buy |
| `pages/income/index.js` | shopStore.getCoinRecords() | GET /api/stats/history |

## 十、后台管理系统（Vue 3 + Element Plus + Vite）

### 页面路由

| 路由 | 页面 |
|------|------|
| `/admin/login` | 管理员登录 |
| `/admin/dashboard` | 数据仪表盘（4卡片+图表） |
| `/admin/users` | 用户管理（列表/搜索/封禁/改金币） |
| `/admin/users/:id` | 用户详情（资产/对局历史） |
| `/admin/items` | 商品管理（CRUD 皮肤/宠物） |
| `/admin/games` | 对局监控（进行中+历史） |
| `/admin/games/:id` | 对局详情（回合回放） |
| `/admin/stats` | 数据统计图表（echarts） |

### 仪表盘数据卡片

```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ 总用户   │ │ 今日对局 │ │ 活跃房间 │ │ 今日收入 │
│  1,234  │ │   42    │ │    3    │ │ ¥5,280  │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

## 十一、项目完整结构

```
back/
├── .env / .env.example
├── package.json
├── src/
│   ├── app.js                    # Express 入口
│   ├── config/index.js           # dotenv + 配置
│   ├── middleware/
│   │   ├── auth.js               # JWT 鉴权（用户）
│   │   ├── admin-auth.js         # JWT 鉴权（管理员）
│   │   └── error-handler.js      # 全局错误处理
│   ├── routes/
│   │   ├── index.js
│   │   ├── auth.js / user.js / rooms.js / games.js / shop.js / stats.js / leaderboard.js
│   │   └── admin/
│   │       ├── auth.js / dashboard.js / users.js / items.js / games.js / stats.js
│   ├── services/
│   │   ├── auth-service.js / admin-service.js / room-service.js
│   │   ├── game-service.js / shop-service.js / stats-service.js / dashboard-service.js
│   ├── socket/
│   │   └── arena-handler.js
│   ├── models/
│   │   └── db.js                 # mysql2 连接池
│   ├── game-engine/              # 从前端 utils/ 复制
│   │   ├── constants.js / game-engine.js / investment.js / progression.js
│   └── utils/
│       └── response.js
├── admin-web/                    # Vue 3 后台管理
│   ├── package.json / vite.config.js / index.html
│   └── src/
│       ├── main.js / App.vue
│       ├── router/index.js  / stores/auth.js  / utils/request.js
│       ├── views/
│       │   ├── Login.vue / Dashboard.vue
│       │   ├── users/UserList.vue + UserDetail.vue
│       │   ├── items/ItemList.vue
│       │   ├── games/GameList.vue + GameDetail.vue
│       │   └── stats/StatsOverview.vue
│       └── components/AdminLayout.vue
├── sql/
│   ├── 001_create_tables.sql
│   └── 002_seed_shop_items.sql
└── tests/
    ├── auth.test.js / game-service.test.js / room-service.test.js / shop-service.test.js / api.test.js
```

## 十二、实现阶段（7 个阶段）

### 第一阶段：基础设施
- 初始化 package.json、安装依赖
- 创建 .env 和配置模块
- MySQL 建表 + 种子数据
- Express 骨架（app.js、中间件、错误处理）
- db.js 连接池 + response.js

### 第二阶段：鉴权 + 用户
- POST /api/auth/login 微信登录
- JWT 中间件
- GET/PUT /api/user/profile
- 复制 game-engine/* 到服务端

### 第三阶段：房间系统
- 房间 CRUD（创建/列表/详情/加入/离开/准备/开始）

### 第四阶段：对局核心（最复杂）
- 服务端游戏循环（setInterval tick + playRound）
- Socket.IO 初始化 + join_arena/leave_arena
- 广播 game_tick/score_update/fortune_bag/fortune_result
- 对局结束 buildResult → 写 DB → game_finished
- GET /api/games/:id + /result
- 断线/重连处理

### 第五阶段：商城 + 统计
- 商品列表/购买/装备/物品查询
- 统计摘要/对局历史/排行榜

### 第六阶段：后台管理系统（Vue 3）
- Vite + Vue 3 + Element Plus 项目初始化
- 管理员登录 + 路由守卫 + AdminLayout
- 仪表盘 / 用户管理 / 商品管理 / 对局监控 / 数据统计
- Vite 构建 → Express 托管 /admin/ 静态文件

### 第七阶段：前端适配联调
- game-store / user-profile / shop-store / player-stats 改造
- 各页面改造（第九节清单）
- 端到端联调测试

## 十三、测试策略

```bash
npm test
# node:test + assert/strict（与前端一致）
# 测试独立 MySQL 数据库（game_codex_test）
# 测试前自动建表、测试后清空
```

## 十四、部署方案

```bash
# PM2
NODE_ENV=production pm2 start src/app.js --name game-codex

# 或 Docker
docker-compose up  # Node + MySQL 容器
```

---

**总接口约 35 个，数据库 10 张表，7 个实现阶段，含 Vue 3 后台管理系统。**

请审阅确认后开始按阶段开发。
