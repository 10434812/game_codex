# 商城功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在对局页新增商城按钮，新增商城页实现皮肤和宠物的购买、持有与装备，并将当前装备回显到对局页自己的玩家节点上。

**架构：** 新增 `utils/shop-store.js` 负责商城状态持久化与业务规则，新增 `pages/shop/*` 承载 UI。对局页只接入入口与装备展示，不改动原有对局状态机。测试优先覆盖仓库层，页面逻辑沿用现有小程序页面模式。

**技术栈：** 微信小程序原生页面、`wx` 本地存储、Node `node:test`

---

## 文件结构

- 创建：`/Users/hh/Desktop/game_codex/utils/shop-store.js`
- 创建：`/Users/hh/Desktop/game_codex/tests/shop-store.test.js`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.json`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.js`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.wxml`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.wxss`
- 修改：`/Users/hh/Desktop/game_codex/app.json`
- 修改：`/Users/hh/Desktop/game_codex/pages/arena/index.js`
- 修改：`/Users/hh/Desktop/game_codex/pages/arena/index.wxml`
- 修改：`/Users/hh/Desktop/game_codex/pages/arena/index.wxss`

### 任务 1：实现商城仓库

**文件：**
- 创建：`/Users/hh/Desktop/game_codex/tests/shop-store.test.js`
- 创建：`/Users/hh/Desktop/game_codex/utils/shop-store.js`

- [ ] **步骤 1：编写失败的测试**

```js
test('getStoreState 会返回默认商城状态', () => {
  shopStore.__resetForTests();
  const state = shopStore.getStoreState();
  assert.equal(state.coins, 8820);
  assert.deepEqual(state.ownedSkins, ['skin-default']);
  assert.equal(state.equippedSkinId, 'skin-default');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test tests/shop-store.test.js`
预期：FAIL，报错 `Cannot find module '../utils/shop-store'` 或缺少对应方法。

- [ ] **步骤 3：编写最少实现代码**

```js
function getStoreState() {
  return loadState();
}
```

补齐默认状态、商品定义、购买逻辑、装备逻辑与测试重置入口。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test tests/shop-store.test.js`
预期：PASS

- [ ] **步骤 5：记录当前状态**

运行：`node --test tests/shop-store.test.js`
预期：仍然 PASS，确认仓库层稳定。

### 任务 2：实现商城页

**文件：**
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.json`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.js`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.wxml`
- 创建：`/Users/hh/Desktop/game_codex/pages/shop/index.wxss`
- 修改：`/Users/hh/Desktop/game_codex/app.json`

- [ ] **步骤 1：接入页面路由**

```json
"pages/shop/index"
```

放入 `app.json` 的 `pages` 数组中。

- [ ] **步骤 2：实现页面数据读取**

```js
data: {
  nav: getNavLayout(),
  activeCategory: 'skin',
  coins: 0,
  categories: [...],
  goods: []
}
```

页面 `onLoad/onShow` 同步商城状态与商品列表。

- [ ] **步骤 3：实现页面结构**

```xml
<view class="paper-bg shop-page">
  <image class="global-bg-image" ... />
  <view class="app-header" ...>...</view>
  <view class="page-content">...</view>
</view>
```

页面内容包含余额卡、分类切换和商品卡片列表。

- [ ] **步骤 4：实现购买与装备交互**

```js
onTapBuy(e) {}
onTapEquip(e) {}
onSwitchCategory(e) {}
```

根据商品状态更新按钮文案，调用仓库层方法并用 `wx.showToast` 反馈结果。

- [ ] **步骤 5：手动回读页面状态**

运行：`node --test tests/shop-store.test.js`
预期：PASS，仓库逻辑未被页面接入破坏。

### 任务 3：在对局页接入入口与装备展示

**文件：**
- 修改：`/Users/hh/Desktop/game_codex/pages/arena/index.js`
- 修改：`/Users/hh/Desktop/game_codex/pages/arena/index.wxml`
- 修改：`/Users/hh/Desktop/game_codex/pages/arena/index.wxss`

- [ ] **步骤 1：在对局页增加商城入口**

```xml
<view class="shop-entry" bindtap="onTapShop">商城</view>
```

入口放在 `page-content` 内，不改动 `app-header`。

- [ ] **步骤 2：接入商城状态**

```js
const shopStore = require('../../utils/shop-store');
```

在 `onShow` 中同步装备状态，并存入页面 `data`。

- [ ] **步骤 3：让自己的玩家节点根据皮肤变化样式**

```xml
<view class="avatar-shell {{ item.skinClass }} {{ item.isSelf ? 'self-avatar-shell' : '' }}">
```

只对 `isSelf` 节点附加皮肤 class。

- [ ] **步骤 4：为自己的节点增加宠物挂件**

```xml
<view wx:if="{{ item.petName }}" class="pet-badge">{{ item.petIcon }} {{ item.petName }}</view>
```

由已装备宠物决定是否展示。

- [ ] **步骤 5：回归验证**

运行：`node --test tests/shop-store.test.js tests/game-store.test.js`
预期：PASS

### 任务 4：完整验证

**文件：**
- 测试：`/Users/hh/Desktop/game_codex/tests/shop-store.test.js`
- 测试：`/Users/hh/Desktop/game_codex/tests/game-store.test.js`

- [ ] **步骤 1：运行商城与现有仓库测试**

运行：`node --test tests/shop-store.test.js tests/game-store.test.js`
预期：全部 PASS

- [ ] **步骤 2：运行项目全量测试**

运行：`npm test`
预期：全部 PASS，无新增失败

- [ ] **步骤 3：人工核对需求**

核对以下事项：
- 对局页存在商城入口
- 商城页遵守头部安全区规则
- 可购买皮肤与宠物
- 已购后可装备
- 对局页自己的节点能看到装备效果

