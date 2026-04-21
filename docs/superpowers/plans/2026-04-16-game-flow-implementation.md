# 游戏流程接通实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不修改任何现有页面结构与样式文件的前提下，把首页、房间、战场、结算四个页面用统一的前端状态和游戏规则接通成可运行单局游戏。

**架构：** 新增 `constants`、`game-engine`、`game-store` 三层。`game-engine` 负责纯函数规则，`game-store` 负责单例状态和唯一计时器，页面 `index.js` 只负责读取状态与触发动作。

**技术栈：** 微信小程序原生 JS、CommonJS、Node 内置 `node:test`

---

### 任务 1：建立测试入口与规则层失败测试

**文件：**
- 创建：`package.json`
- 创建：`tests/game-engine.test.js`

- [ ] **步骤 1：创建测试脚本**

```json
{
  "name": "game-codex",
  "private": true,
  "scripts": {
    "test": "node --test tests"
  }
}
```

- [ ] **步骤 2：先写失败测试覆盖核心规则**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../utils/game-engine');

test('ensureMinimumPlayers 会补机器人到至少 4 人', () => {
  const players = [engine.createSelfPlayer()];
  const next = engine.ensureMinimumPlayers(players, { random: () => 0.1 });
  assert.equal(next.length, 4);
});

test('pairPlayers 会在奇数人数时补一个机器人后两两组队', () => {
  const players = engine.createInitialPlayers({ count: 5, random: () => 0.2 });
  const paired = engine.pairPlayers(players, { random: () => 0.2 });
  assert.equal(paired.players.length % 2, 0);
  assert.equal(paired.teams.length * 2, paired.players.length);
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '../utils/game-engine'` 或缺少目标方法。

### 任务 2：实现规则常量与纯函数引擎

**文件：**
- 创建：`utils/constants.js`
- 创建：`utils/game-engine.js`
- 测试：`tests/game-engine.test.js`

- [ ] **步骤 1：定义游戏常量**

```js
module.exports = {
  MIN_PLAYERS: 4,
  MAX_PLAYERS: 10,
  ROOM_UI_LIMIT: 9,
  GAME_DURATION_SECONDS: 180,
  ROUND_INTERVAL_SECONDS: 3,
  TEAM_SIZE: 2
};
```

- [ ] **步骤 2：实现最小可用规则函数**

```js
function ensureMinimumPlayers(players, options) {
  const list = players.slice();
  while (list.length < MIN_PLAYERS) {
    list.push(createRobotPlayer({ seat: list.length + 1 }, options));
  }
  return list;
}

function pairPlayers(players, options) {
  const normalized = players.length % 2 === 0 ? players.slice() : ensureEvenPlayers(players, options);
  const teams = [];
  for (let i = 0; i < normalized.length; i += 2) {
    teams.push({ id: `team-${i / 2 + 1}`, memberIds: [normalized[i].id, normalized[i + 1].id] });
  }
  return { players: normalized, teams };
}
```

- [ ] **步骤 3：补充回合推进和结算能力**

```js
function playRound(state, options) {
  // 选中 1-3 名玩家，计算主事件与 50% 队友联动
}

function buildRanking(players) {
  return players.slice().sort((a, b) => b.score - a.score || a.seat - b.seat);
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS，已有规则测试全部通过。

### 任务 3：为 store 写失败测试

**文件：**
- 创建：`tests/game-store.test.js`
- 测试：`tests/game-store.test.js`

- [ ] **步骤 1：先写状态流失败测试**

```js
const store = require('../utils/game-store');

test('startGame 会把房间状态切到 playing 并生成队伍', () => {
  store.__resetForTests();
  store.createRoomFromStage({ id: 1, code: '01', name: '万里长城' }, { random: () => 0.2 });
  const state = store.startGame();
  assert.equal(state.status, 'playing');
  assert.ok(state.teams.length >= 2);
});

test('tick 会在时间归零后产出 finished 结果', () => {
  store.__resetForTests();
  store.createRoomFromStage({ id: 1, code: '01', name: '万里长城' }, { random: () => 0.2 });
  store.startGame();
  for (let i = 0; i < 180; i += 1) store.tick();
  const state = store.getState();
  assert.equal(state.status, 'finished');
  assert.ok(state.result.top3.first);
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，提示缺少 `game-store` 或相关方法。

### 任务 4：实现全局状态与唯一计时器

**文件：**
- 创建：`utils/game-store.js`
- 测试：`tests/game-store.test.js`

- [ ] **步骤 1：实现单例状态、读写与订阅接口**

```js
function getState() {
  return clone(state);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

- [ ] **步骤 2：实现建房、开局、逐秒推进、结算**

```js
function createRoomFromStage(stage, options) {
  state = createRoomState(stage, options);
  stopTimer();
  emit();
  return getState();
}

function tick() {
  if (state.status !== 'playing') return getState();
  state = advanceOneSecond(state);
  if (state.timeLeft === 0) state = finishGame(state);
  emit();
  return getState();
}
```

- [ ] **步骤 3：加入测试专用重置接口**

```js
function __resetForTests() {
  stopTimer();
  state = createEmptyState();
  listeners.clear();
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS，engine 与 store 测试全部通过。

### 任务 5：接通首页和房间页 JS

**文件：**
- 修改：`pages/home/index.js`
- 修改：`pages/room/index.js`

- [ ] **步骤 1：首页改为建房并进入房间**

```js
startGame() {
  const stage = this.data.stages[this.data.activeStage] || this.data.stages[0];
  gameStore.createRoomFromStage(stage);
  wx.navigateTo({ url: '/pages/room/index' });
}
```

- [ ] **步骤 2：房间页改为读取真实房间成员**

```js
refreshRoom() {
  const state = gameStore.ensureRoom();
  this.setData({ slots: mapRoomSlots(state.players) });
}

start() {
  gameStore.startGame();
  wx.redirectTo({ url: '/pages/arena/index' });
}
```

- [ ] **步骤 3：运行定向测试和静态检查**

运行：`npm test`
预期：PASS。

### 任务 6：接通战场页和结算页 JS

**文件：**
- 修改：`pages/arena/index.js`
- 修改：`pages/result/index.js`

- [ ] **步骤 1：战场页改为订阅 store 并展示实时倒计时/分数**

```js
onShow() {
  this.unsubscribe = gameStore.subscribe((state) => {
    this.syncArena(state);
    if (state.status === 'finished') {
      wx.redirectTo({ url: '/pages/result/index' });
    }
  });
}
```

- [ ] **步骤 2：结果页改为读取真实排行并支持再来一局**

```js
replay() {
  gameStore.restartGame();
  wx.redirectTo({ url: '/pages/arena/index' });
}

goHome() {
  gameStore.resetToHome();
  wx.reLaunch({ url: '/pages/home/index' });
}
```

- [ ] **步骤 3：运行测试验证通过**

运行：`npm test`
预期：PASS。

### 任务 7：端到端验证

**文件：**
- 修改：`docs/superpowers/plans/2026-04-16-game-flow-implementation.md`

- [ ] **步骤 1：运行完整验证命令**

运行：`npm test`
预期：全部通过。

- [ ] **步骤 2：核对实现是否满足规格**

检查：
1. 未修改任何 `wxml` 与 `wxss`
2. 新增统一状态层与规则层
3. 房间最少 4 人、最多 10 人
4. 游戏 180 秒结束并自动结算
5. 结果页读取真实排行

- [ ] **步骤 3：记录实际完成情况**

```md
- [x] 规则测试通过
- [x] 状态流测试通过
- [x] 页面 JS 已接通
```

## 执行结果

- [x] 已新增 `constants`、`game-engine`、`game-store`
- [x] 已接通 `home`、`room`、`arena`、`result` 的页面 JS
- [x] 已新增 Node 测试入口并覆盖最小人数、最大人数、组队补位、联动积分、状态流和结算
- [x] 已验证未修改任何现有 `wxml` 与 `wxss`
