const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
};

const guideStore = require('../utils/guide-store');

test.beforeEach(() => {
  storage.clear();
  guideStore.__resetForTests();
});

test('首次进入会从首页引导开始', () => {
  assert.equal(guideStore.isDone(), false);
  assert.equal(guideStore.getCurrentStep(), guideStore.GUIDE_STEPS.HOME);
  assert.equal(guideStore.shouldShowStep(guideStore.GUIDE_STEPS.HOME), true);
});

test('引导步骤会写入 storage 并按当前步骤展示', () => {
  guideStore.advanceTo(guideStore.GUIDE_STEPS.ROOM);

  assert.equal(storage.get('game_codex_guide_step_v1'), guideStore.GUIDE_STEPS.ROOM);
  assert.equal(guideStore.shouldShowStep(guideStore.GUIDE_STEPS.HOME), false);
  assert.equal(guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ROOM), true);
});

test('完成后会隐藏所有步骤并持久化完成状态', () => {
  guideStore.advanceTo(guideStore.GUIDE_STEPS.RESULT);
  guideStore.complete();

  assert.equal(storage.get('game_codex_guide_done_v1'), '1');
  assert.equal(storage.has('game_codex_guide_step_v1'), false);
  assert.equal(guideStore.isDone(), true);
  assert.equal(guideStore.getCurrentStep(), '');
  assert.equal(guideStore.shouldShowStep(guideStore.GUIDE_STEPS.RESULT), false);
});
