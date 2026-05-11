const test = require('node:test');
const assert = require('node:assert/strict');
const {getNavLayout} = require('../utils/nav');

let originalWx;

function setupWx(mock) {
  originalWx = global.wx;
  global.wx = mock;
}

function restoreWx() {
  global.wx = originalWx;
}

test('getNavLayout 返回状态栏、导航栏和胶囊留白', () => {
  setupWx({
    getSystemInfoSync() {
      return {statusBarHeight: 20, windowWidth: 375};
    },
    getMenuButtonBoundingClientRect() {
      return {top: 26, height: 32, left: 281, width: 87};
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.statusBarHeight, 20);
  assert.equal(layout.navHeight, 44);
  assert.equal(layout.capsuleSpace, 102);

  restoreWx();
});

test('getNavLayout 在 wx 抛出异常时使用默认值', () => {
  setupWx({
    getSystemInfoSync() {
      throw new Error('fail');
    },
    getMenuButtonBoundingClientRect() {
      throw new Error('fail');
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.statusBarHeight, 20);
  assert.equal(layout.navHeight, 44);
  assert.equal(layout.capsuleSpace, 102);

  restoreWx();
});

test('getNavLayout 使用自定义系统信息', () => {
  setupWx({
    getSystemInfoSync() {
      return {statusBarHeight: 44, windowWidth: 414};
    },
    getMenuButtonBoundingClientRect() {
      return {top: 50, height: 32, left: 320, width: 87};
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.statusBarHeight, 44);
  assert.equal(layout.navHeight, 44);
  assert.equal(layout.capsuleSpace, 102);

  restoreWx();
});

test('getNavLayout 当胶囊矩形缺少宽高时使用默认值', () => {
  setupWx({
    getSystemInfoSync() {
      return {statusBarHeight: 20, windowWidth: 375};
    },
    getMenuButtonBoundingClientRect() {
      return {top: 26, left: 281};
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.navHeight, 44);

  restoreWx();
});

test('getNavLayout navHeight 不小于 44', () => {
  setupWx({
    getSystemInfoSync() {
      return {statusBarHeight: 20, windowWidth: 375};
    },
    getMenuButtonBoundingClientRect() {
      return {top: 20, height: 20, left: 281, width: 87};
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.navHeight, 44);

  restoreWx();
});

test('getNavLayout capsuleSpace 最小为 88', () => {
  setupWx({
    getSystemInfoSync() {
      return {statusBarHeight: 20, windowWidth: 375};
    },
    getMenuButtonBoundingClientRect() {
      return {top: 26, height: 32, left: 295, width: 87};
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.capsuleSpace, 88);

  restoreWx();
});

test('getNavLayout capsuleSpace 最大为 156', () => {
  setupWx({
    getSystemInfoSync() {
      return {statusBarHeight: 20, windowWidth: 800};
    },
    getMenuButtonBoundingClientRect() {
      return {top: 26, height: 32, left: 100, width: 87};
    },
  });

  const layout = getNavLayout();
  assert.equal(layout.capsuleSpace, 156);

  restoreWx();
});
