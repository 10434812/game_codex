# 页面布局硬规则

## 目标

后续任何页面修改，主内容**不得进入头部安全区**，不得与系统胶囊/状态栏重叠。
Boot 页面（启动页）除外。

## 强制结构（所有页面）

每个页面根节点必须遵循以下顺序：

1. `global-bg-image`
2. `app-header`（带 `padding-top: {{nav.statusBarHeight}}px` 与 `padding-right: {{nav.capsuleSpace}}px`）
3. `page-content`（页面主内容容器）

示例：

```xml
<view class="paper-bg xxx-page">
  <image class="global-bg-image" ... />
  <view class="app-header" style="padding-top: {{nav.statusBarHeight}}px; padding-right: {{nav.capsuleSpace}}px;">...</view>
  <view class="page-content">...</view>
</view>
```

## 禁止事项

- 禁止删除 `app-header` 后直接放主内容。
- 禁止给主标题使用负 `margin-top` 或绝对定位顶到页面最上方。
- 禁止把页面第一块业务内容放在 `app-header` 之前。

## 自检清单（提交前）

- iPhone 刘海屏下，主标题首行不与状态栏/胶囊重叠。
- `app-header` 存在且可见。
- 主内容都在 `page-content` 内。

---

# 技术栈与架构

## 项目概览

- **锦鲤前程**：纯前端微信小程序对战 Demo（本地模拟模式，无实时多人后端）
- **框架**：微信小程序原生（`wxml` / `wxss` / `js`），**无第三方框架/UI 库**
- **导航**：全部页面使用 `"navigationStyle": "custom"`（自定义导航栏，需计算安全区）
- **所有资源（图片/音频）托管于** `https://xcx.ukb88.com/`

## 页面路由

| 路由 | 功能 |
|---|---|
| `pages/boot/index` | 启动页（加载资源，唯一不设 app-header 的页面） |
| `pages/home/index` | 首页 + 景区选择 |
| `pages/room/index` | 房间组队（4-10 人） |
| `pages/arena/index` | 对局战场（180 秒） |
| `pages/result/index` | 结算排行 |
| `pages/profile/index` | 头像昵称编辑 |
| `pages/shop/index` | 幸运金币商城（皮肤/宠物） |
| `pages/income/index` | 收益明细 |

## 页面模式

每个页面严格 4 文件：`.js`（逻辑）、`.wxml`（模板）、`.wxss`（样式）、`.json`（页面配置）。
每个页面对应 `app.json` pages 数组中的一个条目。

## 导航安全区（必须遵守）

每个页面的 `onLoad` 中必须调用 `getNavLayout()` 并将结果写入 `data.nav`：

```js
onLoad() {
  try {
    this.setData({nav: getNavLayout()});
  } catch (error) {}
}
```

WXML 中使用 `{{nav.statusBarHeight}}` 和 `{{nav.capsuleSpace}}` 给 `app-header` 做内边距。

`getNavLayout()` 返回：`{statusBarHeight, navHeight, capsuleSpace}`。

## 状态管理

- **game-store.js**：全局游戏状态（房间、对局），`clone()` 通过 `JSON.parse(JSON.stringify(value))` 做深拷贝
- **shop-store.js**：商城状态，`__resetForTests()` 用于测试重置
- **player-stats.js**：玩家战绩，`__resetForTests()` 用于测试重置
- **持久化**：全部通过 `wx.setStorageSync` / `wx.getStorageSync`，key 格式 `game_codex_*_v1`
- **核心注意**：`shop-store.js` 和 `player-stats.js` 导出 `__resetForTests()` 供测试用，**不要在生产代码中调用**

## 游戏流程

1. `boot`（资源预加载）→ `home`（选景区）→ `room`（人数 + 自动补机器人）→ `arena`（180s 对局，2人一队）→ `result`（结算排行）→ `home`

## 核心模块

| 模块 | 职责 | 特点 |
|---|---|---|
| `constants.js` | 游戏常量（人数、时长、积分、景区、头像池、机器人名字） | 纯数据 |
| `game-engine.js` | 纯规则层（创建玩家、组队、回合结算、排行） | **无副作用，可测试** |
| `game-store.js` | 全局状态层（房间/对局状态、tick、持久化） | 单例模块，有内部 timer |
| `shop-store.js` | 商城状态与商品逻辑 | 单例模块 |
| `nav.js` | 导航安全区计算 | 纯函数 |
| `board-layout.js` | 对局棋盘坐标布局 | 圆形/椭圆站位 |
| `team-link.js` | 队伍连线样式计算 | CSS 旋转拉伸 |
| `investment.js` | 福袋投资逻辑 | 持有时间影响波动 |
| `emote.js` | 快捷表情系统 | |
| `audio.js` | 音频管理 | 共享和循环两种模式 |
| `format.js` | 数字/货币/日期格式化 | |
| `progression.js` | 等级/经验值计算 | 每级递增加 40 |
| `user-profile.js` | 用户资料缓存 | 有 1500ms 节流 |
| `boot-loader.js` | 启动资源预加载 | 图片预加载队列 |

---

# 测试

## 测试命令

```bash
npm test
# 等价于: node --test tests/*.test.js
```

**不要使用其他测试框架**，当前仓库仅使用 Node.js 内置 `node:test` + `node:assert/strict`。

## 测试文件

- `tests/game-engine.test.js`
- `tests/game-store.test.js`
- `tests/shop-store.test.js`
- `tests/board-layout.test.js`
- `tests/emote.test.js`
- `tests/format.test.js`
- `tests/nav.test.js`
- `tests/player-stats.test.js`
- `tests/progression.test.js`
- `tests/team-link.test.js`
- `tests/page-ui.test.js`

## 测试约定

### 1. `node:test` + `assert.strict`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
```

### 2. 全局 `wx` Mock

测试文件中使用 `new Map()` 模拟 `wx` 存储 API：

```js
const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : null; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};
```

`page-ui.test.js` 提供了最完整的 `wx` stub（涵盖导航、动画、音频等），其他测试只需 mock 必要的 API。

### 3. 确定性随机（Seeded Random）

使用 `createRandom(...values)` 替代 `Math.random`：

```js
function createRandom(...values) {
  let index = 0;
  return () => {
    const value = values[index];
    index = Math.min(index + 1, values.length - 1);
    return value;
  };
}
```

传递给需要 `options.random` 参数的函数（如 `engine.createInitialPlayers({..., random: createRandom(0.2, 0.2)})`）。

### 4. 测试隔离

对有状态的模块，在 `test.beforeEach` 中同步 `__resetForTests()` 并清除 storage：

```js
test.beforeEach(() => {
  storage.clear();
  shopStore.__resetForTests();
  playerStats.__resetForTests();
  store.__resetForTests();
});
```

### 5. `__resetForTests()` 协议

- `shop-store.js`、`player-stats.js`、`game-store.js` 导出 `__resetForTests()` 方法
- **设计意图**：测试重置模块内部状态到初始值
- **⚠️ 仅用于测试**，不要在生产代码中调用

---

# 工作流约定

## 音频管理

- 通过 `utils/audio.js` 管理，暴露 `playCue`, `playStageBgm`, `stopBgm`, `playVibrate`
- 音频源全部为远程 URL（`https://xcx.ukb88.com/assets/audio/...`）
- 全局 BGM 在 `app.js` 的 `onLaunch`/`onShow` 中自动播放

## 用户资料

- 通过 `wx.getUserProfile` 获取（仅 `wx.getUserProfile`，不是新版的头像昵称填写能力）
- 缓存于 `wx_user_profile_v1` key

## CSS 设计风格

- 东方纸张主题：主色橘黄 `#e57c1f`，米纸黄背景 `#f6ebd1`
- 使用 CSS 变量（`--bg-base`, `--red-primary` 等），定义在 `app.wxss`
- 单位使用 `rpx` 做响应式布局
- 头像外框通过 `--avatar-ring-*` 变量统一定义

## Git 与工作区

- 忽略 `node_modules/` 和 `.DS_Store`
- AppID: `wx72a4b552a87b44cf`
- libVersion: `3.4.0`
- `project.config.json` 中 `compileType: "miniprogram"`
- `project.config.json` 的 `packOptions.ignore` 排除了 `tests/`、`docs/`、大部分 `assets/` 子目录
