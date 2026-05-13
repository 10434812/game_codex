const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storage = new Map();

function createWxStub() {
  const calls = {
    navigateTo: [],
    redirectTo: [],
    reLaunch: [],
    showToast: [],
    showShareMenu: [],
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
        onError() { },
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
    vibrateShort() {},
    getUserProfile() {
      return Promise.reject(new Error('not implemented'));
    },
    login(payload) {
      if (payload && typeof payload.fail === 'function') {
        payload.fail(new Error('not implemented'));
      }
    },
    hideLoading() {},
    showLoading() {},
    request(payload) {
      if (payload && typeof payload.success === 'function') {
        payload.success({
          statusCode: 200,
          data: {
            code: 0,
            data: {},
          },
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
    setData(patch) {
      this.data = {
        ...this.data,
        ...patch,
      };
    },
  };
}

test.beforeEach(() => {
  storage.clear();
});

test('room 页面会完整展示 10 个房间槽位并把活跃度限制在 100%', () => {
  createWxStub();
  const engine = require('../utils/game-engine');
  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  const players = engine.createInitialPlayers({
    count: 10,
    random: () => 0.2,
  });

  roomPage.observeState({
    status: 'room',
    players,
    stage: { name: '万里长城' },
    roomId: '1024',
    modeText: '本地体验',
  });

  assert.equal(roomPage.data.slots.length, 10);
  assert.equal(roomPage.data.slots[9].name, players[9].name);
  assert.equal(roomPage.data.activePercent, 100);
});

test('room 页面会提示准备后两分钟内开始游戏', () => {
  const roomJs = fs.readFileSync(path.join(__dirname, '../pages/room/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');

  assert.match(roomJs, /roomHintText:\s*'准备好后，游戏将在两分钟内开始'/);
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

test('arena 后端模式使用 HTTP 轮询而不是原生 WebSocket 直连 Socket.IO', () => {
  const arenaJs = fs.readFileSync(path.join(__dirname, '../pages/arena/index.js'), 'utf8');

  assert.doesNotMatch(arenaJs, /wx\.connectSocket|ws:\/\/localhost/);
  assert.match(arenaJs, /startArenaPolling/);
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

test('profile 页面使用 wx.getUserProfile 而不是新版头像昵称填写能力', () => {
  const profileJs = fs.readFileSync(path.join(__dirname, '../pages/profile/index.js'), 'utf8');
  const profileWxml = fs.readFileSync(path.join(__dirname, '../pages/profile/index.wxml'), 'utf8');

  assert.match(profileJs, /getUserProfile/);
  assert.doesNotMatch(profileWxml, /open-type="chooseAvatar"|type="nickname"/);
});

test('arena 底部导航仍属于 page-content 主内容容器', () => {
  const arenaWxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const bottomNavIndex = arenaWxml.indexOf('class="bottom-nav"');
  const pageContentCloseIndex = arenaWxml.indexOf('\n  </view>\n\n  <view class="bottom-nav"');

  assert.ok(bottomNavIndex > arenaWxml.indexOf('class="page-content"'));
  assert.equal(pageContentCloseIndex, -1);
});

test('room 页面下方两个社交操作按钮使用白色背景', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');

  assert.match(wxss, /\.invite-btn\s*\{[\s\S]*background:\s*rgba\(255,\s*253,\s*246,\s*0\.96\);[\s\S]*color:\s*#c96a10;/);
  assert.match(wxss, /\.ready-btn\s*\{[\s\S]*background:\s*rgba\(255,\s*253,\s*246,\s*0\.96\);[\s\S]*color:\s*#c96a10;/);
});

test('room 页面开始游戏按钮会变小并居中', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/room/index.wxss'), 'utf8');

  assert.match(wxss, /\.start-btn\s*\{[\s\S]*width:\s*560rpx\s*!important;[\s\S]*max-width:\s*calc\(100%\s*-\s*80rpx\)\s*!important;[\s\S]*margin:\s*0 auto 18rpx;/);
});

test('home 页面在没有结算结果时点击历史 Tab 不会误跳转', () => {
  const calls = createWxStub();
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();

  const homePage = createPageInstance(loadPage('../pages/home/index.js'));
  homePage.switchTab({
    currentTarget: {
      dataset: {
        page: '/pages/result/index',
      },
    },
  });

  assert.equal(calls.redirectTo.length, 0);
  assert.equal(calls.showToast.length, 1);
});

test('home 页面在零经验时也会显示轻微进度填充', () => {
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
  assert.equal(homePage.data.progressVisualPercent, 10);
});

test('home 景区卡片标题会缩小并使用景区主题色', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');
  const {STAGES} = require('../utils/constants');

  assert.match(wxml, /--stage-title-color:\s*\{\{\s*item\.titleColor\s*\}\}/);
  assert.match(wxml, /--stage-accent-color:\s*\{\{\s*item\.accentColor\s*\}\}/);
  assert.match(wxss, /\.dest-name\s*\{[\s\S]*font-size:\s*48rpx;[\s\S]*color:\s*var\(--stage-title-color,\s*#c76d11\);/);
  assert.match(wxss, /\.dest-meta\s*\{[\s\S]*color:\s*var\(--stage-accent-color,\s*#e08a18\);/);

  for (const stage of STAGES) {
    assert.match(stage.titleColor, /^#[0-9a-f]{6}$/i);
    assert.match(stage.accentColor, /^#[0-9a-f]{6}$/i);
  }
  assert.notEqual(STAGES[0].titleColor, STAGES[1].titleColor);
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
  assert.match(roomWxss, /@keyframes activity-flow/);
  assert.match(arenaWxss, /@keyframes timer-breathe/);
  assert.match(arenaWxss, /@keyframes self-avatar-pulse/);
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

  assert.match(wxss, /\.start-btn\s*\{[\s\S]*position:\s*fixed;[\s\S]*bottom:\s*166rpx;[\s\S]*z-index:\s*18;/);
  assert.match(wxss, /\.home-page \.bottom-nav\s*\{[\s\S]*z-index:\s*20;/);
  assert.match(wxss, /\.home-page \.page-content\s*\{[\s\S]*padding-bottom:\s*260rpx;/);
});

test('boot 页面会引用开机动画并把进度条放进启动页', () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/boot/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/boot/index.wxss'), 'utf8');

  assert.equal(appJson.pages[0], 'pages/boot/index');
  assert.match(wxml, /bootVideoSrc|开机动画/);
  assert.match(wxml, /class="boot-progress-shell"/);
  assert.match(wxss, /\.boot-progress-fill\s*\{/);
  assert.doesNotMatch(wxml, /boot-brand|boot-pill|boot-header/);
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

test('boot 页面会在预加载结束后跳回首页', async () => {
  const calls = createWxStub();
  const bootPage = createPageInstance(loadPage('../pages/boot/index.js'));

  // Inject short timers for testing (production uses 2000/2700/300ms)
  bootPage._bootMinMs = 50;
  bootPage._bootMaxMs = 150;
  bootPage._bootHoldMs = 30;

  bootPage.onLoad();
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(calls.reLaunch.length, 1);
  assert.equal(calls.reLaunch[0].url, '/pages/home/index');
  assert.equal(bootPage.data.progress, 100);
});

test('room 页面在没有结算结果时点击历史 Tab 不会误跳转', () => {
  const calls = createWxStub();
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();

  const roomPage = createPageInstance(loadPage('../pages/room/index.js'));
  roomPage.switchTab({
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
  roomPage.setData({ roomId: 'A1024' });

  const sharePayload = roomPage.onShareAppMessage();

  assert.match(sharePayload.path, /roomId=A1024/);
  assert.match(sharePayload.path, /scene=room/);
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
  }
});

test('商城页会显示后台支付配置状态', () => {
  createWxStub();
  const runtimeConfig = require('../utils/runtime-config');
  const originalGetBoolean = runtimeConfig.getBoolean;
  const originalGetValue = runtimeConfig.getValue;

  runtimeConfig.getBoolean = (key, fallback = false) => {
    if (key === 'wechat.pay_enabled') return true;
    return originalGetBoolean(key, fallback);
  };
  runtimeConfig.getValue = (key, fallback = '') => {
    if (key === 'wechat.pay_goods_desc') return '锦鲤前程充值包';
    if (key === 'wechat.pay_currency') return 'CNY';
    return originalGetValue(key, fallback);
  };

  try {
    const shopPage = createPageInstance(loadPage('../pages/shop/index.js'));
    shopPage.syncPage();
    assert.equal(shopPage.data.payEnabled, true);
    assert.match(shopPage.data.payStatusText, /已开启/);
    assert.match(shopPage.data.payHintText, /锦鲤前程充值包/);
  } finally {
    runtimeConfig.getBoolean = originalGetBoolean;
    runtimeConfig.getValue = originalGetValue;
  }
});

test('arena 页面把玩家名字渲染在头像之后的独立层，避免被头像遮挡', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const playerNodeIndex = wxml.indexOf('class="player-node');
  const nameLayerIndex = wxml.indexOf('class="player-name-layer"');

  assert.ok(playerNodeIndex >= 0);
  assert.ok(nameLayerIndex > playerNodeIndex);
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
  arenaPage.syncShopDisplay();
  arenaPage.syncArena(gameStore.getState());

  const selfPlayer = arenaPage.data.players.find((player) => player.isSelf);
  assert.equal(selfPlayer.avatar, 'https://xcx.ukb88.com/assets/skins/skin-09.png');
  assert.equal(selfPlayer.skinName, '净心行者');
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
  arenaPage.syncShopDisplay();
  arenaPage.syncArena(gameStore.getState());

  const selfPlayer = arenaPage.data.players.find((player) => player.isSelf);
  assert.equal(selfPlayer.ringName, '瑞冠天光');
  assert.equal(selfPlayer.ringImage, 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_07.png');
});

test('arena 页面收到 finished 状态时只跳结算，不会再次触发 finishGame', () => {
  const calls = createWxStub();
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();

  let subscribedListener = null;
  let finishCalls = 0;
  const originalSubscribe = gameStore.subscribe;
  const originalFinishGame = gameStore.finishGame;
  gameStore.subscribe = (listener) => {
    subscribedListener = listener;
    return () => {};
  };
  gameStore.finishGame = () => {
    finishCalls += 1;
    return {status: 'finished'};
  };

  try {
    const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
    arenaPage.onLoad();
    arenaPage.onShow();
    assert.equal(typeof subscribedListener, 'function');

    subscribedListener({status: 'finished'});

    assert.equal(finishCalls, 0);
    assert.equal(calls.redirectTo.length, 1);
    assert.equal(calls.redirectTo[0].url, '/pages/result/index');
  } finally {
    gameStore.subscribe = originalSubscribe;
    gameStore.finishGame = originalFinishGame;
    gameStore.__resetForTests();
  }
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
  arenaPage.setData = function setDataWithLog(patch) {
    patches.push(patch);
    this.data = {
      ...this.data,
      ...patch,
    };
  };
  arenaPage.onLoad();
  arenaPage.syncShopDisplay();

  const firstState = gameStore.getState();
  arenaPage.syncArena(firstState);
  patches.length = 0;

  arenaPage.syncArena({
    ...firstState,
    timeLeft: firstState.timeLeft - 1,
  });

  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0]), ['timeText']);
  assert.equal(patches[0].timeText, `${firstState.timeLeft - 1}s`);
  assert.equal('players' in patches[0], false);
  assert.equal('teamLinks' in patches[0], false);
});

test('arena 页会为自己的宠物渲染独立跟随层，而不是只显示纯文字徽章', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.match(wxml, /class="pet-follower"/);
  assert.match(wxml, /class="pet-avatar"/);
  assert.match(wxml, /src="\{\{ item\.petImage \}\}"/);
  assert.doesNotMatch(wxml, /pet-name-pill/);
  assert.match(wxss, /\.pet-follower\s*\{[\s\S]*top:\s*-8rpx;[\s\S]*left:\s*108rpx;/);
  assert.doesNotMatch(wxss, /\.pet-avatar-shell\s*\{[^}]*border:/);
});

test('arena 页的聊天气泡会保持单行横排，不会把中间玩家的短句拆成竖排', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.match(wxss, /\.emote-bubble\s*\{[\s\S]*white-space:\s*nowrap;[\s\S]*word-break:\s*keep-all;/);
});

test('arena 页底部浮层使用实色纸面，避免玩家内容透出', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.match(wxss, /\.invest-panel\s*\{[\s\S]*background:\s*#fff8ea;[\s\S]*z-index:\s*30;/);
  assert.match(wxss, /\.message-reply-card\s*\{[\s\S]*background:\s*#fff8e8;[\s\S]*z-index:\s*26;/);
  assert.match(wxss, /\.invest-btn\.ghost\s*\{[\s\S]*background:\s*#f3e5c7;/);
  assert.match(wxss, /\.quick-reply-chip\s*\{[\s\S]*background:\s*#ead2ab;/);
});

test('arena 页高频战场元素不使用大面积无限动画', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.doesNotMatch(wxss, /\.timer\s*\{[\s\S]*timer-breathe[^;]*infinite/);
  assert.doesNotMatch(wxss, /\.team-link\s*\{[\s\S]*animation:\s*link-flow[^;]*infinite/);
  assert.doesNotMatch(wxss, /\.avatar-shell\s*\{[\s\S]*animation:\s*avatar-idle-float[^;]*infinite/);
  assert.doesNotMatch(wxss, /\.avatar-ring-overlay\s*\{[\s\S]*animation:\s*ring-sparkle[^;]*infinite/);
});

test('arena 页的福袋会保持居中并保留足够的视觉权重', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');

  assert.match(wxss, /\.fortune-bag-wrap\s*\{[\s\S]*width:\s*220rpx;[\s\S]*height:\s*250rpx;/);
  assert.match(wxss, /\.fortune-bag-image\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0;[\s\S]*left:\s*0;[\s\S]*width:\s*220rpx;[\s\S]*height:\s*220rpx;/);
  assert.match(wxss, /\.fortune-bag-countdown\s*\{[\s\S]*top:\s*184rpx;/);
  assert.doesNotMatch(wxss, /\.fortune-bag-shell\s*\{/);
  assert.doesNotMatch(wxss, /\.fortune-bag-label\s*\{/);
  assert.match(wxml, /fortune-bag-countdown/);
  assert.match(wxml, /fortune-panel/);
  assert.match(wxml, /invest-head-icon/);
  assert.match(wxml, /确认卖出/);
  assert.match(wxss, /\.invest-panel\s*\{[\s\S]*left:\s*16rpx;[\s\S]*right:\s*16rpx;[\s\S]*min-height:\s*340rpx;/);
  assert.match(wxss, /\.invest-panel\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/);
  assert.match(wxss, /\.invest-actions\s*\{[\s\S]*margin-top:\s*auto;/);
});

test('arena 页面不会再为自己头像额外渲染 我 标签', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.doesNotMatch(wxml, /class="self-tag"/);
  assert.doesNotMatch(wxss, /\.self-tag\s*\{/);
});

test('arena 页面在血条模式下不会继续渲染玩家名字文字', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');

  assert.match(wxml, /wx:if="\{\{ !item\.showScore \|\| item\.isSelf \}\}"/);
});

test('arena 页面在持仓存在时再次点红包会直接切到卖出面板', () => {
  createWxStub();
  const gameStore = require('../utils/game-store');
  const shopStore = require('../utils/shop-store');

  gameStore.__resetForTests();
  shopStore.__resetForTests();
  gameStore.startGame({ autoStartTimer: false });

  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  arenaPage.onLoad();
  arenaPage.syncShopDisplay();
  arenaPage.syncArena(gameStore.getState());
  arenaPage.setData({
    fortuneBag: {
      id: 'bag-test',
      x: 240,
      y: 320,
      asset: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
      opportunity: {
        category: '股票',
        name: '测试机会',
        asset: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
      },
    },
    activePosition: {
      id: 'pos-test',
      ownerId: 'player-self',
      category: '股票',
      name: '测试持仓',
      riskLevel: 'mid',
      riskText: '中波动',
      cost: 200,
      buyAt: Date.now() - 12000,
      asset: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
    },
  });

  arenaPage.onTapFortuneBag({
    currentTarget: {
      dataset: {},
    },
  });

  assert.equal(arenaPage.data.fortunePanelVisible, true);
  assert.equal(arenaPage.data.activeOpportunity, null);
  assert.match(arenaPage.data.actionHintText, /卖出/);
  assert.equal(arenaPage.data.activePosition.name, '测试持仓');
  assert.equal(arenaPage.data.fortunePanelAsset, 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png');
});

test('arena 页面福袋不会再套一层 shell', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.match(wxml, /<image class="fortune-bag-image" src="\{\{ fortuneBag\.asset \}\}" mode="aspectFit"><\/image>/);
  assert.doesNotMatch(wxml, /fortune-bag-shell/);
  assert.doesNotMatch(wxss, /\.fortune-bag-shell/);
  assert.doesNotMatch(wxml, /fortune-bag-label/);
});

test('arena 页面头像最外层黑框会去掉且橘色外框更窄', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');

  assert.match(wxss, /\.avatar-shell\s*\{[\s\S]*padding:\s*var\(--avatar-ring-padding,\s*3rpx\);/);
  assert.match(wxss, /\.avatar \{[\s\S]*border:\s*0;/);
  assert.match(wxss, /\.self-avatar-shell\s*\{[\s\S]*box-shadow:[\s\S]*3rpx/);
  assert.match(wxml, /class="avatar-ring-overlay"/);
  assert.match(wxss, /\.avatar-ring-overlay\s*\{[\s\S]*position:\s*absolute;/);
});

test('红包和结算音效会切到新的资源文件', () => {
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
  assert.match(investmentJs, /FORTUNE_BAG_ASSETS[\s\S]*fortune-bitebi\.png/);
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
  assert.match(wxss, /\.koi-reveal-card\s*\{/);
  assert.match(wxss, /@keyframes koi-card-pop/);
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
    assert.ok(audioEvents.includes('volume:0.44'));
    assert.ok(!audioEvents.includes('stop'));
    assert.ok(!audioEvents.includes('seek'));
  });
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
