# 测试约定

## 测试命令

前端（小程序）：

```bash
npm test
# 等价于: node --test tests/*.test.js
```

后端（back/）：

```bash
cd back && npm test
```

**不要使用其他测试框架**：前端仅用 Node.js 内置 `node:test` + `node:assert/strict`（后端允许仓库内既有依赖）。

## 测试文件（前端 tests/）

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
- `tests/achievement-medals.test.js`
- `tests/api-client.test.js`
- `tests/arena-realtime.test.js`
- `tests/guide-store.test.js`
- `tests/investment.test.js`
- `tests/remote-assets.test.js`

后端测试在 `back/tests/*.test.js`。

## 约定

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
