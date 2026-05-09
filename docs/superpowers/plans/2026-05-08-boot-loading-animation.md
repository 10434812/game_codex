# 开机动画启动页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `assets/bg/开机动画.png` 接到一个真实可推进的启动页里，让进度条按资源预加载过程自然增长，完成后自动进入首页。

**Architecture:** 新增一个独立的 `pages/boot` 启动页，负责展示开机图、进度文字和加载进度条，并在页面生命周期里预加载首页所依赖的关键资源。应用启动时先进入这个页，等预加载完成后再 `reLaunch` 到 `pages/home/index`，这样首页业务逻辑不需要掺杂启动动画状态。进度值来自真实的加载计数，不做纯时间假动画。

**Tech Stack:** 微信小程序原生页面、`wx.getImageInfo`、`wx.preloadNearbyMiniProgram` 不使用、现有 `app.json` 路由、Node 测试

---

### Task 1: 新建启动页并接入开机图

**Files:**
- Create: `pages/boot/index.js`
- Create: `pages/boot/index.wxml`
- Create: `pages/boot/index.wxss`
- Modify: `app.json`

- [ ] **Step 1: Write the failing test**

新增一个页面结构检查，确认启动页存在并且直接引用 `assets/bg/开机动画.png`，同时 `app.json` 的首页入口变成 boot 页。

```js
test('boot 页面会直接使用开机动画图并作为首屏入口', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/boot/index.wxml'), 'utf8');

  assert.equal(appJson.pages[0], 'pages/boot/index');
  assert.match(wxml, /assets\/bg\/开机动画\.png/);
  assert.match(wxml, /class="boot-progress"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/page-ui.test.js`
Expected: FAIL because `pages/boot` 还不存在。

- [ ] **Step 3: Write minimal implementation**

创建一个全屏启动页，图片居中铺底，底部显示进度条和百分比。页面只负责展示，不承担首页业务。

```xml
<view class="boot-page">
  <image class="boot-bg" src="/assets/bg/开机动画.png" mode="aspectFill"></image>
  <view class="boot-mask"></view>
  <view class="boot-panel">
    <view class="boot-title">正在加载世界</view>
    <view class="boot-track">
      <view class="boot-fill" style="width: {{progress}}%;"></view>
    </view>
    <view class="boot-percent">{{progress}}%</view>
  </view>
</view>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/page-ui.test.js`
Expected: PASS for the new boot-page assertion.

- [ ] **Step 5: Commit**

```bash
git add app.json pages/boot/index.js pages/boot/index.wxml pages/boot/index.wxss tests/page-ui.test.js
git commit -m "feat: add boot loading page"
```

### Task 2: 让进度条跟真实预加载走

**Files:**
- Create: `utils/boot-loader.js`
- Modify: `pages/boot/index.js`
- Modify: `tests/page-ui.test.js`

- [ ] **Step 1: Write the failing test**

新增一个纯逻辑测试，给定若干资源项时，加载器应按完成数量返回 0 到 100 的进度，并在全部完成后触发完成回调。

```js
test('boot loader 会按完成数量推进进度并在结束时完成', async () => {
  const {createBootLoader} = require('../utils/boot-loader');
  const calls = [];
  const loader = createBootLoader([
    () => Promise.resolve('a'),
    () => Promise.resolve('b'),
  ], (percent) => calls.push(percent));

  await loader.start();

  assert.deepEqual(calls, [50, 100]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/page-ui.test.js -t "boot loader"`
Expected: FAIL because `utils/boot-loader.js` 还没实现。

- [ ] **Step 3: Write minimal implementation**

实现一个小型加载器，接受资源任务数组，逐个执行并在每次完成后计算进度，启动页只订阅进度更新并在完成后跳转首页。

```js
function createBootLoader(tasks, onProgress) {
  return {
    async start() {
      for (let index = 0; index < tasks.length; index++) {
        await tasks[index]();
        onProgress(Math.round(((index + 1) / tasks.length) * 100));
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/page-ui.test.js -t "boot loader"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/boot-loader.js pages/boot/index.js tests/page-ui.test.js
git commit -m "feat: drive boot progress from preload tasks"
```

### Task 3: 启动时先进入 boot 页，再自动回到首页

**Files:**
- Modify: `app.js`
- Modify: `tests/page-ui.test.js`

- [ ] **Step 1: Write the failing test**

增加 app 启动测试，确认 `onLaunch` 会先跳转到 boot 页，而不是直接进入首页。

```js
test('app 启动时会先进入 boot 页面', () => {
  const calls = createWxStub();
  loadAppWithStubbedAudio({
    playStageBgm() {},
  });

  assert.equal(calls.reLaunch.length, 1);
  assert.equal(calls.reLaunch[0].url, '/pages/boot/index');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/page-ui.test.js -t "app 启动时会先进入 boot 页面"`
Expected: FAIL，因为 `app.js` 还没有启动页重定向。

- [ ] **Step 3: Write minimal implementation**

在 `app.js` 里把启动入口切到 boot 页，并保留现有 BGM 初始化逻辑；boot 页加载完成后再 `reLaunch` 到首页。

```js
App({
  onLaunch() {
    this.audio = audio;
    this.audio.playStageBgm(gameStore.getState().stage, {volume: 0.38});
    wx.reLaunch({url: '/pages/boot/index'});
  },
  onShow() {
    if (this.audio && typeof this.audio.playStageBgm === 'function') {
      this.audio.playStageBgm(gameStore.getState().stage, {volume: 0.38});
    }
  },
  audio: null
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/page-ui.test.js -t "app 启动时会先进入 boot 页面"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/page-ui.test.js
git commit -m "feat: route app launch through boot page"
```

### Task 4: 回归验证启动页和首页都能正常工作

**Files:**
- Modify: `tests/page-ui.test.js`

- [ ] **Step 1: Write the failing test**

增加一个完整回归断言，确认 boot 页完成后会 `reLaunch` 到首页，并且首页原有的进度条断言仍然成立。

```js
test('boot 完成后会回到首页并保留首页原有进度展示', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/boot/index.wxss'), 'utf8');

  assert.match(wxml, /class="exp-progress"/);
  assert.match(wxss, /\.boot-track\s*\{/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/page-ui.test.js -t "boot 完成后会回到首页并保留首页原有进度展示"`
Expected: FAIL until the boot page styles and navigation are wired.

- [ ] **Step 3: Write minimal implementation**

补齐 boot 页的样式、完成后的 `wx.reLaunch({url: '/pages/home/index'})`，并确保首页现有 `progressVisualPercent` 逻辑不被改坏。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add pages/boot/index.js pages/boot/index.wxml pages/boot/index.wxss tests/page-ui.test.js
git commit -m "test: verify boot page and home entry flow"
```
