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
  };

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

  assert.match(roomJs, /roomHintText:\s*'准备好后，游戏将在两分钟内开始'/);
  assert.match(wxml, /room-hint/);
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

test('arena 页会为自己的宠物渲染独立跟随层，而不是只显示纯文字徽章', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.match(wxml, /class="pet-follower"/);
  assert.match(wxml, /class="pet-avatar"/);
  assert.match(wxml, /src="\{\{ item\.petImage \}\}"/);
  assert.doesNotMatch(wxml, /pet-name-pill/);
  assert.match(wxss, /\.pet-follower\s*\{[\s\S]*top:\s*2rpx;[\s\S]*left:\s*124rpx;/);
  assert.doesNotMatch(wxss, /\.pet-avatar-shell\s*\{[^}]*border:/);
});

test('arena 页的聊天气泡会保持单行横排，不会把中间玩家的短句拆成竖排', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');

  assert.match(wxss, /\.emote-bubble\s*\{[\s\S]*white-space:\s*nowrap;[\s\S]*word-break:\s*keep-all;/);
});

test('arena 页的买入卖出图标会保留较大的视觉权重', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/arena/index.wxml'), 'utf8');

  assert.match(wxss, /\.fortune-bag-wrap\s*\{[\s\S]*width:\s*148rpx;[\s\S]*min-height:\s*214rpx;/);
  assert.match(wxss, /\.fortune-bag-image\s*\{[\s\S]*width:\s*118rpx;[\s\S]*height:\s*118rpx;/);
  assert.match(wxss, /\.fortune-bag-image\s*\{[\s\S]*flex-shrink:\s*0;/);
  assert.match(wxss, /\.fortune-bag-shell\s*\{[\s\S]*width:\s*130rpx;[\s\S]*height:\s*130rpx;/);
  assert.match(wxml, /fortune-bag-countdown/);
  assert.match(wxml, /fortune-panel/);
  assert.match(wxml, /invest-head-icon/);
  assert.match(wxml, /确认卖出/);
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
      asset: '/assets/battle/fortune-gupiao.png',
      opportunity: {
        category: '股票',
        name: '测试机会',
        asset: '/assets/battle/fortune-gupiao.png',
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
      asset: '/assets/battle/fortune-gupiao.png',
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
  assert.equal(arenaPage.data.fortunePanelAsset, '/assets/battle/fortune-gupiao.png');
});

test('红包和结算音效会切到新的资源文件', () => {
  const audioJs = fs.readFileSync(path.join(__dirname, '../utils/audio.js'), 'utf8');
  const investmentJs = fs.readFileSync(path.join(__dirname, '../utils/investment.js'), 'utf8');
  const resultJs = fs.readFileSync(path.join(__dirname, '../pages/result/index.js'), 'utf8');
  const projectConfig = fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf8');

  assert.match(audioJs, /resultWin:\s*'https:\/\/xcx\.ukb88\.com\/assets\/audio\/result\/yanhua\.mp3'/);
  assert.match(audioJs, /bgm:\s*'\/assets\/audio\/result\/bgm\.mp3'/);
  assert.match(audioJs, /changcheng:\s*'\/assets\/audio\/result\/changcheng\.mp3'/);
  assert.match(audioJs, /'万里长城':\s*SOURCES\.changcheng/);
  assert.match(investmentJs, /FORTUNE_BAG_ASSETS[\s\S]*fortune-fangchan\.png/);
  assert.match(investmentJs, /FORTUNE_BAG_ASSETS[\s\S]*fortune-gupiao\.png/);
  assert.match(investmentJs, /FORTUNE_BAG_ASSETS[\s\S]*fortune-bitebi\.png/);
  assert.match(resultJs, /playResultWinAudio\(\)/);
  assert.match(projectConfig, /assets\/iocns\/2657\.png_300\.png/);
});

test('app 启动时会自动播放全局背景音乐并在返回前台时重新触发', () => {
  createWxStub();
  const playStageBgmCalls = [];
  const app = loadAppWithStubbedAudio({
    playStageBgm(stage, options) {
      playStageBgmCalls.push({stage, options});
      return null;
    },
  });

  assert.ok(app);
  assert.equal(playStageBgmCalls.length, 2);
  assert.equal(playStageBgmCalls[0].stage.name, '万里长城');
  assert.deepEqual(playStageBgmCalls[0].options, { volume: 0.38 });
  assert.equal(playStageBgmCalls[1].stage.name, '万里长城');
  assert.deepEqual(playStageBgmCalls[1].options, { volume: 0.38 });
});

test('各场景主题会切换到对应的本地背景音乐', () => {
  createWxStub();
  const cases = [
    ['万里长城', '/assets/audio/result/changcheng.mp3'],
    ['富士山', '/assets/audio/result/富士山下音频.mp3'],
    ['巴黎铁塔', '/assets/audio/result/埃菲尔音频.mp3'],
    ['大峡谷', '/assets/audio/result/美洲大峡谷音频.mp3'],
    ['泰姬陵', '/assets/audio/result/泰姬陵音频.mp3'],
    ['西湖夜游', '/assets/audio/result/西湖夜景音频.mp3'],
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
