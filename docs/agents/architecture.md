# 技术栈与架构

## 项目概览

- **锦鲤前程**：微信小程序对战游戏（全栈）
  - **前端**：原生小程序（`wxml` / `wxss` / `js`），**无第三方框架/UI 库**
  - **后端**：`back/` — Node.js + Express + MySQL + Socket.IO（含原生 ws 实时通道、服务端对局与奖励结算）
  - **小游戏**：`minigame/` — 原生 Canvas2D + TypeScript，包含授权入口、首页、房间、对战、结算、商城、资料和战绩；联机使用服务端状态与个人结算，详见 `minigame/README.md`
  - **管理后台**：`back/admin-web/` — Vue3 + Element Plus + Vite，构建产物 `back/admin-web/dist`
- **导航**：全部页面使用 `"navigationStyle": "custom"`（自定义导航栏，需计算安全区，见 [page-layout.md](page-layout.md)）
- **所有资源（图片/音频）托管于** `https://xcx.ukb88.com/`

## 页面路由（小程序）

| 路由 | 功能 |
|---|---|
| `pages/boot/index` | 启动页（资源预加载；唯一不受安全区规则约束的页面） |
| `pages/home/index` | 首页 + 景区选择；「分享好友」按钮分享游戏入口 |
| `pages/room/index` | 房间组队（4-10 人）；单个「＋」邀请入口，本地先创建好友房，建房成功后再次点击分享 |
| `pages/arena/index` | 对局战场（120 秒，个人积分排名） |
| `pages/result/index` | 结算排行 |
| `pages/profile/index` | 头像昵称编辑 |
| `pages/shop/index` | 幸运金币商城（皮肤/宠物） |
| `pages/income/index` | 收益明细 |

## 页面模式

每个页面严格 4 文件：`.js`（逻辑）、`.wxml`（模板）、`.wxss`（样式）、`.json`（页面配置）。
每个页面对应 `app.json` pages 数组中的一个条目。

## 游戏流程

1. `boot`（资源预加载）→ `home`（选景区）→ `room`（人数 + 自动补机器人）→ `arena`（首次展示玩法，点击开始后进行 120s 对局，自由组队或保持独立）→ `result`（个人积分排行）→ `home`

首页分享使用微信原生转发按钮，遵循后台分享开关。房间唯一空位保留居中加号与「等待加入」提示；实际邀请使用下方「＋」按钮，创建联网房间与原生转发分两次点击完成。对战页移除商城快捷入口，减少对局中的次要操作。

房间玩家列表仅展示已加入成员与一个「等待加入」空位；每新增一人后保留下一空位，满 10 人时不显示空位，玩家离开后恢复一个空位。本地与联网房间采用相同展示规则，人数进度仍以 10 人容量计算。

## 状态管理（前端 utils/）

- **game-store.js**：全局游戏状态（房间、对局、tick、持久化）；单例模块，有内部 timer
- **shop-store.js**：商城状态与商品逻辑；单例模块
- **player-stats.js**：玩家战绩
- **持久化**：全部通过 `wx.setStorageSync` / `wx.getStorageSync`，key 格式 `game_codex_*_v1`
- **⚠️ 核心注意**：`__resetForTests()` 仅用于测试（见 [testing.md](testing.md)），**不要在生产代码中调用**

## 核心模块（前端 utils/）

| 模块 | 职责 |
|---|---|
| `constants.js` | 游戏常量（人数、时长、积分、景区、头像池、机器人名字），纯数据 |
| `game-engine.js` | 纯规则层（创建玩家、组队、回合结算、排行），**无副作用，可测试** |
| `game-store.js` | 全局状态层（见上） |
| `shop-store.js` | 商城状态（见上） |
| `nav.js` | 导航安全区计算，纯函数 |
| `board-layout.js` | 对局棋盘坐标布局 |
| `team-link.js` | 队伍连线样式计算 |
| `investment.js` | 福袋投资逻辑 |
| `emote.js` | 快捷表情系统 |
| `audio.js` | 音频管理（共享和循环两种模式） |
| `format.js` | 数字/货币/日期格式化 |
| `progression.js` | 等级/经验值计算 |
| `user-profile.js` | 用户资料缓存 |
| `boot-loader.js` | 启动资源预加载 |

## 后端结构（back/）

| 目录 | 职责 |
|---|---|
| `src/routes/` | 用户端 API 路由；`src/routes/admin/` 管理端 API |
| `src/services/` | 业务逻辑层（auth / room / game / shop / 支付 / 管理服务） |
| `src/socket/` | 实时对局通道（Socket.IO + 原生 ws） |
| `src/game-engine/` | 与前端 utils/ 同源的纯规则引擎（前后端各一份，改动需同步） |
| `src/jobs/` | 定时任务（福袋实况刷新等） |
| `src/middleware/` | 鉴权 / 限速 / 错误处理 / 操作日志 |
| `sql/` | 数据库迁移脚本（按编号递增） |
| `tests/` | 后端测试（`cd back && npm test`） |

## 关键工程点

- 前端 `utils/` 与后端 `back/src/game-engine/` 是**同一套引擎逻辑的两份拷贝**：改引擎时必须两边同步，并跑两边测试。
- 例外：`utils/run-arena.js`、`back/src/game-engine/run-arena.js`、`utils/arena-effects.js`、`utils/run-arena-renderer.js` 是**生成物**，真源在 `minigame/src/core/RunArena.ts` 与 `minigame/src/render/`。不要手改，改真源后运行 `npm --prefix minigame run codegen`；`npm --prefix minigame test` 只做 `generate-run-arena.mjs --check` 漂移检查，不会改写这些文件。
- 部署环境变量走 `back/.env`（已被 gitignore，不入库；模板见 `back/.env.example`）。
