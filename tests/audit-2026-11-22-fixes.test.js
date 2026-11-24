const test = require('node:test');
const assert = require('node:assert/strict');

function createWxMock() {
  const storage = new Map();
  const toasts = [];
  const audioInstances = [];
  global.wx = {
    getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
    setStorageSync: (k, v) => storage.set(k, v),
    removeStorageSync: (k) => storage.delete(k),
    showToast: (opts) => toasts.push(opts),
    setInnerAudioOption: () => {},
    vibrateShort: () => {},
    redirectTo: () => {},
    reLaunch: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32, left: 280, right: 367 }),
    getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 812 }),
    getSystemInfoSync: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 812, platform: 'ios' }),
    createInnerAudioContext: () => {
      const ctx = {
        src: '',
        loop: false,
        volume: 1,
        playCalls: 0,
        _onError: [],
        play() { this.playCalls++; },
        stop() {},
        destroy() {},
        onError(fn) { this._onError.push(fn); },
        onEnded() {},
        offEnded() {},
        offError() {},
      };
      audioInstances.push(ctx);
      return ctx;
    },
  };
  global.getCurrentPages = () => [];
  global.getApp = () => ({ globalData: {} });
  return { storage, toasts, audioInstances };
}

test('ensureLogin 依据 features.maintenance 拦截维护模式下的登录', async (t) => {
  createWxMock();
  const apiPath = require.resolve('../utils/api-client');
  const runtimePath = require.resolve('../utils/runtime-config');
  const privacyPath = require.resolve('../utils/privacy-consent');
  const profilePath = require.resolve('../utils/user-profile');
  [apiPath, runtimePath, privacyPath, profilePath].forEach((p) => delete require.cache[p]);

  const api = require('../utils/api-client');
  const runtime = require('../utils/runtime-config');
  const privacy = require('../utils/privacy-consent');
  t.mock.method(privacy, 'assertAllowed', () => {});
  const originalGet = api.get;
  api.get = async () => ({
    configs: { 'wechat.login_enabled': 'true' },
    features: { maintenance: { enabled: true, message: '服务器升级维护中' } },
  });
  try {
    await runtime.fetchRemoteConfig(true);
    const { ensureLogin } = require('../utils/user-profile');
    await assert.rejects(() => ensureLogin(), /服务器升级维护中/);
  } finally {
    api.get = originalGet;
    delete require.cache[runtimePath];
  }
});

test('arena showEmote 支持数字 fromUserId 匹配字符串 player.id 且不重复展示本人广播', () => {
  createWxMock();
  const { QUICK_EMOTES } = require('../utils/emote');
  let pageConfig = null;
  global.Page = (cfg) => { pageConfig = cfg; };
  delete require.cache[require.resolve('../pages/arena/index')];
  require('../pages/arena/index');

  const page = Object.create(pageConfig);
  page.data = { chatMessages: [] };
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page.draw = () => {};
  page.generation = 1;
  page.appearance = { emotes: {} };
  page.snapshot = {
    players: [
      { id: '101', name: '本人', isSelf: true },
      { id: '202', name: '队友小红', isSelf: false },
    ],
  };

  page.showEmote(202, QUICK_EMOTES[0].key);
  assert.equal(page.data.chatMessages.length, 1);
  assert.equal(page.data.chatMessages[0].sender, '队友小红');
  assert.equal(page.data.chatMessages[0].isSelf, false);
  assert.equal(page.appearance.emotes['202'], page.data.chatMessages[0].text);
});

test('home startGame 收到 409 自身挑战错误时清空 challengeCode 避免主按钮卡死', async () => {
  createWxMock();
  let pageConfig = null;
  global.Page = (cfg) => { pageConfig = cfg; };
  delete require.cache[require.resolve('../pages/home/index')];
  require('../pages/home/index');

  const page = Object.create(pageConfig);
  page.data = { challengePending: true };
  page.challengeCode = 'self-code';
  page.enteringGame = false;
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page.enterGame = async () => {
    throw Object.assign(new Error('这是你自己的战绩，可以发给好友挑战'), { statusCode: 409 });
  };

  await page.startGame({ quick: true, challengeCode: 'self-code' });
  assert.equal(page.challengeCode, '');
  assert.equal(page.data.challengePending, false);
});

test('utils/audio BGM 发生错误后清空 currentBgmSrc，允许重新播放同一景区音乐', () => {
  const { audioInstances } = createWxMock();
  delete require.cache[require.resolve('../utils/audio-settings')];
  delete require.cache[require.resolve('../utils/audio')];
  const audio = require('../utils/audio');

  const first = audio.playBgm();
  assert.equal(first.playCalls, 1);
  first._onError.forEach((fn) => fn());

  const second = audio.playBgm();
  assert.notEqual(second, first);
  assert.equal(second.playCalls, 1);
  assert.equal(audioInstances.length, 2);
});
