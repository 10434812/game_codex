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
    setInnerAudioOption() {},
    createInnerAudioContext() {
      return {
        stop() {},
        destroy() {},
        seek() {},
        play() {},
        onError() {},
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
    stage: {name: '万里长城'},
    roomId: '1024',
    modeText: '本地体验',
  });

  assert.equal(roomPage.data.slots.length, 10);
  assert.equal(roomPage.data.slots[9].name, players[9].name);
  assert.equal(roomPage.data.activePercent, 100);
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
  gameStore.startGame({autoStartTimer: false});

  shopStore.purchaseItem('skin', 'skin-monk-bell');
  shopStore.equipItem('skin', 'skin-monk-bell');

  const arenaPage = createPageInstance(loadPage('../pages/arena/index.js'));
  arenaPage.onLoad();
  arenaPage.syncShopDisplay();
  arenaPage.syncArena(gameStore.getState());

  const selfPlayer = arenaPage.data.players.find((player) => player.isSelf);
  assert.equal(selfPlayer.avatar, '/assets/skins/skin-09.png');
  assert.equal(selfPlayer.skinName, '净心行者');
});
