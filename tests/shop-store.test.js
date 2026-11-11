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
  setInnerAudioOption() {},
  createInnerAudioContext() {
    return {stop() {}, play() {}, onError() {}, seek() {}};
  },
  getSystemInfoSync() { return {platform: 'devtools', windowWidth: 375}; },
  showToast() {},
};

const shopStore = require('../utils/shop-store');
const api = require('../utils/api-client');
const originalGet = api.get;
const originalPost = api.post;
const privacyConsent = require('../utils/privacy-consent');
const originalAssertAllowed = privacyConsent.assertAllowed;

test.beforeEach(() => {
  storage.clear();
  api.get = originalGet;
  api.post = originalPost;
  privacyConsent.assertAllowed = originalAssertAllowed;
  shopStore.__resetForTests();
});

test('getStoreState 会返回默认商城状态', () => {
  const state = shopStore.getStoreState();

  assert.equal(state.coins, 8820);
  assert.deepEqual(state.ownedSkins, ['skin-default']);
  assert.deepEqual(state.ownedPets, []);
  assert.deepEqual(state.ownedRings, []);
  assert.equal(state.equippedSkinId, 'skin-default');
  assert.equal(state.equippedPetId, '');
  assert.equal(state.equippedRingId, '');
  assert.deepEqual(state.records, []);
});

test('buildGoodsView 不展示重复头像旧款皮肤', () => {
  const duplicateLegacyIds = [
    'skin-panda-scholar',
    'skin-antler-spirit',
    'skin-jade-lion',
    'skin-golden-monkey',
    'skin-koi-lotus',
    'skin-crane-maiden',
  ];
  const goods = shopStore.buildGoodsView('skin');
  const ids = goods.map((item) => item.id);

  duplicateLegacyIds.forEach((id) => assert.equal(ids.includes(id), false));
});

test('purchaseItem 会扣除锦鲤币并加入已拥有皮肤', () => {
  const result = shopStore.purchaseItem('skin', 'skin-sakura');
  const state = shopStore.getStoreState();

  assert.equal(result.ok, true);
  assert.equal(state.coins, 6540);
  assert.deepEqual(state.ownedSkins, ['skin-default', 'skin-sakura']);
});

test('purchaseItem 在锦鲤币不足时不会改写状态', () => {
  wx.setStorageSync('game_codex_shop_store_v1', {
    coins: 100,
    ownedSkins: ['skin-default'],
    ownedPets: [],
    equippedSkinId: 'skin-default',
    equippedPetId: '',
  });

  const before = shopStore.getStoreState();
  const result = shopStore.purchaseItem('pet', 'pet-dragon');
  const after = shopStore.getStoreState();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INSUFFICIENT_COINS');
  assert.deepEqual(after, before);
});

test('purchaseItem 对已拥有商品不会重复扣费', () => {
  const first = shopStore.purchaseItem('pet', 'pet-luckycat');
  const second = shopStore.purchaseItem('pet', 'pet-luckycat');
  const state = shopStore.getStoreState();

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ALREADY_OWNED');
  assert.equal(state.coins, 7932);
  assert.deepEqual(state.ownedPets, ['pet-luckycat']);
});

test('equipItem 会更新当前装备状态', () => {
  shopStore.addCoins(1200, {type: 'test_credit', title: '测试补充锦鲤币'});
  shopStore.purchaseItem('skin', 'skin-storm');
  shopStore.purchaseItem('pet', 'pet-fox');
  shopStore.purchaseItem('ring', 'ring-crown-auspice');

  const skinResult = shopStore.equipItem('skin', 'skin-storm');
  const petResult = shopStore.equipItem('pet', 'pet-fox');
  const ringResult = shopStore.equipItem('ring', 'ring-crown-auspice');
  const display = shopStore.getEquippedDisplay();

  assert.equal(skinResult.ok, true);
  assert.equal(petResult.ok, true);
  assert.equal(ringResult.ok, true);
  assert.equal(display.equippedSkinId, 'skin-storm');
  assert.equal(display.equippedPetId, 'pet-fox');
  assert.equal(display.equippedRingId, 'ring-crown-auspice');
  assert.equal(display.skinClass, 'skin-storm');
  assert.equal(display.ringName, '瑞冠天光');
  assert.equal(display.ringImage, 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_07.png');
  assert.equal(display.petIcon, '🦊');
  assert.equal(display.petImage, 'https://xcx.ukb88.com/assets/111/pets/linghu.png');
  assert.equal(display.petAccent, '#de6a45');
});

test('buildGoodsView 支持头像光环类目', () => {
  const goods = shopStore.buildGoodsView('ring');

  assert.equal(goods.length, 7);
  assert.equal(goods[0].category, 'ring');
  assert.match(goods[0].ringImage, /assets\/avatar-rings\/avatar_ring_0[1-7]\.png/);
});

test('addCoins 会累加锦鲤币余额', () => {
  const before = shopStore.getStoreState();
  const next = shopStore.addCoins(560);

  assert.equal(next.coins, before.coins + 560);
  assert.equal(shopStore.getStoreState().coins, before.coins + 560);
});

test('applyCoinsDelta 会记录统一资金流水', () => {
  const spendResult = shopStore.applyCoinsDelta(-300, {type: 'item_spend', title: '测试消费'});
  const rewardResult = shopStore.applyCoinsDelta(520, {type: 'game_reward', title: '测试奖励'});
  const state = shopStore.getStoreState();

  assert.equal(spendResult.ok, true);
  assert.equal(rewardResult.ok, true);
  assert.equal(state.coins, 9040);
  assert.equal(state.records.length, 2);
  assert.equal(state.records[0].type, 'game_reward');
  assert.equal(state.records[1].type, 'item_spend');
});

test('账号资产不继承游客库存，零余额和空装备以服务器为准', async () => {
  shopStore.purchaseItem('pet', 'pet-luckycat');
  shopStore.equipItem('pet', 'pet-luckycat');
  const guest = shopStore.getStoreState();
  api.setToken('account-a');
  assert.equal(shopStore.getStoreState().coins, 0);
  assert.deepEqual(shopStore.getStoreState().ownedPets, []);
  api.get = async (path) => path === '/user/profile' ? {coins: 0} : [];

  await shopStore.refreshInventory();
  assert.equal(shopStore.getStoreState().coins, 0);
  assert.deepEqual(shopStore.getStoreState().ownedPets, []);
  assert.equal(shopStore.getEquippedDisplay().equippedPetId, '');
  api.clearToken();
  assert.deepEqual(shopStore.getStoreState(), guest);
});

test('账号之间不共享资产，异步旧账号响应不能写入新账号', async () => {
  api.setToken('account-a');
  let resolveInventory;
  api.get = async (path) => path === '/user/profile'
    ? {coins: 800}
    : new Promise((resolve) => { resolveInventory = resolve; });
  const pending = shopStore.refreshInventory();
  api.setToken('account-b');
  assert.equal(shopStore.getStoreState().coins, 0);
  resolveInventory([{category: 'pet', item_id: 'pet-luckycat', is_equipped: 1}]);
  await assert.rejects(pending, /账号已变更/);
  assert.deepEqual(shopStore.getStoreState().ownedPets, []);
  api.get = async (path) => path === '/user/profile' ? {coins: 12} : [];
  await shopStore.refreshInventory();
  assert.equal(shopStore.getStoreState().coins, 12);
});

test('账号库存刷新替换旧库存且不会保留已撤销装备', async () => {
  api.setToken('account-a');
  let inventory = [{category: 'pet', item_id: 'pet-luckycat', is_equipped: 1}];
  api.get = async (path) => path === '/user/profile' ? {coins: 500} : inventory;
  await shopStore.refreshInventory();
  assert.equal(shopStore.getEquippedDisplay().equippedPetId, 'pet-luckycat');
  inventory = [];
  await shopStore.refreshInventory();
  assert.deepEqual(shopStore.getStoreState().ownedPets, []);
  assert.equal(shopStore.getEquippedDisplay().equippedPetId, '');
});

test('登录后本地购买装备和奖励不能污染账号或游客资产', async () => {
  const guest = shopStore.getStoreState();
  api.setToken('account-a');
  api.get = async (path) => path === '/user/profile' ? {coins: 10000} : [];
  await shopStore.refreshInventory();
  const before = shopStore.getStoreState();
  assert.equal(shopStore.purchaseItem('pet', 'pet-luckycat').ok, false);
  assert.equal(shopStore.equipItem('skin', 'skin-default').ok, false);
  assert.equal(shopStore.applyCoinsDelta(520).ok, false);
  shopStore.addCoins(1000);
  assert.deepEqual(shopStore.getStoreState(), before);
  api.clearToken();
  assert.deepEqual(shopStore.getStoreState(), guest);
});

test('账号购买失败不会制造本地成功，成功后同步失败明确区分', async () => {
  api.setToken('account-a');
  api.get = async (path) => path === '/user/profile' ? {coins: 888} : [];
  await shopStore.refreshInventory();
  api.post = async () => { throw new Error('余额不足'); };
  const rejected = await shopStore.buyViaApi('pet-luckycat');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.committed, false);
  assert.match(rejected.message, /余额不足/);
  assert.deepEqual(shopStore.getStoreState().ownedPets, []);
  api.post = async () => ({coins: 0, item: {id: 'pet-luckycat'}});
  api.get = async () => { throw new Error('断网'); };
  const unsynced = await shopStore.buyViaApi('pet-luckycat');
  assert.equal(unsynced.ok, false);
  assert.equal(unsynced.code, 'SYNC_FAILED');
  assert.equal(unsynced.committed, true);
  assert.match(unsynced.message, /购买已提交.*同步失败/);
  assert.equal(shopStore.getStoreState().syncStatus, 'error');
});

test('账号购买后服务器零余额被保留，装备必须经服务器确认', async () => {
  api.setToken('account-a');
  api.post = async (path) => path === '/shop/buy' ? {coins: 0} : {success: true};
  api.get = async (path) => path === '/user/profile'
    ? {coins: 0}
    : [{category: 'pet', item_id: 'pet-luckycat', is_equipped: 0}];
  const confirmed = await shopStore.buyViaApi('pet-luckycat');
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.committed, true);
  assert.equal(shopStore.getStoreState().coins, 0);
  api.post = async () => { throw new Error('装备失败'); };
  assert.equal((await shopStore.equipViaApi('pet-luckycat', 'pet')).ok, false);
  assert.equal(shopStore.getEquippedDisplay().equippedPetId, '');
});

test('无登录时不能调用账号购买接口，错误响应不能发布账号资产', async () => {
  let posts = 0;
  api.post = async () => { posts += 1; return {}; };
  const denied = await shopStore.buyViaApi('pet-luckycat');
  assert.equal(denied.ok, false);
  assert.equal(denied.committed, false);
  assert.equal(posts, 0);
  api.setToken('account-a');
  api.get = async (path) => path === '/user/profile' ? {coins: null} : [];
  await assert.rejects(shopStore.refreshInventory(), /余额数据/);
  assert.equal(shopStore.getStoreState().syncStatus, 'error');
});

function loadPage(relativePath) {
  let definition;
  global.Page = (page) => { definition = page; };
  const pagePath = require.resolve(relativePath);
  delete require.cache[pagePath];
  require(pagePath);
  delete global.Page;
  return {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  };
}

test('商城实际点击账号购买失败不能回退到游客本地购买', async () => {
  const guest = shopStore.getStoreState();
  api.setToken('account-page');
  api.get = async (path) => path === '/user/profile' ? {coins: 10000} : [];
  await shopStore.refreshInventory();
  const toasts = [];
  wx.showToast = (toast) => toasts.push(toast.title);
  api.post = async () => {
    api.clearToken();
    throw new Error('登录已过期');
  };
  const page = loadPage('../pages/shop/index.js');
  await page.onTapAction({currentTarget: {dataset: {category: 'pet', itemId: 'pet-luckycat', action: 'buy'}}});
  assert.deepEqual(shopStore.getStoreState(), guest);
  assert.equal(page.data.actionPending, false);
  assert.ok(toasts.includes('登录已过期'));
  assert.equal(toasts.some((title) => title.includes('购买成功')), false);
});

test('商城同步失败展示未知余额并禁用操作，重试后恢复真实零余额', async () => {
  api.setToken('account-page');
  const page = loadPage('../pages/shop/index.js');
  api.get = async () => { throw new Error('网络不可用'); };
  await page.refreshAccountAssets();
  assert.equal(page.data.balanceText, '--');
  assert.equal(page.data.syncFailed, true);
  assert.ok(page.data.goods.every((item) => item.status.disabled));
  api.get = async (path) => path === '/user/profile' ? {coins: 0} : [];
  await page.refreshAccountAssets();
  assert.equal(page.data.balanceText, '0');
  assert.equal(page.data.syncFailed, false);
});

test('商城请求处理中重复点击不会重复提交购买', async () => {
  api.setToken('account-page');
  api.get = async (path) => path === '/user/profile' ? {coins: 10000} : [];
  await shopStore.refreshInventory();
  let resolvePurchase;
  let posts = 0;
  api.post = async () => {
    posts += 1;
    return new Promise((resolve) => { resolvePurchase = resolve; });
  };
  const page = loadPage('../pages/shop/index.js');
  const event = {currentTarget: {dataset: {category: 'pet', itemId: 'pet-luckycat', action: 'buy'}}};
  const pending = page.onTapAction(event);
  await page.onTapAction(event);
  assert.equal(posts, 1);
  api.get = async (path) => path === '/user/profile'
    ? {coins: 9112} : [{category: 'pet', item_id: 'pet-luckycat', is_equipped: 0}];
  resolvePurchase({coins: 9112});
  await pending;
  assert.deepEqual(shopStore.getStoreState().ownedPets, ['pet-luckycat']);
  assert.equal(page.data.actionPending, false);
});

test('登录与退出账号不会串用游客资产或上一账号资料', async () => {
  const profiles = require('../utils/user-profile');
  privacyConsent.assertAllowed = () => {};
  shopStore.purchaseItem('pet', 'pet-luckycat');
  const guest = shopStore.getStoreState();
  profiles.saveProfile({nickName: '旧账号', avatarUrl: 'https://example.com/old.png'});
  wx.login = ({success}) => success({code: 'wx-code'});
  api.post = async () => ({token: 'new-account', user: {nickName: '新账号', avatarUrl: '', coins: 0}});
  api.get = async () => [];
  const profile = await profiles.login();
  assert.equal(profile.nickName, '新账号');
  assert.equal(profile.avatarUrl, '');
  assert.equal(shopStore.getStoreState().coins, 0);
  assert.deepEqual(shopStore.getStoreState().ownedPets, []);
  profiles.logout();
  assert.deepEqual(shopStore.getStoreState(), guest);
});

test('账号流水请求失败不把游客流水显示成账号记录', async () => {
  shopStore.addCoins(200);
  api.setToken('account-ledger');
  api.get = async (path) => {
    if (path === '/stats/coin-records') throw new Error('流水暂不可用');
    return path === '/user/profile' ? {coins: 0} : [];
  };
  const page = loadPage('../pages/income/index.js');
  await page.syncRecords();
  assert.equal(page.data.balanceAmountText, '--');
  assert.deepEqual(page.data.records, []);
  assert.match(page.data.recordsStatusText, /同步失败/);
});

test('账号流水中真实零余额不被当前余额覆盖', async () => {
  api.setToken('account-ledger');
  api.get = async (path) => {
    if (path === '/stats/coin-records') {
      return {records: [{id: 1, amount: -100, balanceAfter: 0, type: 'purchase', title: '购买', createdAt: Date.now()}]};
    }
    return path === '/user/profile' ? {coins: 500} : [];
  };
  const page = loadPage('../pages/income/index.js');
  await page.syncRecords();
  const {formatCurrency} = require('../utils/format');
  assert.equal(page.data.records[0].balanceText, formatCurrency(0));
});

test('账号购买确认必须重新读取，不能复用购买前启动的旧库存请求', async () => {
  api.setToken('account-write-race');
  let coins = 100;
  let inventoryReads = 0;
  let resolveOldInventory;
  api.get = async (path) => {
    if (path === '/user/profile') return {coins};
    inventoryReads += 1;
    if (inventoryReads === 1) {
      return new Promise((resolve) => { resolveOldInventory = resolve; });
    }
    return [{category: 'pet', item_id: 'pet-luckycat', is_equipped: 0}];
  };
  const oldRead = shopStore.refreshInventory();
  api.post = async () => { coins = 0; return {coins: 0}; };
  const purchase = shopStore.buyViaApi('pet-luckycat');
  resolveOldInventory([]);
  await oldRead;
  assert.equal((await purchase).ok, true);
  assert.equal(inventoryReads, 2);
  assert.equal(shopStore.getStoreState().coins, 0);
  assert.deepEqual(shopStore.getStoreState().ownedPets, ['pet-luckycat']);
});

test('服务器结算失败时不显示上一局游客奖励作为账号结算', async () => {
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();
  gameStore.startGame({autoStartTimer: false, random: () => 0.2});
  gameStore.finishGame();
  api.setToken('account-server-result');
  api.get = async () => { throw new Error('结算未确认'); };
  global.getCurrentPages = () => [{options: {sessionId: 'server-session'}}];
  const page = loadPage('../pages/result/index.js');
  await page.refreshResult();
  assert.equal(page.data.incomeAmountText, '--');
  assert.equal(page.data.gainText, '--');
  gameStore.__resetForTests();
});

test('未同意隐私条款时登录在调用wx.login前拒绝', async () => {
  const profiles = require('../utils/user-profile');
  let calls = 0;
  wx.login = () => { calls += 1; };
  await assert.rejects(profiles.login(), {code: 'PRIVACY_CONSENT_REQUIRED'});
  assert.equal(calls, 0);
  assert.equal(api.getToken(), '');
});

test('退出后延迟返回的登录不能恢复账号或覆盖游客资料', async () => {
  const profiles = require('../utils/user-profile');
  privacyConsent.assertAllowed = () => {};
  wx.login = ({success}) => success({code: 'late-login'});
  let resolveLogin;
  api.post = () => new Promise((resolve) => { resolveLogin = resolve; });
  const pending = profiles.login();
  await Promise.resolve();
  profiles.logout();
  profiles.saveProfile({nickName: '游客', avatarUrl: ''});
  resolveLogin({token: 'old-account', user: {nickName: '旧账号', coins: 999}});
  await pending;
  assert.equal(api.getToken(), '');
  assert.equal(profiles.getCachedProfile().nickName, '游客');
  assert.equal(shopStore.getStoreState().assetSource, undefined);
});

test('并发登录仅最新一次可以写入账号', async () => {
  const profiles = require('../utils/user-profile');
  privacyConsent.assertAllowed = () => {};
  wx.login = ({success}) => success({code: 'login-code'});
  const pendingLogins = [];
  api.post = () => new Promise((resolve) => { pendingLogins.push(resolve); });
  api.get = async () => [];
  const first = profiles.login();
  await Promise.resolve();
  const second = profiles.login();
  await Promise.resolve();
  pendingLogins[1]({token: 'new-account', user: {nickName: '新账号', coins: 0}});
  await second;
  pendingLogins[0]({token: 'old-account', user: {nickName: '旧账号', coins: 999}});
  await first;
  assert.equal(api.getToken(), 'new-account');
  assert.equal(profiles.getCachedProfile().nickName, '新账号');
  assert.equal(shopStore.getStoreState().coins, 0);
});

test('旧账号流水失败不能覆盖新账号已显示的流水状态', async () => {
  api.setToken('ledger-old');
  let rejectOld;
  api.get = (path) => {
    if (path === '/stats/coin-records') return new Promise((resolve, reject) => { rejectOld = reject; });
    return Promise.resolve(path === '/user/profile' ? {coins: 100} : []);
  };
  const page = loadPage('../pages/income/index.js');
  const oldRead = page.syncRecords();
  api.setToken('ledger-new');
  api.get = async (path) => path === '/stats/coin-records'
    ? {records: []} : path === '/user/profile' ? {coins: 0} : [];
  await page.syncRecords();
  rejectOld(new Error('旧请求失败'));
  await oldRead;
  assert.equal(page.data.recordsStatusText, '');
  assert.equal(page.data.balanceAmountText, '0');
});

test('登录后打开既有游客结算不展示为账号锦鲤币奖励', async () => {
  const gameStore = require('../utils/game-store');
  gameStore.__resetForTests();
  gameStore.startGame({autoStartTimer: false, random: () => 0.2});
  gameStore.finishGame();
  api.setToken('result-account');
  global.getCurrentPages = () => [{options: {}}];
  const page = loadPage('../pages/result/index.js');
  const amounts = {};
  page.animateNumber = (amount, formatter, field) => { amounts[field] = amount; };
  await page.refreshResult();
  assert.equal(amounts.incomeAmountText, 0);
  gameStore.__resetForTests();
});

test('未同意时首页不启动分享跳转或远程加载', () => {
  const page = loadPage('../pages/home/index.js');
  let sideEffects = 0;
  wx.redirectTo = () => { sideEffects += 1; };
  page.fetchAnnouncements = () => { sideEffects += 1; };
  page.syncOverview = () => { sideEffects += 1; };
  page.onLoad({scene: 'room', roomId: 'shared-room'});
  page.onShow();
  assert.equal(sideEffects, 0);
});

test('旧结算请求失败不能清空后一次已确认的服务器结算', async () => {
  api.setToken('result-account');
  let rejectOld;
  let reads = 0;
  api.get = async () => {
    reads += 1;
    if (reads === 1) return new Promise((resolve, reject) => { rejectOld = reject; });
    return {resultId: 'latest-result', coins: 0, gain: 0, ranking: [], top3: []};
  };
  global.getCurrentPages = () => [{options: {sessionId: 'session'}}];
  const page = loadPage('../pages/result/index.js');
  page.animateNumber = (amount, formatter, field) => { page.setData({[field]: String(amount)}); };
  const oldRead = page.refreshResult();
  await page.refreshResult();
  rejectOld(new Error('旧结算请求失败'));
  await oldRead;
  assert.equal(page.data.resultId, 'latest-result');
  assert.equal(page.data.incomeAmountText, '0');
});

test('未同意时流水与结算页保留导航初始化但不启动业务同步', async () => {
  for (const path of ['../pages/income/index.js', '../pages/result/index.js']) {
    const page = loadPage(path);
    let requests = 0;
    page.syncRecords = () => { requests += 1; };
    page.refreshResult = () => { requests += 1; };
    page.onLoad();
    await page.onShow();
    assert.equal(requests, 0);
    assert.equal(typeof page.data.nav.statusBarHeight, 'number');
  }
});

test('注销账号成功清除同意记录，启动页不能自动重新建号', async () => {
  const profiles = require('../utils/user-profile');
  const originalDel = api.del;
  const originalRevoke = privacyConsent.revoke;
  let revoked = false;
  privacyConsent.revoke = () => { revoked = true; originalRevoke(); };
  api.del = async () => ({success: true});
  api.setToken('deleted-account');
  storage.set('legal-consent-version', 'accepted-version');
  try {
    await profiles.deleteAccount();
    assert.equal(revoked, true);
    assert.equal(api.getToken(), '');
    assert.equal(storage.has('legal-consent-version'), false);
    assert.equal(privacyConsent.isAllowed(), false);
  } finally {
    api.del = originalDel;
    privacyConsent.revoke = originalRevoke;
  }
});

test('注销失败不撤销当前账号及同意记录', async () => {
  const profiles = require('../utils/user-profile');
  const originalDel = api.del;
  api.del = async () => { throw new Error('注销暂不可用'); };
  api.setToken('retained-account');
  storage.set('legal-consent-version', 'accepted-version');
  try {
    await assert.rejects(profiles.deleteAccount(), /注销暂不可用/);
    assert.equal(api.getToken(), 'retained-account');
    assert.equal(storage.get('legal-consent-version'), 'accepted-version');
  } finally {
    api.del = originalDel;
  }
});
