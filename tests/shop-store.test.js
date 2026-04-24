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

const shopStore = require('../utils/shop-store');

test.beforeEach(() => {
  storage.clear();
  shopStore.__resetForTests();
});

test('getStoreState 会返回默认商城状态', () => {
  const state = shopStore.getStoreState();

  assert.equal(state.coins, 8820);
  assert.deepEqual(state.ownedSkins, ['skin-default']);
  assert.deepEqual(state.ownedPets, []);
  assert.equal(state.equippedSkinId, 'skin-default');
  assert.equal(state.equippedPetId, '');
  assert.deepEqual(state.records, []);
});

test('purchaseItem 会扣除金币并加入已拥有皮肤', () => {
  const result = shopStore.purchaseItem('skin', 'skin-sakura');
  const state = shopStore.getStoreState();

  assert.equal(result.ok, true);
  assert.equal(state.coins, 6540);
  assert.deepEqual(state.ownedSkins, ['skin-default', 'skin-sakura']);
});

test('purchaseItem 在金币不足时不会改写状态', () => {
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
  shopStore.purchaseItem('skin', 'skin-storm');
  shopStore.purchaseItem('pet', 'pet-fox');

  const skinResult = shopStore.equipItem('skin', 'skin-storm');
  const petResult = shopStore.equipItem('pet', 'pet-fox');
  const display = shopStore.getEquippedDisplay();

  assert.equal(skinResult.ok, true);
  assert.equal(petResult.ok, true);
  assert.equal(display.equippedSkinId, 'skin-storm');
  assert.equal(display.equippedPetId, 'pet-fox');
  assert.equal(display.skinClass, 'skin-storm');
  assert.equal(display.petIcon, '🦊');
});

test('addCoins 会累加金币余额', () => {
  const before = shopStore.getStoreState();
  const next = shopStore.addCoins(560);

  assert.equal(next.coins, before.coins + 560);
  assert.equal(shopStore.getStoreState().coins, before.coins + 560);
});

test('applyCoinsDelta 会记录统一资金流水', () => {
  const buyResult = shopStore.applyCoinsDelta(-300, {type: 'trade_buy', title: '买入测试机会'});
  const sellResult = shopStore.applyCoinsDelta(520, {type: 'trade_sell', title: '卖出测试机会'});
  const state = shopStore.getStoreState();

  assert.equal(buyResult.ok, true);
  assert.equal(sellResult.ok, true);
  assert.equal(state.coins, 9040);
  assert.equal(state.records.length, 2);
  assert.equal(state.records[0].type, 'trade_sell');
  assert.equal(state.records[1].type, 'trade_buy');
});
