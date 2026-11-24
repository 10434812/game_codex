const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = new Map();
// These UI scenarios exercise already-consented sessions. Consent failures and
// launch routing are covered with the real boundary in boot-privacy/privacy-consent.
const privacyConsent = require('../utils/privacy-consent');

function createWxStub() {
  const calls = {
    navigateTo: [],
    redirectTo: [],
    reLaunch: [],
    showToast: [],
    showShareMenu: [],
    request: [],
    uploadFile: [],
    login: [],
    videoPlay: [],
    videoStop: [],
    vibrateShort: [],
  };

  global.getCurrentPages = () => [{ options: {} }];

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
    getSystemInfoSync() {
      return {
        statusBarHeight: 20,
        windowWidth: 375,
      };
    },
    getMenuButtonBoundingClientRect() {
      return {
        top: 26,
        height: 32,
        left: 281,
        width: 87,
      };
    },
    getImageInfo(payload) {
      if (typeof payload.success === 'function') {
        payload.success({width: 1, height: 1, path: payload.src});
      }
    },
    setInnerAudioOption() { },
    createInnerAudioContext() {
      return {
        stop() { },
        destroy() { },
        seek() { },
        play() { },
        onEnded() { },
        onError() { },
      };
    },
    createVideoContext(id) {
      return {
        play() { calls.videoPlay.push(id); },
        stop() { calls.videoStop.push(id); },
      };
    },
    navigateTo(payload) {
      calls.navigateTo.push(payload);
    },
    redirectTo(payload) {
      calls.redirectTo.push(payload);
    },
    reLaunch(payload) {
      calls.reLaunch.push(payload);
    },
    showToast(payload) {
      calls.showToast.push(payload);
    },
    showShareMenu(payload) {
      calls.showShareMenu.push(payload);
    },
    createAnimation() {
      return {
        opacity: () => this,
        step: () => this,
        export: () => ({}),
        matrix: () => this,
        rotate: () => this,
        scale: () => this,
        translate: () => this,
      };
    },
    nextTick(cb) {
      if (typeof cb === 'function') cb();
    },
    vibrateShort(payload) {
      calls.vibrateShort.push(payload);
    },
    getUserProfile() {
      return Promise.reject(new Error('not implemented'));
    },
    login(payload) {
      calls.login.push(payload);
      if (payload && typeof payload.fail === 'function') {
        payload.fail(new Error('not implemented'));
      }
    },
    request(payload) {
      calls.request.push(payload);
      if (payload && typeof payload.success === 'function') {
        if (payload.url && payload.url.includes('/shop/inventory')) {
          payload.success({
            statusCode: 200,
            data: {
              code: 0,
              data: [
                { item_id: 'skin-jade-rabbit', category: 'skin', is_equipped: 0 },
              ],
            },
          });
          return;
        }
        payload.success({
          statusCode: 200,
          data: {
            code: 0,
            data: {},
          },
        });
      }
    },
    uploadFile(payload) {
      calls.uploadFile.push(payload);
      if (payload && typeof payload.success === 'function') {
        payload.success({
          statusCode: 200,
          data: JSON.stringify({
            code: 0,
            data: { nickName: '真机用户', avatarUrl: 'https://xcx.ukb88.com/uploads/avatars/avatar.png' },
          }),
        });
      }
    },
  };

  return calls;
}

function loadPage(relativePath) {
  let captured = null;
  global.Page = (config) => {
    captured = config;
    return config;
  };

  const fullPath = require.resolve(relativePath);
  delete require.cache[fullPath];
  require(relativePath);
  return captured;
}

function loadAppWithStubbedAudio(audioStub) {
  let captured = null;
  global.App = (config) => {
    captured = config;
    if (typeof config.onLaunch === 'function') {
      config.onLaunch();
    }
    if (typeof config.onShow === 'function') {
      config.onShow();
    }
    return config;
  };

  const audioPath = require.resolve('../utils/audio.js');
  const appPath = require.resolve('../app.js');
  const originalAudioModule = require.cache[audioPath];
  require.cache[audioPath] = {
    id: audioPath,
    filename: audioPath,
    loaded: true,
    exports: audioStub,
  };

  delete require.cache[appPath];
  try {
    require('../app.js');
  } finally {
    if (originalAudioModule) {
      require.cache[audioPath] = originalAudioModule;
    } else {
      delete require.cache[audioPath];
    }
  }

  return captured;
}

function loadPageWithStubbedAudio(relativePath, audioStub) {
  let captured = null;
  global.Page = (config) => {
    captured = createPageInstance(config);
    if (typeof captured.onLoad === 'function') {
      captured.onLoad();
    }
    if (typeof captured.onShow === 'function') {
      captured.onShow();
    }
    return config;
  };

  const audioPath = require.resolve('../utils/audio.js');
  const pagePath = require.resolve(relativePath);
  const originalAudioModule = require.cache[audioPath];
  require.cache[audioPath] = {
    id: audioPath,
    filename: audioPath,
    loaded: true,
    exports: audioStub,
  };

  delete require.cache[pagePath];
  try {
    require(relativePath);
  } finally {
    if (originalAudioModule) {
      require.cache[audioPath] = originalAudioModule;
    } else {
      delete require.cache[audioPath];
    }
  }

  return captured;
}

function loadAudioModule() {
  const audioPath = require.resolve('../utils/audio.js');
  delete require.cache[audioPath];
  return require('../utils/audio.js');
}

function createPageInstance(config) {
  return {
    ...config,
    data: JSON.parse(JSON.stringify(config.data || {})),
    setData(patch, callback) {
      this.data = {
        ...this.data,
        ...patch,
      };
      callback?.();
    },
  };
}

test.beforeEach(() => {
  storage.clear();
  privacyConsent.isAllowed = () => true;
  privacyConsent.canEnter = () => true;
  privacyConsent.assertAllowed = () => {};
});

test('好友邀请优先加入联网房间，旧本地对局和结算不会截走导航', async (t) => {
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  for (const status of ['playing', 'finished']) {
    const calls = createWxStub();
  storage.set('game_codex_api_token_v1', 'account-fixture');
    const gameStore = require('../utils/game-store');
    gameStore.__resetForTests(); gameStore.startGame({autoStartTimer: false});
    if (status === 'finished') gameStore.finishGame();
    const request = wx.request;
    wx.request = (payload) => {
      if (payload.url.endsWith('/rooms/456/join')) {
        calls.request.push(payload);
        payload.success({statusCode: 200, data: {code: 0, data: {
          room: {id: 456, room_code: '1456', status: 'waiting', stage_id: 1},
          players: [{user_id: 1, nick_name: '我', is_self: true, is_host: 0}],
        }}});
      } else request(payload);
    };
    const page = createPageInstance(loadPage('../pages/room/index.js'));
    try {
      page.onLoad({backendRoomId: '456', roomId: '1456'});
      await page.initRoom();
      assert.deepEqual(calls.redirectTo, []);
      assert.equal(page.data.backendRoomId, '456');
      assert.ok(calls.request.some((p) => p.method === 'POST' && p.url.endsWith('/rooms/456/join')));
    } finally {page.onUnload(); gameStore.__resetForTests();}
  }
});

test('旧服务器不支持当前联机玩法时，房间码邀请与主动建房都不发送不兼容请求', async (t) => {
  const calls = createWxStub();
  const config = require('../utils/runtime-config');
  t.mock.method(config, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(config, 'isApiSupported', () => false);
  for (const options of [{roomId: '1456'}, {}]) {
    const page = createPageInstance(loadPage('../pages/room/index.js'));
    page.onLoad(options);
    await page.initRoom(true);
    assert.equal(page.data.backendRoomId, '');
    assert.match(page.data.roomConnectionError, /暂时不可用/);
    if (options.roomId) {
      page.start();
      assert.equal(page.data.starting, false);
    }
    page.onUnload();
  }
  assert.equal(calls.request.filter(({url}) => /\/rooms(?:\/|$)/.test(url)).length, 0);
  assert.ok(calls.showToast.some(({title}) => /暂时不可用/.test(title)));
});

test('旧后端未声明接口能力时，首页不请求公告和当前联机局', async () => {
  const calls = createWxStub();
  storage.set('game_codex_api_token_v1', 'test-user');
  const page = createPageInstance(loadPage('../pages/home/index.js'));
  page.fetchAnnouncements();
  assert.equal(await page.syncOnlineGame(), '');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.request.filter(({url}) => /\/(announcements|games\/current)(?:\?|$)/.test(url)).length, 0);
  assert.deepEqual(calls.showToast, []);
});

test('旧服务器即使支持当前对局查询，也不恢复不兼容的联机玩法', async (t) => {
  const calls = createWxStub();
  storage.set('game_codex_api_token_v1', 'test-user');
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', (name) => name === 'currentGame');
  const page = createPageInstance(loadPage('../pages/home/index.js'));
  assert.equal(await page.syncOnlineGame(), '');
  assert.equal(calls.request.filter(({url}) => url.endsWith('/games/current')).length, 0);
});

test('首页从服务端找回进行中的联机局，快速开始会返回该局', async (t) => {
  const calls = createWxStub();
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();
  storage.set('game_codex_api_token_v1', 'test-user');
  const request = wx.request;
  wx.request = (payload) => {
    if (payload.url.endsWith('/games/current')) {
      calls.request.push(payload);
      payload.success({statusCode: 200, data: {code: 0, data: {sessionId: 9, roomId: 7}}});
    } else request(payload);
  };
  const page = createPageInstance(loadPage('../pages/home/index.js'));
  await page.syncOnlineGame();
  assert.equal(page.data.activeSessionId, '9');
  await page.startGame();
  assert.equal(calls.navigateTo.at(-1).url, '/pages/arena/index?sessionId=9');
  assert.notEqual(gameStore.getState().status, 'room');
});

test('首页查询联机局期间点击组队或对局，等待查询后返回原局', async (t) => {
  const api = require('../utils/api-client');
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  t.mock.method(api, 'isLoggedIn', () => true);
  for (const target of ['/pages/room/index', '/pages/arena/index']) {
    const calls = createWxStub();
    const gameStore = require('../utils/game-store');
    gameStore.__resetForTests();
    let resolveCurrent;
    const current = new Promise((resolve) => {resolveCurrent = resolve;});
    t.mock.method(api, 'get', () => current);
    const page = createPageInstance(loadPage('../pages/home/index.js'));
    const lookup = page.syncOnlineGame();
    const navigation = page.switchTab({currentTarget: {dataset: {page: target}}});
    assert.equal(calls.redirectTo.length, 0);
    resolveCurrent({sessionId: 9, roomId: 7});
    await Promise.all([lookup, navigation]);
    assert.equal(calls.redirectTo.at(-1).url, '/pages/arena/index?sessionId=9');
    assert.notEqual(gameStore.getState().status, 'room');
  }
});

test('首页等待公共配置确认接口能力后，再决定是否恢复联机局', async (t) => {
  const calls = createWxStub();
  const config = require('../utils/runtime-config');
  const api = require('../utils/api-client');
  let finishConfig;
  let supported = false;
  t.mock.method(config, 'fetchRemoteConfig', () => new Promise((resolve) => {finishConfig = resolve;}));
  t.mock.method(config, 'isApiSupported', () => supported);
  t.mock.method(api, 'isLoggedIn', () => true);
  t.mock.method(api, 'get', async (path) => {
    assert.equal(path, '/games/current');
    return {sessionId: 9};
  });
  const page = createPageInstance(loadPage('../pages/home/index.js'));
  const navigation = page.startGame();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.navigateTo, []);
  supported = true;
  finishConfig();
  await navigation;
  assert.equal(calls.navigateTo.at(-1).url, '/pages/arena/index?sessionId=9');
});

test('联机局查询失败保留已知会话，未知状态不会创建本地房间', async (t) => {
  const calls = createWxStub();
  const api = require('../utils/api-client');
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  t.mock.method(api, 'isLoggedIn', () => true);
  t.mock.method(api, 'get', async () => {throw new Error('网络不可用');});
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();
  const page = createPageInstance(loadPage('../pages/home/index.js'));
  await page.startGame();
  assert.equal(calls.navigateTo.length, 0);
  assert.notEqual(gameStore.getState().status, 'room');
  assert.ok(calls.showToast.some(({title}) => /联机.*重试/.test(title)));
  page.setData({activeSessionId: '9'});
  assert.equal(await page.syncOnlineGame(), '9');
  assert.equal(page.data.activeSessionId, '9');
});

test('未开局就中断的联机结果显示原因，不显示赢家、表现或播放庆祝', async (t) => {
  createWxStub();
  const api = require('../utils/api-client');
  t.mock.method(api, 'getToken', () => 'result-user');
  t.mock.method(api, 'get', async () => ({
    interrupted: true, title: '对局已中断', reason: '有玩家未确认，已取消本次开局',
    resultId: 'session-9-user-1', rank: 1, gain: 0, coins: 0,
    ranking: [{id: '1', rank: 1, score: 100, isSelf: true}], achievement: '长城守望者',
  }));
  global.getCurrentPages = () => [{options: {sessionId: '9'}}];
  const page = createPageInstance(loadPage('../pages/result/index.js'));
  const celebrations = [];
  page.playResultVoice = () => celebrations.push('voice');
  page.playResultFirework = () => celebrations.push('firework');
  page.playKoiEffect = () => celebrations.push('koi');
  await page.onShow();
  page.onUnload();
  assert.equal(page.data.interrupted, true);
  assert.equal(page.data.resultTitle, '对局已中断');
  assert.equal(page.data.selfRank, 0);
  assert.equal(page.data.resultReason, '有玩家未确认，已取消本次开局');
  assert.equal(page.data.isKoiWinner, false);
  assert.equal(page.data.performance, null);
  assert.equal(page.data.guideVisible, false);
  assert.deepEqual(celebrations, []);
});

test('联机结算直接展示本人名次，未进前三也能识别', async (t) => {
  createWxStub();
  const api = require('../utils/api-client');
  t.mock.method(api, 'getToken', () => 'result-user');
  t.mock.method(api, 'get', async () => ({
    resultId: 'session-9-user-1', gain: 0, coins: 0,
    ranking: Array.from({length: 8}, (_, i) => ({id: String(i), name: '玩家' + i, rank: i + 1, score: 100 - i, isSelf: i === 6})),
  }));
  global.getCurrentPages = () => [{options: {sessionId: '9'}}];
  const page = createPageInstance(loadPage('../pages/result/index.js'));
  await page.refreshResult();
  page.onUnload();
  assert.equal(page.data.selfRank, 7);
  assert.equal(page.data.rankList.find((p) => p.isSelf).rank, 7);
  assert.equal(page.data.isKoiWinner, false);
});

test('room 页面会完整展示 10 个房间槽位', () => {
  createWxStub();
  const engine = require('../utils/game-engine');
  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  const players = engine.createInitialPlayers({
    count: 10,
    random: () => 0.2,
  });

  roomPage.renderBackendRoom({room: {id: 88}, players: players.map(p => ({nick_name: p.name}))});

  assert.equal(roomPage.data.slots.length, 10);
  assert.equal(roomPage.data.slots[9].name, players[9].name);
  assert.equal(roomPage.data.activePercent, 100);
});

test('账号房间只显示一个待加入空位，加入和离开后自动调整，满员无空位', () => {
  createWxStub();
  const page = createPageInstance(loadPage('../pages/room/index.js'));
  const players = require('../utils/game-engine').createInitialPlayers({count: 10, random: () => .2});
  for (const count of [1, 2, 9, 10, 9, 2, 1]) {
    const members = players.slice(0, count);
    const assertSlots = () => {
      assert.equal(page.data.slots.length, Math.min(count + 1, 10));
      assert.deepEqual(page.data.slots.filter((slot) => slot.filled).map((slot) => slot.name), members.map((player) => player.name));
      assert.equal(page.data.slots.filter((slot) => !slot.filled).length, count === 10 ? 0 : 1);
      assert.equal(page.data.activePercent, count * 10);
    };
    page.renderBackendRoom({room: {id: 88}, players: members.map((player, index) => ({nick_name: player.name, is_host: index === 0, is_self: index === 0, is_ready: true}))});
    assertSlots();
  }
});

test('结算展示服务端本人统计，旧设备结算不能直接打开', async (t) => {
  createWxStub();
  const api = require('../utils/api-client'), store = require('../utils/game-store');
  store.__resetForTests(); store.startGame({autoStartTimer: false}); store.finishGame();
  storage.set('game_codex_api_token_v1', 'account');
  const result = store.getState().result;
  t.mock.method(api, 'get', async (url) => url === '/stats/summary' ? {totalExp: 30} : result);
  global.getCurrentPages = () => [{options: {sessionId: '9'}}];
  const page = createPageInstance(loadPage('../pages/result/index.js'));
  await page.refreshResult();
  assert.equal(page.data.performance.complete, true);
  assert.equal(page.data.performance.bags, 0);
  assert.equal(page.onlineSessionId, '9');
  page.onUnload(); store.__resetForTests();
});

test('联机再来一局返回原房，重复点击合并，失败后可重试', async (t) => {
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  t.mock.method(require('../utils/runtime-config'), 'fetchRemoteConfig', async () => ({}));
  const calls = createWxStub(), api = require('../utils/api-client'), originalPost = api.post;
  storage.set('game_codex_api_token_v1', 'account-fixture');
  t.after(() => {api.post = originalPost;});
  const page = createPageInstance(loadPage('../pages/result/index.js'));
  page.onlineSessionId = '42'; page.replayStage = {id: 6};
  let resolveRoom, count = 0;
  api.post = (url, body) => {
    assert.equal(url, '/games/42/rematch'); assert.equal(body, undefined); count++;
    return new Promise((resolve) => {resolveRoom = resolve;});
  };
  const pending = page.replay();
  await page.replay(); await new Promise(setImmediate); assert.equal(count, 1); assert.equal(page.data.replayPending, true);
  resolveRoom({room: {id: 88}}); await pending;
  assert.equal(calls.redirectTo.at(-1).url, '/pages/room/index?backendRoomId=88');
  assert.equal(page.data.replayPending, false);
  api.post = async () => {throw new Error('连接中断');};
  await page.replay();
  assert.equal(calls.showToast.at(-1).title, '连接中断');
  assert.equal(page.data.replayPending, false);
});

test('旧服务器联机结算再来一局时显示升级提示，不创建不兼容房间', async (t) => {
  const calls = createWxStub();
  storage.set('game_codex_api_token_v1', 'account-fixture');
  t.mock.method(require('../utils/runtime-config'), 'fetchRemoteConfig', async () => ({}));
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => false);
  t.mock.method(require('../utils/api-client'), 'post', async () => {assert.fail('不应创建旧版房间');});
  const page = createPageInstance(loadPage('../pages/result/index.js'));
  page.onlineSessionId = '42';
  await page.replay();
  assert.equal(calls.showToast.at(-1).title, '对战服务暂时不可用，请稍后重试');
  assert.equal(page.data.replayPending, false);
  assert.deepEqual(calls.redirectTo, []);
});

test('room 页面会提示准备后点击开始游戏', () => {
  const roomJs = fs.readFileSync(path.join(__dirname, '../pages/room/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');

  assert.match(roomJs, /roomHintText:\s*'准备好后，点击开始游戏'/);
  assert.match(wxml, /room-hint/);
  assert.match(wxml, /class="secondary-actions"/);
  assert.match(wxss, /\.secondary-actions\s*\{[\s\S]*display:\s*flex;[\s\S]*gap:\s*16rpx;/);
});

test('API 客户端默认不指向 localhost，后端模式可用于真机 HTTPS 域名', () => {
  createWxStub();
  const apiPath = require.resolve('../utils/api-client');
  delete require.cache[apiPath];
  const api = require('../utils/api-client');

  assert.doesNotMatch(api.getBaseUrl(), /localhost|http:\/\//);
});

test('arena 后端模式使用微信原生 WebSocket，并保留 HTTP 轮询兜底', () => {
  const arenaJs = fs.readFileSync(path.join(__dirname, '../pages/arena/index.js'), 'utf8');

  assert.match(arenaJs, /wx\.connectSocket/);
  assert.match(arenaJs, /\/ws\/arena/);
  assert.match(arenaJs, /startArenaPolling/);
  assert.match(arenaJs, /startArenaPolling\(\)/);
  assert.doesNotMatch(arenaJs, /ws:\/\/localhost/);
  assert.doesNotMatch(arenaJs, /socket\.io/);
});

test('room 后端房间非房主不能点击开始游戏', () => {
  createWxStub();
  const roomJs = fs.readFileSync(path.join(__dirname, '../pages/room/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');
  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));

  roomPage.setData({backendRoomId: '1001', isHost: true});
  roomPage.renderBackendRoom({
    room: {id: 1001, room_code: 'A001', stage_id: 'great-wall'},
    players: [
      {user_id: 1, nick_name: '房主', is_host: 1, is_ready: 1},
      {user_id: 2, nick_name: '我', is_host: 0, is_ready: 0, is_self: true},
    ],
  });

  assert.equal(roomPage.data.isHost, false);
  assert.equal(roomPage.data.selfReady, false);
  assert.equal(roomPage.data.modeText, '联网对战');
  assert.match(roomJs, /等待房主开始游戏/);
  // 非房主的主按钮是醒目的准备开关，房主才显示开始按钮。
  assert.match(wxml, /wx:elif="\{\{!matchmaking && backendRoomId && !isHost\}\}" class="start-btn guest-ready-btn \{\{selfReady \? 'is-ready' : 'need-ready'\}\}" bindtap="toggleReady"/);
  assert.match(wxml, /点我准备/);
  assert.match(wxml, /已准备 · 等待房主开始/);
  assert.match(wxss, /\.guest-ready-btn\.need-ready\s*\{/);
  assert.doesNotMatch(wxml, /class="ready-btn"/);
  assert.equal(roomPage.data.slots[1].state, '未准备');
  assert.equal(roomPage.data.slots[1].ready, false);
  assert.equal(roomPage.data.slots[0].state, '房主');
});

test('income 页面从资金流水接口读取账户明细', () => {
  const incomeJs = fs.readFileSync(path.join(__dirname, '../pages/income/index.js'), 'utf8');

  assert.match(incomeJs, /\/stats\/coin-records/);
  assert.doesNotMatch(incomeJs, /\/stats\/history/);
});

test('远程资源默认值不引用已知 404 路径', () => {
  const files = [
    '../pages/room/index.wxml',
    '../utils/runtime-config.js',
    '../back/src/services/auth-service.js',
    '../back/src/config/system-config-definitions.js',
    '../project.config.json',
  ].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');

  assert.doesNotMatch(files, /assets\/bg\/roombg\.png/);
  assert.doesNotMatch(files, /assets\/avatar\/default\.png/);
  assert.doesNotMatch(files, /legal\/user-agreement\.html|legal\/privacy-policy\.html/);
  assert.doesNotMatch(files, /assets\/icons\//);
});

test('profile 页面使用新版头像昵称填写能力', () => {
  const profileJs = fs.readFileSync(path.join(__dirname, '../pages/profile/index.js'), 'utf8');
  const profileWxml = fs.readFileSync(path.join(__dirname, '../pages/profile/index.wxml'), 'utf8');

  assert.doesNotMatch(profileJs, /getUserProfile|onRequestWechatProfile/);
  assert.match(profileWxml, /open-type="chooseAvatar"/);
  assert.match(profileWxml, /bindchooseavatar="onChooseAvatar"/);
  assert.match(profileWxml, /type="nickname"/);
});

test('profile 未登录选择头像不会发布未审核本地文件，并显示可操作错误', async () => {
  storage.clear();
  const calls = createWxStub();
  const apiPath = require.resolve('../utils/api-client');
  const profilePath = require.resolve('../utils/user-profile');
  delete require.cache[apiPath];
  delete require.cache[profilePath];
  const profilePage = createPageInstance(loadPage('../pages/profile/index.js'));

  await profilePage.onChooseAvatar({ detail: { avatarUrl: 'wxfile://avatar.png' } });

  assert.notEqual(profilePage.data.draft.avatarUrl, 'wxfile://avatar.png');
  assert.match(profilePage.data.profileError, /请先登录/);
  assert.equal(profilePage.data.canSave, false);
  assert.equal(profilePage.data.profileUpdating, false);
  assert.equal(calls.uploadFile.length, 0);
});

test('requestUpdate 未登录时拒绝保存且不改缓存、不请求后端', async () => {
  storage.clear();
  const calls = createWxStub();
  const apiPath = require.resolve('../utils/api-client');
  const profilePath = require.resolve('../utils/user-profile');
  delete require.cache[apiPath];
  delete require.cache[profilePath];
  const api = require('../utils/api-client');
  const userProfile = require('../utils/user-profile');

  api.clearToken();
  const previous = userProfile.getCachedProfile();
  await assert.rejects(userProfile.requestUpdate({ nickName: '真机用户', avatarUrl: 'https://example.com/a.png' }), /请先登录/);
  assert.deepEqual(userProfile.getCachedProfile(), previous);
  assert.equal(calls.request.length, 0);
});

test('服务端空头像清除历史未审核本地头像', () => {
  storage.clear();
  createWxStub();
  const profilePath = require.resolve('../utils/user-profile');
  delete require.cache[profilePath];
  const userProfile = require('../utils/user-profile');

  userProfile.saveProfile({ nickName: '何必远方', avatarUrl: 'wxfile://avatar.png' });
  const profile = userProfile.mergeProfile({ nickName: '何必远方', avatarUrl: '' });

  assert.equal(profile.avatarUrl, '');
});

test('profile 头像异步待审保留已发布头像并显示待审提示', async () => {
  storage.clear();
  createWxStub();
  delete require.cache[require.resolve('../utils/api-client')];
  delete require.cache[require.resolve('../utils/user-profile')];
  const api = require('../utils/api-client');
  const profiles = require('../utils/user-profile');
  api.setToken('profile-review-token');
  profiles.saveProfile({nickName: '旧昵称', avatarUrl: 'https://example.com/approved.png'});
  global.wx.uploadFile = (payload) => payload.success({
    statusCode: 202,
    data: JSON.stringify({code: 0, data: {nickName: '旧昵称', avatarUrl: 'https://example.com/approved.png', avatarReview: 'pending'}}),
  });
  const page = createPageInstance(loadPage('../pages/profile/index.js'));
  await page.onChooseAvatar({detail: {avatarUrl: 'wxfile://unreviewed.png'}});
  assert.equal(page.data.avatarReviewPending, true);
  assert.equal(page.data.draft.avatarUrl, 'https://example.com/approved.png');
  assert.equal(profiles.getCachedProfile().avatarUrl, 'https://example.com/approved.png');
});

test('profile 昵称审核拒绝保留输入但不写入公开缓存、不显示保存成功', async () => {
  storage.clear();
  const calls = createWxStub();
  delete require.cache[require.resolve('../utils/api-client')];
  delete require.cache[require.resolve('../utils/user-profile')];
  const api = require('../utils/api-client');
  const profiles = require('../utils/user-profile');
  api.setToken('profile-review-token');
  profiles.saveProfile({nickName: '旧昵称', avatarUrl: ''});
  global.wx.request = (payload) => payload.success({statusCode: 400, data: {code: 400, message: '昵称未通过内容安全校验'}});
  const page = createPageInstance(loadPage('../pages/profile/index.js'));
  page.setData({draft: {nickName: '待审昵称', avatarUrl: ''}, canSave: true});
  await page.onSaveProfile();
  assert.equal(profiles.getCachedProfile().nickName, '旧昵称');
  assert.equal(page.data.draft.nickName, '待审昵称');
  assert.match(page.data.profileError, /内容安全/);
  assert.equal(page.data.profileUpdating, false);
});

test('API 请求失败时错误会带上状态码和请求 URL', async () => {
  storage.clear();
  createWxStub();
  global.wx.request = (payload) => {
    payload.success({
      statusCode: 405,
      data: '<html>405 Not Allowed</html>',
    });
  };

  const apiPath = require.resolve('../utils/api-client');
  delete require.cache[apiPath];
  const api = require('../utils/api-client');

  await assert.rejects(
    () => api.put('/user/profile', { nickName: 'test' }),
    (err) => {
      assert.equal(err.message, '请求失败(405)');
      assert.equal(err.statusCode, 405);
      assert.match(err.url, /\/api\/user\/profile$/);
      return true;
    }
  );
});

test('arena 原有底部导航仍属于 page-content 主内容容器', () => {
  const arenaWxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const bottomNavIndex = arenaWxml.indexOf('class="bottom-nav');
  const pageContentCloseIndex = arenaWxml.indexOf('\n  </view>\n\n  <view class="bottom-nav');

  assert.ok(bottomNavIndex > arenaWxml.indexOf('class="page-content"'));
  assert.equal(pageContentCloseIndex, -1);
});

test('核心流程引导浮层保留在 page-content 内且不新增教程路由', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
  const files = [
    '../pages/home/index.wxml',
    '../pages/room/index.wxml',
    '../pages/arena/index.wxml',
    '../pages/result/index.wxml',
  ];

  for (const file of files) {
    const wxml = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const pageContentIndex = wxml.indexOf('class="page-content"');
    const guideIndex = wxml.indexOf(file.includes('arena') ? 'class="rules-overlay' : 'class="guide-overlay');

    assert.ok(pageContentIndex >= 0, `${file} should keep page-content`);
    assert.ok(guideIndex > pageContentIndex, `${file} guide overlay should be inside page-content`);
    assert.match(wxml, /class="app-header"/);
  }

  assert.equal(appJson.pages.includes('pages/guide/index'), false);
});

test('核心流程引导使用底部单主按钮并复用一次性状态模块', () => {
  const appWxss = fs.readFileSync(path.join(__dirname, '../app.wxss'), 'utf8');
  const homeJs = fs.readFileSync(path.join(__dirname, '../pages/home/index.js'), 'utf8');
  const roomJs = fs.readFileSync(path.join(__dirname, '../pages/room/index.js'), 'utf8');
  const arenaJs = fs.readFileSync(path.join(__dirname, '../pages/arena/index.js'), 'utf8');
  const resultJs = fs.readFileSync(path.join(__dirname, '../pages/result/index.js'), 'utf8');

  assert.match(appWxss, /\.guide-action-panel\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*calc\(166rpx \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(appWxss, /\.guide-primary\s*\{[\s\S]*height:\s*88rpx;/);
  assert.match(homeJs, /guideStore\.GUIDE_STEPS\.ROOM/);
  assert.match(roomJs, /guideStore\.GUIDE_STEPS\.ARENA_TEAM/);
  assert.match(arenaJs, /game_codex_running_rules_v1/);
  assert.match(arenaJs, /guideStore\.GUIDE_STEPS\.RESULT/);
  assert.match(resultJs, /guideStore\.complete\(\)/);
});

test('生产页面不会调用测试重置方法', () => {
  const productionFiles = [
    '../app.js',
    '../pages/home/index.js',
    '../pages/room/index.js',
    '../pages/arena/index.js',
    '../pages/result/index.js',
    '../pages/profile/index.js',
    '../pages/shop/index.js',
    '../pages/income/index.js',
  ];
  const source = productionFiles
    .map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /__resetForTests\s*\(/);
});


test('room 页面开始游戏按钮会变小并居中', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');

  assert.match(wxss, /\.start-btn\s*\{[\s\S]*width:\s*560rpx\s*!important;[\s\S]*max-width:\s*calc\(100%\s*-\s*80rpx\)\s*!important;[\s\S]*margin:\s*0 auto 18rpx;/);
});

test('home 页面在没有结算结果时点击历史 Tab 不会误跳转', async () => {
  const calls = createWxStub();
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();

  const homePage = createPageInstance(loadPage('../pages/home/index.js'));
  await homePage.switchTab({
    currentTarget: {
      dataset: {
        page: '/pages/result/index',
      },
    },
  });

  assert.equal(calls.redirectTo.length, 0);
  assert.equal(calls.showToast.length, 1);
});

test('未登录首页不显示设备体验经验和余额', () => {
  createWxStub();
  const gameStore = require('../utils/game-store');
  const shopStore = require('../utils/shop-store');
  const playerStats = require('../utils/player-stats');

  gameStore.__resetForTests();
  shopStore.__resetForTests();
  playerStats.__resetForTests();

  const homePage = createPageInstance(loadPage('../pages/home/index.js'));
  homePage.syncOverview();

  assert.equal(homePage.data.progressPercent, 0);
  assert.equal(homePage.data.progressVisualPercent, 0);
  assert.equal(homePage.data.levelText, '--');
  assert.match(homePage.data.experienceText, /微信登录/);
  assert.equal(homePage.data.balanceAmountText, '--');
});

test('home 景区卡片在暗色封面上使用浅色标题', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');
  const {STAGES} = require('../utils/constants');

  assert.match(wxml, /--stage-title-color:\s*\{\{\s*item\.titleColor\s*\}\}/);
  assert.match(wxml, /--stage-accent-color:\s*\{\{\s*item\.accentColor\s*\}\}/);
  assert.match(wxss, /\.dest-name\s*\{[\s\S]*color:\s*#fff0c9;/);
  assert.match(wxss, /\.dest-meta\s*\{[\s\S]*color:\s*#f6dfb0;/);

  for (const stage of STAGES) {
    assert.match(stage.titleColor, /^#[0-9a-f]{6}$/i);
    assert.match(stage.accentColor, /^#[0-9a-f]{6}$/i);
  }
  assert.notEqual(STAGES[0].titleColor, STAGES[1].titleColor);
});

test('home 景区卡片切换会渲染金色卡册控件', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');
  const {STAGES} = require('../utils/constants');

  assert.match(wxml, /previous-margin="72rpx"/);
  assert.match(wxml, /next-margin="72rpx"/);
  assert.match(wxml, /class="stage-arrow stage-arrow-left" bindtap="onPrevStage"/);
  assert.match(wxml, /class="stage-arrow stage-arrow-right" bindtap="onNextStage"/);
  assert.match(wxml, /class="stage-frame-line"/);
  assert.match(wxml, /class="stage-dots"/);
  assert.match(wxss, /\.stage-item-active\s*\{/);
  assert.match(wxss, /\.stage-item-side\s*\{/);
  assert.match(wxss, /\.stage-arrow\s*\{/);
  assert.match(wxss, /\.start-btn\s*\{[\s\S]*height:\s*88rpx;/);
  assert.ok(STAGES.every((stage) => stage.slogan));
});

test('home 景区箭头切换会循环更新当前卡片', () => {
  createWxStub();
  const {STAGES} = require('../utils/constants');
  const homePage = createPageInstance(loadPage('../pages/home/index.js'));

  homePage.onPrevStage();
  assert.equal(homePage.data.activeStage, STAGES.length - 1);

  homePage.onNextStage();
  assert.equal(homePage.data.activeStage, 0);
});

test('home 景区远端封面和视频会按实际场景配对', () => {
  const {STAGES} = require('../utils/constants');
  const stagesByName = Object.fromEntries(STAGES.map((stage) => [stage.name, stage]));

  assert.match(stagesByName['万里长城'].image, /\/great-wall-bg\.jpg$/);
  assert.match(stagesByName['万里长城'].video, /\/mount-fuji-bg\.mp4$/);
  assert.match(stagesByName['富士山'].image, /\/mount-fuji-bg\.jpg$/);
  assert.match(stagesByName['富士山'].video, /\/eiffel-bg\.mp4$/);
  assert.match(stagesByName['巴黎铁塔'].image, /\/eiffel-bg\.jpg$/);
  assert.match(stagesByName['巴黎铁塔'].video, /\/great-wall-bg\.mp4$/);
});

test('home 默认和切换后的动态景区视频会主动播放', () => {
  const calls = createWxStub();
  const homePage = createPageInstance(loadPage('../pages/home/index.js'));

  homePage.onShow();
  assert.ok(calls.videoPlay.includes('stage-video-0'));

  homePage.onStageChange({detail: {current: 2}});
  assert.equal(homePage.data.activeStage, 2);
  assert.ok(calls.videoPlay.includes('stage-video-2'));
});

test('home 景区视频节点带稳定 id 并在加载后触发播放', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');

  assert.match(wxml, /id="stage-video-\{\{stageIndex\}\}"/);
  assert.match(wxml, /data-stage-index="\{\{stageIndex\}\}"/);
  assert.match(wxml, /autoplay="\{\{true\}\}"/);
  assert.match(wxml, /muted="\{\{true\}\}"/);
  assert.match(wxml, /bindloadedmetadata="onStageVideoReady"/);
});

test('核心页面会按当前景区注入主题模板', async (t) => {
  createWxStub();
  const {buildStageThemeStyle, resolveStage} = require('../utils/constants');
  const gameStore = require('../utils/game-store');
  const shopStore = require('../utils/shop-store');
  const playerStats = require('../utils/player-stats');
  const homeWxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const roomWxml = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxml'), 'utf8');
  const arenaWxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const resultWxml = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxml'), 'utf8');
  const shopWxml = fs.readFileSync(path.join(__dirname, '../pages/shop/index.wxml'), 'utf8');
  const incomeWxml = fs.readFileSync(path.join(__dirname, '../pages/income/index.wxml'), 'utf8');
  const profileWxml = fs.readFileSync(path.join(__dirname, '../pages/profile/index.wxml'), 'utf8');
  const appWxss = fs.readFileSync(path.join(__dirname, '../app.wxss'), 'utf8');
  const homePage = createPageInstance(loadPage('../pages/home/index.js'));
  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  const tajMahal = resolveStage({name: '泰姬陵'});

  assert.equal(tajMahal.theme.key, 'taj-mahal');
  assert.match(buildStageThemeStyle(tajMahal), /--stage-primary:\s*#b97d91/);
  assert.match(homeWxml, /class="paper-bg home-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(roomWxml, /class="paper-bg room-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(arenaWxml, /class="paper-bg arena-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(resultWxml, /class="paper-bg result-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(shopWxml, /class="paper-bg shop-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(incomeWxml, /class="paper-bg income-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(profileWxml, /class="paper-bg profile-page scene-theme-\{\{stageThemeKey\}\}" style="\{\{stageThemeStyle\}\}"/);
  assert.match(homeWxml, /class="scene-backdrop theme-page-backdrop home-scene-backdrop"/);
  assert.match(roomWxml, /class="scene-template"/);
  assert.match(arenaWxml, /class="scene-template"/);
  assert.match(resultWxml, /class="scene-backdrop theme-page-backdrop result-scene-backdrop"/);
  assert.match(shopWxml, /class="scene-backdrop theme-page-backdrop shop-scene-backdrop"/);
  assert.match(appWxss, /\.scene-theme-taj-mahal \.scene-template/);
  assert.match(appWxss, /\.theme-page-backdrop \.scene-backdrop-mask/);

  homePage.onLoad();
  homePage.onStageChange({detail: {current: 4}});
  assert.equal(homePage.data.stageThemeKey, 'taj-mahal');
  assert.match(homePage.data.stageThemeStyle, /--stage-primary:\s*#b97d91/);

  roomPage.renderBackendRoom({room: {id: 88, stage_id: 5}, players: []});

  assert.equal(roomPage.data.stageThemeKey, 'taj-mahal');
  assert.match(roomPage.data.stageImage, /\/taj-mahal-bg\.jpg$/);
  assert.match(roomPage.data.stageThemeStyle, /--stage-primary:\s*#b97d91/);

  arenaPage.onLoad();
  arenaPage.active = true;
  arenaPage.acceptState({
    status: 'playing',
    players: [],
    teams: [],
    timeLeft: 179,
    duration: 180,
    stage: {id: 6},
    modeText: '本地体验',
  });

  assert.equal(arenaPage.data.stageThemeKey, 'xihu');
  assert.match(arenaPage.data.stageImage, /\/xihhu\.png$/);
  assert.match(arenaPage.data.stageThemeStyle, /--stage-primary:\s*#47a092/);

  gameStore.__resetForTests();
  shopStore.__resetForTests();
  gameStore.createRoomFromStage({name: '富士山'});
  const shopPage = createPageInstance(loadPage('../pages/shop/index.js'));
  shopPage.syncPage();
  assert.equal(shopPage.data.stageThemeKey, 'fuji');
  assert.match(shopPage.data.stageThemeStyle, /--stage-primary:\s*#d7839e/);

  gameStore.__resetForTests();
  playerStats.__resetForTests();
  shopStore.__resetForTests();
  gameStore.createRoomFromStage({id: 6});
  gameStore.startGame({autoStartTimer: false});
  gameStore.finishGame();
  storage.set('game_codex_api_token_v1', 'theme-account');
  global.getCurrentPages = () => [{options: {sessionId: '9'}}];
  t.mock.method(require('../utils/api-client'), 'get', async () => ({...gameStore.getState().result, stage: gameStore.getState().stage}));
  const resultPage = createPageInstance(loadPage('../pages/result/index.js'));
  await resultPage.refreshResult();
  assert.equal(resultPage.data.stageThemeKey, 'xihu');
  assert.match(resultPage.data.stageThemeStyle, /--stage-primary:\s*#47a092/);
  resultPage.stopNumberAnimations();
  gameStore.__resetForTests();
  shopStore.__resetForTests();
  playerStats.__resetForTests();
});

test('核心页面会保留游戏化动效反馈', () => {
  const appWxss = fs.readFileSync(path.join(__dirname, '../app.wxss'), 'utf8');
  const homeWxss = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');
  const roomWxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');
  const arenaWxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');
  const resultWxss = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxss'), 'utf8');
  const shopWxss = fs.readFileSync(path.join(__dirname, '../pages/shop/index.wxss'), 'utf8');

  assert.match(appWxss, /@keyframes page-rise-in/);
  assert.match(appWxss, /@keyframes nav-active-bob/);
  assert.match(homeWxss, /@keyframes stage-drift/);
  assert.match(homeWxss, /@keyframes btn-sheen/);
  assert.match(roomWxss, /@keyframes slot-rise/);
  assert.doesNotMatch(roomWxss, /@keyframes activity-flow/);
  assert.match(roomWxss, /voice-box/);
  const runRenderer = fs.readFileSync(path.join(__dirname, '../utils/run-arena-renderer.js'), 'utf8');
  assert.match(runRenderer, /effect\.type === 'team'/);
  assert.match(runRenderer, /world\.elapsedMs - effect\.at/);
  assert.match(resultWxss, /@keyframes winner-pop/);
  assert.match(resultWxss, /@keyframes rank-row-in/);
  assert.match(shopWxss, /@keyframes goods-rise/);
  assert.match(shopWxss, /@keyframes ring-preview-spin/);
});

test('全局页面入场动效不使用 transform，避免 fixed 浮层定位跑偏', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../app.wxss'), 'utf8');
  const match = wxss.match(/@keyframes page-rise-in\s*\{([\s\S]*?)\n\}/);

  assert.ok(match, 'page-rise-in keyframes should exist');
  assert.doesNotMatch(match[1], /transform:/);
});

test('home 快速开始按钮会固定在底部导航上方，避免被遮挡', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');

  assert.match(wxss, /\.start-btn\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*calc\(166rpx \+ env\(safe-area-inset-bottom\)\);[\s\S]*z-index:\s*18;/);
  assert.match(wxss, /\.home-page \.bottom-nav\s*\{[\s\S]*z-index:\s*20;/);
  assert.match(wxss, /\.home-page \.page-content\s*\{[\s\S]*padding-bottom:\s*calc\(290rpx \+ env\(safe-area-inset-bottom\)\);/);
});

test('资料页独立打开时返回首页', () => {
  const calls = createWxStub();
  wx.navigateBack = (options) => options.fail();
  const page = createPageInstance(loadPage('../pages/profile/index.js'));
  page.onBack();
  assert.equal(calls.reLaunch[0].url, '/pages/home/index');
});


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

test('boot loader skips SVG image info preload', async () => {
  let getImageInfoCalled = false;
  global.wx = {
    getImageInfo() {
      getImageInfoCalled = true;
    },
  };
  const {createImagePreloadTask} = require('../utils/boot-loader');

  const result = await createImagePreloadTask('https://xcx.ukb88.com/assets/nav/play.svg')();

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(getImageInfoCalled, false);
});


test('room 页面在没有结算结果时点击历史 Tab 不会误跳转', async () => {
  const calls = createWxStub();
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();

  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  await roomPage.switchTab({
    currentTarget: {
      dataset: {
        page: '/pages/result/index',
      },
    },
  });

  assert.equal(calls.redirectTo.length, 0);
  assert.equal(calls.showToast.length, 1);
});

test('首页会开启分享菜单并返回后台配置驱动的分享内容', async () => {
  const calls = createWxStub();
  const homePage = createPageInstance(loadPage('../pages/home/index.js'));

  homePage.onLoad();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sharePayload = homePage.onShareAppMessage();

  assert.equal(calls.showShareMenu.length, 1);
  assert.equal(sharePayload.title, '锦鲤前程邀你一起组队闯世界');
  assert.match(sharePayload.path, /\/pages\/home\/index\?from=admin_share&scene=home/);
});

test('房间页邀请分享会带上房间号', async () => {
  createWxStub();
  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  roomPage.onLoad();
  await new Promise((resolve) => setTimeout(resolve, 0));
  roomPage.setData({ roomId: 'A1024', backendRoomId: '88' });

  const sharePayload = roomPage.onShareAppMessage();

  assert.match(sharePayload.path, /roomId=A1024/);
  assert.match(sharePayload.path, /backendRoomId=88/);
  assert.match(sharePayload.path, /scene=room/);
  assert.ok(sharePayload.path.startsWith('/pages/room/index?'));
});

test('头像空位与底部邀请都使用原生分享按钮，仅在联网房就绪后分享', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxml'), 'utf8');
  const buttons = wxml.match(/<button\b[^>]*bindtap="inviteFriend"[^>]*>/g);
  assert.equal(buttons.length, 2);
  assert.ok(buttons.some((button) => button.includes('slot-invite-btn')));
  for (const button of buttons) {
    assert.ok(button.includes('open-type="{{backendRoomId && shareEnabled ? \'share\' : \'\'}}"'));
    assert.ok(button.includes('disabled="{{starting || creatingOnlineRoom || !shareEnabled || roomUnavailable}}"'));
  }
});

test('房间邀请不受后台通用推广路径影响，分享关闭时不泄露房间参数', (t) => {
  createWxStub();
  const config = require('../utils/runtime-config');
  const getValue = config.getValue;
  t.mock.method(config, 'getValue', (key, fallback) => key === 'wechat.share_path' ? '/pages/shop/index' : getValue(key, fallback));
  const page = createPageInstance(loadPage('../pages/room/index.js'));
  page.setData({backendRoomId: '88', roomId: 'A&1024'});
  const payload = page.onShareAppMessage();
  assert.equal(payload.path, '/pages/room/index?roomId=A%261024&backendRoomId=88&scene=room');
  t.mock.method(config, 'getBoolean', (key, fallback) => key === 'wechat.share_enabled' ? false : fallback);
  assert.doesNotMatch(page.onShareAppMessage().path, /backendRoomId|roomId=/);
});

test('分享关闭时邀请入口不会创建联网房间', async (t) => {
  const calls = createWxStub();
  const config = require('../utils/runtime-config');
  const api = require('../utils/api-client');
  t.mock.method(config, 'getBoolean', (key, fallback) => key === 'wechat.share_enabled' ? false : fallback);
  const post = t.mock.method(api, 'post', async () => {throw new Error('不应建房');});
  const page = createPageInstance(loadPage('../pages/room/index.js'));
  await page.inviteFriend();
  assert.equal(post.mock.callCount(), 0);
  assert.equal(calls.showToast.at(-1).title, '邀请分享暂未开放');
});

test('邀请入口创建真实房间，重复点击不重复建房，分享携带新房间信息', async (t) => {
  const calls = createWxStub();
  const config = require('../utils/runtime-config');
  const api = require('../utils/api-client');
  api.setToken('invite-fixture');
  const store = require('../utils/game-store');
  store.__resetForTests();
  const beforePlayers = store.getState().players;
  t.mock.method(config, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(config, 'isApiSupported', () => true);
  let finishCreate;
  const post = t.mock.method(api, 'post', async () => new Promise((resolve) => {finishCreate = resolve;}));
  const page = createPageInstance(loadPage('../pages/room/index.js'));
  t.after(() => page.onUnload());
  const pending = page.inviteFriend();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.creatingOnlineRoom, true);
  await page.inviteFriend();
  assert.equal(post.mock.callCount(), 1);
  assert.equal(post.mock.calls[0].arguments[0], '/rooms');
  finishCreate({room: {id: 88, room_code: 'A1024'}, players: [{nick_name: '房主', is_self: true, is_host: true}]});
  await pending;
  assert.equal(page.data.creatingOnlineRoom, false);
  assert.equal(page.data.backendRoomId, '88');
  assert.equal(page.data.slots[0].name, '房主');
  assert.equal(calls.showToast.at(-1).title, '房间已建好，点击＋选择微信群');
  assert.deepEqual(store.getState().players, beforePlayers);
  const payload = page.onShareAppMessage();
  assert.match(payload.path, /backendRoomId=88/);
  assert.match(payload.path, /roomId=A1024/);
  await page.inviteFriend();
  assert.equal(post.mock.callCount(), 1);
});

test('邀请建房失败后仍可重试，不分享不存在的房间', async (t) => {
  const calls = createWxStub();
  const config = require('../utils/runtime-config');
  const api = require('../utils/api-client');
  api.setToken('invite-fixture');
  t.mock.method(config, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(config, 'isApiSupported', () => true);
  let attempts = 0;
  t.mock.method(api, 'post', async () => {
    if (++attempts === 1) throw new Error('连接中断');
    return {room: {id: 99, room_code: 'B2048'}, players: []};
  });
  const page = createPageInstance(loadPage('../pages/room/index.js'));
  t.after(() => page.onUnload());
  await page.inviteFriend();
  assert.equal(page.data.creatingOnlineRoom, false);
  assert.equal(page.data.backendRoomId, '');
  assert.equal(calls.showToast.at(-1).title, '连接中断');
  assert.doesNotMatch(page.onShareAppMessage().path, /backendRoomId|roomId=/);
  await page.inviteFriend();
  assert.equal(attempts, 2);
  assert.match(page.onShareAppMessage().path, /backendRoomId=99/);
});

test('首页收到房间分享参数会直接跳转到房间页', () => {
  const calls = createWxStub();
  const homePage = createPageInstance(loadPage('../pages/home/index.js'));

  homePage.onLoad({scene: 'room', backendRoomId: '88', roomId: 'A1024'});

  assert.equal(calls.redirectTo.length, 1);
  assert.equal(calls.redirectTo[0].url, '/pages/room/index?backendRoomId=88&roomId=A1024&scene=room');
});

test('房间页收到邀请参数会加入已有后端房间', async (t) => {
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  const calls = createWxStub();
  storage.set('game_codex_api_token_v1', 'token');
  wx.request = (payload) => {
    calls.request.push(payload);
    if (payload.url.includes('/rooms/88/join')) {
      payload.success({
        statusCode: 200,
        data: {
          code: 0,
          data: {
            room: {id: 88, room_code: 'A1024', stage_id: 1, status: 'waiting'},
            players: [
              {nick_name: '房主', avatar_url: 'a.png', is_ready: 1, is_host: 1},
              {nick_name: '好友', avatar_url: 'b.png', is_ready: 0, is_host: 0},
            ],
          },
        },
      });
      return;
    }
    payload.success({statusCode: 200, data: {code: 0, data: {}}});
  };

  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  roomPage.onLoad({backendRoomId: '88', roomId: 'A1024'});
  roomPage.onShow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  roomPage.clearPollTimer();
  roomPage.unsubscribeStore();

  assert.ok(calls.request.some((payload) => payload.url.includes('/rooms/88/join')));
  assert.equal(calls.request.some((payload) => payload.url.endsWith('/rooms')), false);
  assert.equal(roomPage.data.backendRoomId, '88');
  assert.equal(roomPage.data.roomId, 'A1024');
  assert.equal(roomPage.data.slots[0].name, '房主');
  assert.equal(roomPage.data.slots[1].state, '未准备');
});


test('房间页只有房间码（无 backendRoomId）时走 /rooms/code/:code/join 契约', async (t) => {
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  const calls = createWxStub();
  storage.set('game_codex_api_token_v1', 'token');
  wx.request = (payload) => {
    calls.request.push(payload);
    if (payload.url.includes('/rooms/code/A1024/join')) {
      payload.success({
        statusCode: 200,
        data: {
          code: 0,
          data: {
            room: {id: 88, room_code: 'A1024', stage_id: 1, status: 'waiting'},
            players: [{nick_name: '房主', avatar_url: 'a.png', is_ready: 1, is_host: 1}],
          },
        },
      });
      return;
    }
    payload.success({statusCode: 200, data: {code: 0, data: {}}});
  };

  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  roomPage.onLoad({roomId: 'A1024'});
  roomPage.onShow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  roomPage.clearPollTimer();
  roomPage.unsubscribeStore();

  assert.ok(calls.request.some((payload) => payload.url.includes('/rooms/code/A1024/join')));
  assert.equal(calls.request.some((payload) => payload.url.includes('/rooms/A1024/join')), false);
  assert.equal(calls.request.some((payload) => payload.url.endsWith('/rooms')), false);
  assert.equal(roomPage.data.backendRoomId, '88');
  assert.equal(roomPage.data.roomId, 'A1024');
});

test('规则视图适配器 onHide 暂停内存规则，恢复后续计', async () => {
  createWxStub();
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();
  gameStore.startGame({autoStartTimer: false, random: () => 0.2});

  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  require('./helpers/arena-view-fixture').attachRuleSimulation(arenaPage);
  try {
    arenaPage.onLoad();
    arenaPage.onShow();
    assert.equal(arenaPage.data.timeText, '120s');
    await arenaPage.onStartFromRules();

    gameStore.tick({random: () => 0.2}); // 119
    arenaPage.onHide();
    assert.equal(gameStore.getState().status, 'playing');

    // onShow 恢复后 tick 继续推进（时间由 store 驱动）
    arenaPage.onShow();
    gameStore.tick({random: () => 0.2});
    assert.equal(gameStore.getState().timeLeft, 118);
  } finally {
    // 清理页面定时器（福袋/表情等真实 setTimeout 链）与 store 定时器，避免挂起进程
    arenaPage.onUnload();
    gameStore.pauseGame();
  }
});

test('首次玩法介绍等待开始，再次查看玩法保持对局计时', async (t) => {
  createWxStub();
  storage.delete('game_codex_running_rules_v1');
  // 对局计时基于 Date.now() 的真实帧间隔，因此需要同时 mock Date，tick 才会推进对局时间
  t.mock.timers.enable({apis: ['setInterval', 'setTimeout', 'Date']});
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();
  gameStore.startGame({autoStartTimer: false, random: () => 0.2});
  const page = createPageInstance(loadPage('../pages/arena/index.js'));
  require('./helpers/arena-view-fixture').attachRuleSimulation(page);
  try {
    page.onLoad(); page.onShow();
    assert.equal(page.data.rulesVisible, true);
    t.mock.timers.tick(5000);
    assert.equal(gameStore.getState().timeLeft, 120);
    assert.equal(gameStore.getState().runWorld.drops.length, 0);
    await page.onStartFromRules();
    assert.equal(page.data.rulesVisible, false);
    assert.equal(storage.get('game_codex_running_rules_v1'), '1');
    t.mock.timers.tick(1000);
    assert.equal(gameStore.getState().timeLeft, 119);
    page.onOpenRules();
    t.mock.timers.tick(1000);
    assert.equal(gameStore.getState().timeLeft, 118);
    await page.onStartFromRules();
    page.onHide(); page.onShow();
    assert.equal(page.data.rulesVisible, false);
  } finally {page.onUnload(); gameStore.pauseGame(); t.mock.timers.reset();}
});

test('好友和房间分享使用随包封面，兼容后台旧纸张地址', (t) => {
  createWxStub();
  const config = require('../utils/runtime-config');
  const {buildShareAppMessage, buildShareTimeline} = require('../utils/share-config');
  let configuredImage = '';
  const original = config.getValue.bind(config);
  t.mock.method(config, 'getValue', (key, fallback) => {
    if (key === 'wechat.share_image_url' || key === 'wechat.share_timeline_image_url') return configuredImage;
    return original(key, fallback);
  });
  for (const oldImage of ['', 'https://xcx.ukb88.com/assets/bg/screen.png', '/assets-pkg/bg/screen.jpg']) {
    configuredImage = oldImage;
    for (const payload of [buildShareAppMessage(), buildShareAppMessage('room'), buildShareTimeline()]) {
      assert.equal(payload.imageUrl, '/assets-pkg/share/friends-20261111.jpg');
      assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', payload.imageUrl)));
    }
  }
  configuredImage = 'https://example.com/custom-share.jpg';
  assert.equal(buildShareAppMessage().imageUrl, configuredImage);
  assert.equal(buildShareTimeline().imageUrl, configuredImage);
});

test('分享时间线会优先使用后台配置的朋友圈图片', () => {
  createWxStub();
  const runtimeConfig = require('../utils/runtime-config');
  const originalGetValue = runtimeConfig.getValue;

  runtimeConfig.getValue = (key, fallback = '') => {
    if (key === 'wechat.share_timeline_title') return '朋友圈专用标题';
    if (key === 'wechat.share_timeline_image_url') return 'https://example.com/timeline.png';
    if (key === 'wechat.share_query') return 'from=admin_share';
    return originalGetValue(key, fallback);
  };

  try {
    const { buildShareTimeline } = require('../utils/share-config');
    const payload = buildShareTimeline('result');
    assert.equal(payload.title, '朋友圈专用标题');
    assert.equal(payload.imageUrl, 'https://example.com/timeline.png');
  } finally {
    runtimeConfig.getValue = originalGetValue;
  }
});

test('boot 页面在后台关闭微信登录时不会触发 wx.login', async () => {
  const calls = createWxStub();
  let loginCalled = 0;
  const originalLogin = wx.login;
  wx.login = (payload) => {
    loginCalled += 1;
    if (payload && typeof payload.fail === 'function') {
      payload.fail(new Error('should not login'));
    }
  };

  const runtimeConfig = require('../utils/runtime-config');
  const originalGetBoolean = runtimeConfig.getBoolean;
  runtimeConfig.getBoolean = (key, fallback = false) => {
    if (key === 'wechat.login_enabled') return false;
    return originalGetBoolean(key, fallback);
  };
  const legal = require('../utils/legal-config');
  const originalIsReady = legal.isReady;
  legal.isReady = () => true;
  wx.getPrivacySetting = ({success}) => success({needAuthorization: false});
  wx.requirePrivacyAuthorize = ({success}) => success({});
  wx.setStorageSync('legal-consent-version', `${legal.legalConfig.privacyVersion}:${legal.legalConfig.agreementVersion}`);

  try {
    const bootPage = createPageInstance(loadPage('../pages/boot/index.js'));
    bootPage._bootMinMs = 20;
    bootPage._bootMaxMs = 40;
    bootPage._bootHoldMs = 10;
    bootPage.onLoad();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(loginCalled, 0);
    assert.equal(calls.reLaunch.length, 1);
  } finally {
    wx.login = originalLogin;
    runtimeConfig.getBoolean = originalGetBoolean;
    legal.isReady = originalIsReady;
    wx.removeStorageSync('legal-consent-version');
  }
});

test('商城页仅展示锦鲤币价格，不包含现金价格或微信支付入口', () => {
  createWxStub();
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/shop/index.wxml'), 'utf8');
  const shopPage = createPageInstance(loadPage('../pages/shop/index.js'));
  shopPage.syncPage();

  assert.equal(shopPage.data.balanceText, '--');
  assert.equal(shopPage.data.loginRequired, true);
  assert.ok(shopPage.data.goods.some((item) => item.price > 0));
  assert.ok(shopPage.data.goods.every((item) => !('cashPriceText' in item)));
  assert.doesNotMatch(wxml, /payment-banner|wechat-price-badge|现金|充值/);
  assert.match(wxml, /class="coin-icon buy-coin-icon koi-coin"/);
  assert.match(wxml, /class="coin-icon asset-coin-icon koi-coin"/);
});



test('arena 页面会把已装备皮肤头像实时应用到自己的玩家节点', () => {
  createWxStub();
  const gameStore = require('../utils/game-store');
  const shopStore = require('../utils/shop-store');

  gameStore.__resetForTests();
  shopStore.__resetForTests();
  gameStore.startGame({ autoStartTimer: false });

  shopStore.purchaseItem('skin', 'skin-monk-bell');
  shopStore.equipItem('skin', 'skin-monk-bell');

  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  arenaPage.onLoad();
  arenaPage.onShow();
  assert.equal(arenaPage.appearance.skinImage, 'https://xcx.ukb88.com/assets/skins/skin-09.png');
  assert.equal(arenaPage.appearance.skinName, '净心行者');
  arenaPage.onUnload();
});

test('arena 页面会把已装备头像光环叠加到自己的玩家节点', () => {
  createWxStub();
  const gameStore = require('../utils/game-store');
  const shopStore = require('../utils/shop-store');

  gameStore.__resetForTests();
  shopStore.__resetForTests();
  gameStore.startGame({ autoStartTimer: false });

  shopStore.purchaseItem('ring', 'ring-crown-auspice');
  shopStore.equipItem('ring', 'ring-crown-auspice');

  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  arenaPage.onLoad();
  arenaPage.onShow();
  assert.equal(arenaPage.appearance.ringName, '瑞冠天光');
  assert.equal(arenaPage.appearance.ringImage, 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_07.png');
  arenaPage.onUnload();
});



test('arena 收到服务端 finished 状态时只跳结算，不触发客户端结算', () => {
  const calls = createWxStub();
  const page = createPageInstance(loadPage('../pages/arena/index.js'));
  page.sessionId = '9'; page.active = true;
  page.acceptState({status: 'finished', sessionId: '9'});
  assert.equal(calls.redirectTo.length, 1);
  assert.equal(calls.redirectTo[0].url, '/pages/result/index?sessionId=9');
});

test('arena 页面纯倒计时刷新不会重复推送玩家和连线整包数据', () => {
  createWxStub();
  const gameStore = require('../utils/game-store');
  const shopStore = require('../utils/shop-store');

  gameStore.__resetForTests();
  shopStore.__resetForTests();
  gameStore.startGame({ autoStartTimer: false, random: () => 0.2 });

  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  const patches = [];
  arenaPage.setData = function setDataWithLog(patch, callback) {
    patches.push(patch);
    this.data = {
      ...this.data,
      ...patch,
    };
    callback?.();
  };
  arenaPage.onLoad();
  arenaPage.active = true;

  const firstState = gameStore.getState();
  arenaPage.acceptState(firstState);
  patches.length = 0;

  arenaPage.acceptState({
    ...firstState,
    timeLeft: firstState.timeLeft - 1,
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0]), ['timeText']);
  assert.equal(patches[0].timeText, `${firstState.timeLeft - 1}s`);
  assert.equal('players' in patches[0], false);
  assert.equal('teamLinks' in patches[0], false);
});







test('arena 页高频战场元素不使用大面积无限动画', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.doesNotMatch(wxss, /\.timer\s*\{[\s\S]*timer-breathe[^;]*infinite/);
  assert.doesNotMatch(wxss, /\.team-link\s*\{[\s\S]*animation:\s*link-flow[^;]*infinite/);
  assert.doesNotMatch(wxss, /\.avatar-shell\s*\{[\s\S]*animation:\s*avatar-idle-float[^;]*infinite/);
  assert.doesNotMatch(wxss, /\.avatar-ring-overlay\s*\{[\s\S]*animation:\s*ring-sparkle[^;]*infinite/);
});





test('arena 页面不会再为自己头像额外渲染 我 标签', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.doesNotMatch(wxml, /class="self-tag"/);
  assert.doesNotMatch(wxss, /\.self-tag\s*\{/);
});









test('福袋和结算音效会切到新的资源文件', () => {
  const audioJs = fs.readFileSync(path.join(__dirname, '../utils/audio.js'), 'utf8');
  const investmentJs = fs.readFileSync(path.join(__dirname, '../utils/investment.js'), 'utf8');
  const resultJs = fs.readFileSync(path.join(__dirname, '../pages/result/index.js'), 'utf8');
  const projectConfig = fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf8');

  assert.match(audioJs, /resultWin:\s*'https:\/\/xcx\.ukb88\.com\/assets\/audio\/result\/yanhua\.mp3'/);
  assert.match(audioJs, /bgm:\s*'https:\/\/xcx\.ukb88\.com\/assets\/audio\/result\/bgm\.mp3'/);
  assert.match(audioJs, /changcheng:\s*'https:\/\/xcx\.ukb88\.com\/assets\/audio\/result\/changcheng\.mp3'/);
  assert.match(audioJs, /'万里长城':\s*SOURCES\.changcheng/);
  assert.match(investmentJs, /FORTUNE_BAG_ASSETS[\s\S]*fortune-fangchan\.png/);
  assert.match(investmentJs, /FORTUNE_BAG_ASSETS[\s\S]*fortune-gupiao\.png/);
  assert.doesNotMatch(investmentJs, /bitebi/);
  assert.match(resultJs, /playResultWinAudio\(\)/);
  assert.match(projectConfig, /assets\/iocns\/2657\.png_300\.png/);
});

test('结算页新成就区域会展示勋章', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxss'), 'utf8');

  assert.match(wxml, /class="achievement-medal"/);
  assert.match(wxml, /achievementMedal\.symbol/);
  assert.match(wxml, /achievementMedal\.tierLabel/);
  assert.match(wxss, /\.medal-core\s*\{/);
  assert.match(wxss, /--medal-accent/);
});

test('结算页会提供你是锦鲤揭晓特效', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxss'), 'utf8');

  assert.match(wxml, /class="koi-effect-layer"/);
  assert.match(wxml, /你是锦鲤/);
  assert.match(wxml, /收下好运/);
  // 锦鲤装饰改为纯 CSS 圆点（原 result-koi.png 不存在，避免 404）
  assert.doesNotMatch(wxml, /result-koi\.png/);
  assert.doesNotMatch(wxml, /koi-seal/);
  assert.match(wxss, /\.koi-reveal-card\s*\{/);
  assert.doesNotMatch(wxss, /\.koi-seal\s*\{/);
  assert.match(wxss, /@keyframes koi-card-pop/);
  assert.match(wxss, /@keyframes koi-swim-left/);
});

test('结算页背景使用静态景区图层，避免视频遮罩导致黑屏', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/result/index.wxml'), 'utf8');

  assert.match(wxml, /class="scene-backdrop theme-page-backdrop result-scene-backdrop"/);
  assert.doesNotMatch(wxml, /scene-backdrop-video/);
  assert.doesNotMatch(wxml, /<video[\s\S]*result-scene-backdrop/);
});

test('结算页只在 onShow 刷新结果，避免进入页面时重复刷新', async () => {
  createWxStub();
  const resultPage = createPageInstance(loadPage('../pages/result/index.js'));
  let refreshCalls = 0;
  resultPage.refreshResult = async () => {
    refreshCalls += 1;
  };

  resultPage.onLoad();
  assert.equal(refreshCalls, 0);

  await resultPage.onShow();
  assert.equal(refreshCalls, 1);
});

test('app 启动时不播放背景音乐，仅从后台返回前台时重新触发', () => {
  createWxStub();
  const playStageBgmCalls = [];
  const app = loadAppWithStubbedAudio({
    playStageBgm(stage, options) {
      playStageBgmCalls.push({stage, options});
      return null;
    },
  });

  assert.ok(app);
  assert.equal(playStageBgmCalls.length, 0);
  app.onShow();
  assert.equal(playStageBgmCalls.length, 1);
  assert.equal(playStageBgmCalls[0].stage.name, '万里长城');
  assert.deepEqual(playStageBgmCalls[0].options, { volume: 0.38 });
});

test('各场景主题会切换到对应的本地背景音乐', () => {
  createWxStub();
  const cases = [
    ['万里长城', 'https://xcx.ukb88.com/assets/audio/result/changcheng.mp3'],
    ['富士山', 'https://xcx.ukb88.com/assets/audio/result/富士山下音频.mp3'],
    ['巴黎铁塔', 'https://xcx.ukb88.com/assets/audio/result/埃菲尔音频.mp3'],
    ['大峡谷', 'https://xcx.ukb88.com/assets/audio/result/美洲大峡谷音频.mp3'],
    ['泰姬陵', 'https://xcx.ukb88.com/assets/audio/result/泰姬陵音频.mp3'],
    ['西湖夜游', 'https://xcx.ukb88.com/assets/audio/result/西湖夜景音频.mp3'],
  ];

  cases.forEach(([stageName, expectedSrc]) => {
    const audioEvents = [];
    global.wx.createInnerAudioContext = () => ({
      stop() {
        audioEvents.push('stop');
      },
      destroy() {},
      seek() {
        audioEvents.push('seek');
      },
      play() {
        audioEvents.push('play');
      },
      onError() {},
      set src(value) {
        audioEvents.push(`src:${value}`);
      },
      get src() {
        return '';
      },
      set loop(value) {
        audioEvents.push(`loop:${value}`);
      },
      set volume(value) {
        audioEvents.push(`volume:${value}`);
      },
    });

    const audio = loadAudioModule();
    audio.playStageBgm({name: stageName}, {volume: 0.44});

    assert.ok(audioEvents.includes(`src:${expectedSrc}`));
    assert.ok(audioEvents.includes('loop:true'));
    assert.ok(audioEvents.includes('volume:0.2552'));
    assert.ok(!audioEvents.includes('stop'));
    assert.ok(!audioEvents.includes('seek'));
  });
});

test('语音播报会使用独立 voice 资源并在播放时压低背景音乐', () => {
  createWxStub();
  const audioContexts = [];
  global.wx.createInnerAudioContext = () => {
    const context = {
      stop() {
        this.stopped = true;
      },
      destroy() {},
      seek() {
        this.seeked = true;
      },
      play() {
        this.played = true;
      },
      onEnded(handler) {
        this.endedHandler = handler;
      },
      onError() {},
      set src(value) {
        this._src = value;
      },
      set loop(value) {
        this._loop = value;
      },
      set volume(value) {
        this._volume = value;
        this.volumeEvents = [...(this.volumeEvents || []), value];
      },
    };
    audioContexts.push(context);
    return context;
  };

  const audio = loadAudioModule();
  audio.playStageBgm({name: '万里长城'}, {volume: 0.44});
  audio.playVoice('homeGuide', {debounceMs: 0, duckVolume: 0.12});

  assert.equal(audioContexts.length, 2);
  assert.equal(audioContexts[1]._src, 'https://xcx.ukb88.com/assets/audio/voice/home-guide.mp3');
  assert.equal(audioContexts[1]._loop, false);
  assert.ok(audioContexts[1].played);
  assert.ok(audioContexts[0].volumeEvents.includes(0.0696));

  audioContexts[1].endedHandler();
  assert.equal(audioContexts[0]._volume, 0.2552);
  assert.equal(audio.playVoice('missingVoiceKey'), null);
});

test('设备信息新 API 可用时，震动判断不调用废弃的系统信息 API', () => {
  const calls = createWxStub();
  wx.getSystemInfoSync = () => {throw new Error('不应调用废弃 API');};
  wx.getDeviceInfo = () => ({platform: 'devtools'});
  const audio = loadAudioModule();
  audio.playVibrate('light');
  assert.deepEqual(calls.vibrateShort, []);
  wx.getDeviceInfo = () => ({platform: 'android'});
  audio.playVibrate('medium');
  assert.deepEqual(calls.vibrateShort, [{type: 'medium'}]);
});

test('模拟器播放音乐跳过不支持的全局音频选项，真机只初始化一次并处理失败', (t) => {
  createWxStub();
  const options = [];
  wx.getDeviceInfo = () => ({platform: 'devtools'});
  wx.setInnerAudioOption = (value) => options.push(value);
  loadAudioModule().playStageBgm({name: '万里长城'});
  assert.deepEqual(options, []);

  wx.getDeviceInfo = () => ({platform: 'ios'});
  const audio = loadAudioModule();
  audio.playStageBgm({name: '万里长城'});
  audio.playStageBgm({name: '富士山'});
  assert.equal(options.length, 1);
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  options[0].fail({errMsg: 'setInnerAudioOption:fail'});
  assert.equal(warnings.length, 1);
});

test('震动反馈只在真机平台触发，开发者工具不触发', () => {
  const calls = createWxStub();
  const originalGetSystemInfoSync = global.wx.getSystemInfoSync;
  const audio = loadAudioModule();

  global.wx.getSystemInfoSync = () => ({
    statusBarHeight: 20,
    windowWidth: 375,
    platform: 'devtools',
  });
  audio.playVibrate('light');
  assert.equal(calls.vibrateShort.length, 0);

  global.wx.getSystemInfoSync = () => ({
    statusBarHeight: 20,
    windowWidth: 375,
    platform: 'android',
  });
  audio.playVibrate('medium');
  assert.deepEqual(calls.vibrateShort, [{type: 'medium'}]);

  global.wx.getSystemInfoSync = originalGetSystemInfoSync;
});

test('房间倒计时会触发语音播报', () => {
  createWxStub();
  const voiceCalls = [];
  const audioPath = require.resolve('../utils/audio.js');
  const originalAudioModule = require.cache[audioPath];
  require.cache[audioPath] = {
    id: audioPath,
    filename: audioPath,
    loaded: true,
    exports: {
      playCue() {},
      playStageBgm() {},
      playVibrate() {},
      playVoice(name) {
        voiceCalls.push(name);
      },
    },
  };

  try {
    const roomPage = createPageInstance(loadPage('../pages/room/index.js'));

    roomPage.setData({backendRoomId: '88', isHost: true, unreadyNames: ['好友']});
    roomPage.start();
    assert.equal(roomPage.data.starting, false);
    assert.equal(voiceCalls.includes('countdown3'), false);

    roomPage.setData({unreadyNames: []});
    roomPage.start();
    assert.ok(voiceCalls.includes('countdown3'));
    roomPage.clearStartCountdown();
  } finally {
    if (originalAudioModule) {
      require.cache[audioPath] = originalAudioModule;
    } else {
      delete require.cache[audioPath];
    }
  }
});



test('结算页会按排名触发语音播报', () => {
  createWxStub();
  const voiceCalls = [];
  const resultPage = loadPageWithStubbedAudio('../pages/result/index.js', {
    stopBgm() {},
    playCue() {},
    playVibrate() {},
    playVoice(name) {
      voiceCalls.push(name);
    },
  });

  resultPage.setData({isKoiWinner: false});
  resultPage.playResultVoice();
  assert.ok(voiceCalls.includes('resultComplete'));
  resultPage.clearResultVoiceTimer();

  resultPage.setData({resultId: 'result-koi', isKoiWinner: true});
  resultPage.playKoiEffect();
  assert.ok(voiceCalls.includes('resultKoi'));
});

test('结算页炮声会等当前音频播完再接下一次', () => {
  createWxStub();
  const audioContexts = [];
  global.wx.createInnerAudioContext = () => {
    const context = {
      stop() {},
      destroy() {},
      play() {
        this.playCount = (this.playCount || 0) + 1;
      },
      onEnded(handler) {
        this.endedHandler = handler;
      },
      onError() {},
      set src(value) {
        this._src = value;
      },
      set volume(value) {
        this._volume = value;
      },
      set loop(value) {
        this._loop = value;
      },
    };
    audioContexts.push(context);
    return context;
  };

  const resultPage = createPageInstance(loadPage('../pages/result/index.js'));
  resultPage.setData({
    resultId: 'result-001',
  });

  resultPage.playResultFirework();

  assert.equal(audioContexts.length, 1);
  assert.equal(audioContexts[0]._src, 'https://xcx.ukb88.com/assets/audio/result/yanhua.mp3');
  assert.equal(audioContexts[0]._loop, false);

  audioContexts[0].endedHandler();

  assert.equal(audioContexts.length, 2);
  assert.equal(audioContexts[1]._src, 'https://xcx.ukb88.com/assets/audio/result/yanhua.mp3');
});

test('结算页烟花续播会自动停止，避免结果页长期刷新', () => {
  createWxStub();
  const audioContexts = [];
  global.wx.createInnerAudioContext = () => {
    const context = {
      stop() {
        this.stopped = true;
      },
      destroy() {
        this.destroyed = true;
      },
      play() {
        this.playCount = (this.playCount || 0) + 1;
      },
      onEnded(handler) {
        this.endedHandler = handler;
      },
      onError() {},
      set src(value) {
        this._src = value;
      },
      set volume(value) {
        this._volume = value;
      },
      set loop(value) {
        this._loop = value;
      },
    };
    audioContexts.push(context);
    return context;
  };

  const resultPage = createPageInstance(loadPage('../pages/result/index.js'));
  resultPage.setData({resultId: 'result-001'});
  resultPage.playResultFirework();

  for (let index = 0; index < 8; index += 1) {
    const latest = audioContexts[audioContexts.length - 1];
    if (!latest || typeof latest.endedHandler !== 'function') {
      break;
    }
    latest.endedHandler();
  }

  assert.equal(audioContexts.length, 3);
  assert.equal(resultPage.resultFireworkActive, false);
  assert.equal(resultPage.data.showFireworks, false);
});

test('结算页第一名玩家会触发锦鲤弹层', () => {
  createWxStub();
  const resultPage = createPageInstance(loadPage('../pages/result/index.js'));
  resultPage.setData({
    resultId: 'result-koi',
    isKoiWinner: true,
  });

  resultPage.playKoiEffect();

  assert.equal(resultPage.data.showKoiEffect, true);
  assert.equal(resultPage.data.koiCtaVisible, false);

  resultPage.closeKoiEffect({silent: true});
  assert.equal(resultPage.data.showKoiEffect, false);
});

test('结算页进入时会先停掉背景音乐', () => {
  createWxStub();
  const calls = [];
  loadPageWithStubbedAudio('../pages/result/index.js', {
    stopBgm() {
      calls.push('stopBgm');
    },
    playCue() {},
    playVibrate() {},
  });

  assert.deepEqual(calls, ['stopBgm']);
});

test('商城页不依赖平台类型，也不会暴露微信支付能力', () => {
  createWxStub();
  const shopPage = createPageInstance(loadPage('../pages/shop/index.js'));
  shopPage.onLoad();
  shopPage.syncPage();
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/shop/index.wxml'), 'utf8');

  assert.equal('isIOS' in shopPage.data, false);
  assert.equal('payEnabled' in shopPage.data, false);
  assert.doesNotMatch(wxml, /payment-banner|wechat-price-badge/);
});

test('all game page lifecycle entries stop before business effects when consent is missing', () => {
  const calls = createWxStub();
  privacyConsent.isAllowed = () => false;
  privacyConsent.canEnter = () => false;
  const gameStore = require('../utils/game-store');
  const before = JSON.stringify(gameStore.getState());
  for (const name of ['home', 'room', 'arena', 'shop', 'profile', 'income', 'result']) {
    const page = createPageInstance(loadPage(`../pages/${name}/index.js`));
    page.onLoad({backendRoomId: '28'});
    if (page.onShow) page.onShow();
    assert.equal(page.data.nav.statusBarHeight, 20, name);
  }
  assert.equal(calls.request.length, 0);
  assert.equal(calls.login.length, 0);
  assert.equal(calls.redirectTo.length, 0);
  assert.equal(JSON.stringify(gameStore.getState()), before);
});

test('四个底部导航默认收起，仅点击右侧箭头展开', () => {
  for (const name of ['home', 'room', 'arena', 'result']) {
    const wxml = fs.readFileSync(path.join(__dirname, `../pages/${name}/index.wxml`), 'utf8');
    assert.match(wxml, /class="bottom-nav[^"]*\{\{navExpanded \? 'expanded' : 'collapsed'\}\}"/, name);
    assert.match(wxml, /<block wx:if="\{\{navExpanded\}\}">\s*<view wx:for="\{\{ tabs \}\}"/, name);
    assert.match(wxml, /class="nav-toggle" catchtap="toggleNav"/, name);
    const page = createPageInstance(loadPage(`../pages/${name}/index.js`));
    assert.equal(page.data.navExpanded, false, name);
    page.toggleNav();
    assert.equal(page.data.navExpanded, true, name);
    page.toggleNav();
    assert.equal(page.data.navExpanded, false, name);
  }
  const appWxss = fs.readFileSync(path.join(__dirname, '../app.wxss'), 'utf8');
  assert.match(appWxss, /\.bottom-nav\.collapsed\s*\{/);
});

test('首页入口按钮和引导按钮随底部导航展开/收起同步升降', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');
  assert.match(wxml, /class="home-entry-actions[^"]*\{\{navExpanded \? '' : 'nav-collapsed'\}\}"/);
  assert.match(wxml, /class="guide-action-panel[^"]*\{\{navExpanded \? 'nav-open' : ''\}\}"/);
  assert.match(wxss, /\.home-entry-actions\.nav-collapsed\s*\{\s*bottom:calc\(128rpx/);
  assert.match(wxss, /\.guide-home \.guide-action-panel\.nav-open\s*\{\s*bottom: calc\(166rpx/);
});
