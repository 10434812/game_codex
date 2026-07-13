const GUIDE_DONE_KEY = 'game_codex_guide_done_v1';
const GUIDE_STEP_KEY = 'game_codex_guide_step_v1';

const GUIDE_STEPS = {
  HOME: 'home',
  ROOM: 'room',
  ARENA_TEAM: 'arena-team',
  ARENA_BAG: 'arena-bag',
  RESULT: 'result',
};

const STEP_ORDER = [
  GUIDE_STEPS.HOME,
  GUIDE_STEPS.ROOM,
  GUIDE_STEPS.ARENA_TEAM,
  GUIDE_STEPS.ARENA_BAG,
  GUIDE_STEPS.RESULT,
];

function readStorage(key) {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      return wx.getStorageSync(key);
    }
  } catch (error) {}
  return null;
}

function writeStorage(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      wx.setStorageSync(key, value);
    }
  } catch (error) {}
}

function removeStorage(key) {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) {
      wx.removeStorageSync(key);
    }
  } catch (error) {}
}

function isDone() {
  return readStorage(GUIDE_DONE_KEY) === '1';
}

function normalizeStep(step) {
  return STEP_ORDER.includes(step) ? step : GUIDE_STEPS.HOME;
}

function getCurrentStep() {
  if (isDone()) {
    return '';
  }
  return normalizeStep(readStorage(GUIDE_STEP_KEY));
}

function shouldShowStep(step) {
  return !isDone() && getCurrentStep() === step;
}

function advanceTo(step) {
  if (isDone()) {
    return '';
  }
  const nextStep = normalizeStep(step);
  writeStorage(GUIDE_STEP_KEY, nextStep);
  return nextStep;
}

function complete() {
  writeStorage(GUIDE_DONE_KEY, '1');
  removeStorage(GUIDE_STEP_KEY);
}

function __resetForTests() {
  removeStorage(GUIDE_DONE_KEY);
  removeStorage(GUIDE_STEP_KEY);
}

module.exports = {
  GUIDE_STEPS,
  advanceTo,
  complete,
  getCurrentStep,
  isDone,
  shouldShowStep,
  __resetForTests,
};
