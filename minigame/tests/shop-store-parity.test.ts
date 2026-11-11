/**
 * 商城一致性验证：TS 移植版与小程序端 utils/shop-store.js 逐项比对。
 *
 * 商品目录是脚本生成的（scripts/generate-shop-catalog.mjs），这里同时校验
 * 生成结果与源数据一致；账本记录带随机 id 与时间戳，比对前剥离这两项。
 */

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

import * as shopTs from '../src/core/ShopStore';

const requireFromHere = createRequire(import.meta.url);

interface LegacyShopModule {
  getCatalog(): unknown;
  getStoreState(): unknown;
  getCoinRecords(): unknown;
  buildGoodsView(category: string, state?: unknown): unknown;
  purchaseItem(category: string, itemId: string): unknown;
  equipItem(category: string, itemId: string): unknown;
  getEquippedDisplay(): unknown;
  applyCoinsDelta(amount: unknown, meta?: unknown): unknown;
  addCoins(amount: unknown, meta?: unknown): unknown;
  clearLocalData(): unknown;
  resetAccountState(): void;
  buyViaApi(itemId: string): Promise<unknown>;
  refreshInventory(profile?: unknown): Promise<unknown>;
}

const shopJs = requireFromHere('../../utils/shop-store.js') as LegacyShopModule;

const SHOP_KEY = 'game_codex_shop_store_v1';
const TOKEN_KEY = 'game_codex_api_token_v1';

function withStorage<T>(storage: Map<string, unknown>, run: () => T): T {
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  try {
    return run();
  } finally {
    Reflect.deleteProperty(globalThis, 'wx');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : null;
}

/** 账本记录带随机 id 与 Date.now()，比对前剥离。 */
function stripState(value: unknown): unknown {
  const state = asRecord(value);
  if (!state) {
    return value;
  }
  const records = state.records;
  return {
    ...state,
    records: Array.isArray(records)
      ? records.map((record) => {
          const item = asRecord(record);
          return item ? {type: item.type, title: item.title, amount: item.amount, balanceAfter: item.balanceAfter} : record;
        })
      : records,
  };
}

function stripResult(value: unknown): unknown {
  const result = asRecord(value);
  if (!result) {
    return value;
  }
  return {...result, state: result.state === undefined ? undefined : stripState(result.state)};
}

function stripRecords(value: unknown): unknown {
  const state = asRecord(stripState({records: value}));
  return state ? state.records : value;
}

interface Pair {
  legacyStorage: Map<string, unknown>;
  portStorage: Map<string, unknown>;
}

function createPair(seed?: Record<string, unknown>): Pair {
  const legacyStorage = new Map<string, unknown>();
  const portStorage = new Map<string, unknown>();
  if (seed) {
    legacyStorage.set(SHOP_KEY, structuredClone(seed));
    portStorage.set(SHOP_KEY, structuredClone(seed));
  }
  return {legacyStorage, portStorage};
}

/** 同一操作分别跑旧模块与移植版，返回双方结果用于比对。 */
function compare(pair: Pair, legacyRun: (module: LegacyShopModule) => unknown, portRun: () => unknown): [unknown, unknown] {
  const legacy = withStorage(pair.legacyStorage, () => {
    shopJs.resetAccountState();
    return legacyRun(shopJs);
  });
  const port = withStorage(pair.portStorage, () => {
    shopTs.resetAccountState();
    return portRun();
  });
  return [legacy, port];
}

test('生成的商品目录与小程序端源数据一致', () => {
  const legacy = withStorage(new Map(), () => shopJs.getCatalog());
  assert.deepStrictEqual(shopTs.getCatalog(), legacy);
  const catalog = shopTs.getCatalog();
  assert.ok(catalog.skin.length >= 15);
  assert.ok(catalog.pet.length >= 12);
  assert.ok(catalog.ring.length >= 7);
});

test('默认状态与分类视图一致', () => {
  const pair = createPair();
  const [legacyState, portState] = compare(pair, (module) => module.getStoreState(), () => shopTs.getStoreState());
  assert.deepStrictEqual(portState, legacyState);

  for (const category of ['skin', 'pet', 'ring']) {
    const [legacyView, portView] = compare(
      pair,
      (module) => module.buildGoodsView(category),
      () => shopTs.buildGoodsView(category)
    );
    assert.deepStrictEqual(portView, legacyView, `category=${category}`);
  }

  const [legacyDisplay, portDisplay] = compare(
    pair,
    (module) => module.getEquippedDisplay(),
    () => shopTs.getEquippedDisplay()
  );
  assert.deepStrictEqual(portDisplay, legacyDisplay);
});

test('残缺存档被规范化后一致', () => {
  const seed = {
    coins: -5,
    ownedSkins: ['skin-sakura', 'skin-sakura', '  ', null],
    ownedPets: 'not-an-array',
    equippedSkinId: 'skin-not-exist',
    equippedPetId: 'pet-jinli',
    equippedRingId: 'ring-amber-glow',
    records: [
      {title: '', amount: 10},
      {title: '购买X', amount: 'abc', balanceAfter: -3, type: 7},
      null,
    ],
  };
  const pair = createPair(seed);
  const [legacyState, portState] = compare(pair, (module) => module.getStoreState(), () => shopTs.getStoreState());
  assert.deepStrictEqual(stripState(portState), stripState(legacyState));
});

test('购买：成功、重复、余额不足、商品不存在', () => {
  const cases: [string, string][] = [
    ['skin', 'skin-jade-rabbit'],
    ['skin', 'skin-jade-rabbit'],
    ['skin', 'skin-not-exist'],
    ['pet', 'pet-xiaofenghuang'],
    ['pet', 'pet-jinli'],
    ['ring', 'ring-amber-glow'],
    ['ring', 'ring-amber-glow'],
  ];
  const pair = createPair();
  for (const [category, itemId] of cases) {
    const [legacy, port] = compare(
      pair,
      (module) => module.purchaseItem(category, itemId),
      () => shopTs.purchaseItem(category, itemId)
    );
    assert.deepStrictEqual(stripResult(port), stripResult(legacy), `${category}/${itemId}`);
  }

  const [legacyRecords, portRecords] = compare(
    pair,
    (module) => module.getCoinRecords(),
    () => shopTs.getCoinRecords()
  );
  assert.deepStrictEqual(stripRecords(portRecords), stripRecords(legacyRecords));
  assert.ok(Array.isArray(portRecords) && portRecords.length > 0);
});

test('装备：已拥有可装备，未拥有被拒绝', () => {
  const pair = createPair();
  const steps: [string, string][] = [
    ['pet', 'pet-jinli'],
    ['pet', 'pet-not-exist'],
    ['ring', 'ring-amber-glow'],
    ['ring', 'ring-moon-frost'],
    ['skin', 'skin-default'],
    ['skin', 'skin-sunrise'],
  ];
  for (const [category, itemId] of steps) {
    const [legacy, port] = compare(
      pair,
      (module) => module.equipItem(category, itemId),
      () => shopTs.equipItem(category, itemId)
    );
    assert.deepStrictEqual(stripResult(port), stripResult(legacy), `${category}/${itemId}`);
  }

  // 购买后再装备应当成功
  compare(pair, (module) => module.purchaseItem('ring', 'ring-moon-frost'), () => shopTs.purchaseItem('ring', 'ring-moon-frost'));
  const [legacy, port] = compare(
    pair,
    (module) => module.equipItem('ring', 'ring-moon-frost'),
    () => shopTs.equipItem('ring', 'ring-moon-frost')
  );
  assert.deepStrictEqual(stripResult(port), stripResult(legacy));
  assert.equal((port as {ok: boolean}).ok, true);
});

test('资金变动：入账、扣款、零变动、透支', () => {
  const amounts = [500, -300, 0, -999999];
  const pair = createPair();
  for (const amount of amounts) {
    const [legacy, port] = compare(
      pair,
      (module) => module.applyCoinsDelta(amount, {type: 'admin_adjust', title: '测试'}),
      () => shopTs.applyCoinsDelta(amount, {type: 'admin_adjust', title: '测试'})
    );
    assert.deepStrictEqual(stripResult(port), stripResult(legacy), `amount=${amount}`);
  }

  const [legacyCoins, portCoins] = compare(
    pair,
    (module) => module.addCoins(120, {type: 'game_reward', title: '对局结算'}),
    () => shopTs.addCoins(120, {type: 'game_reward', title: '对局结算'})
  );
  assert.deepStrictEqual(stripState(portCoins), stripState(legacyCoins));
});

test('登录态下本地改动一律被拒绝', async () => {
  const pair = createPair();
  pair.legacyStorage.set(TOKEN_KEY, 'token-abc');
  pair.portStorage.set(TOKEN_KEY, 'token-abc');

  const operations: [string, (module: LegacyShopModule) => unknown, () => unknown][] = [
    ['purchaseItem', (module) => module.purchaseItem('skin', 'skin-sakura'), () => shopTs.purchaseItem('skin', 'skin-sakura')],
    ['equipItem', (module) => module.equipItem('skin', 'skin-default'), () => shopTs.equipItem('skin', 'skin-default')],
    ['applyCoinsDelta', (module) => module.applyCoinsDelta(10), () => shopTs.applyCoinsDelta(10)],
    ['getEquippedDisplay', (module) => module.getEquippedDisplay(), () => shopTs.getEquippedDisplay()],
  ];
  for (const [label, legacyRun, portRun] of operations) {
    const [legacy, port] = compare(pair, legacyRun, portRun);
    assert.deepStrictEqual(stripResult(port), stripResult(legacy), label);
  }
  const [legacyPurchase, portPurchase] = compare(
    pair,
    (module) => module.purchaseItem('skin', 'skin-sakura'),
    () => shopTs.purchaseItem('skin', 'skin-sakura')
  );
  assert.equal((portPurchase as {code: string}).code, 'SERVER_AUTHORITY_REQUIRED');
  assert.deepStrictEqual(stripResult(portPurchase), stripResult(legacyPurchase));

  // 未登录时的账号接口调用
  const anonymousPair = createPair();
  const [legacyBuy, portBuy] = await Promise.all([
    withStorage(anonymousPair.legacyStorage, () => {
      shopJs.resetAccountState();
      return shopJs.buyViaApi('skin-sakura');
    }),
    withStorage(anonymousPair.portStorage, () => {
      shopTs.resetAccountState();
      return shopTs.buyViaApi('skin-sakura');
    }),
  ]);
  assert.deepStrictEqual(portBuy, legacyBuy);
  assert.equal((portBuy as {code: string}).code, 'LOGIN_REQUIRED');

  const [legacyRefresh, portRefresh] = await Promise.all([
    withStorage(anonymousPair.legacyStorage, () => {
      shopJs.resetAccountState();
      return shopJs.refreshInventory().catch((error: Error) => error.message);
    }),
    withStorage(anonymousPair.portStorage, () => {
      shopTs.resetAccountState();
      return shopTs.refreshInventory().catch((error: Error) => error.message);
    }),
  ]);
  assert.equal(portRefresh, legacyRefresh);
});

test('清空本地数据后回到初始状态', () => {
  const pair = createPair();
  compare(pair, (module) => module.purchaseItem('skin', 'skin-jade-rabbit'), () => shopTs.purchaseItem('skin', 'skin-jade-rabbit'));
  const [legacy, port] = compare(pair, (module) => module.clearLocalData(), () => shopTs.clearLocalData());
  assert.deepStrictEqual(stripState(port), stripState(legacy));
  assert.equal(pair.portStorage.has(SHOP_KEY), false);
  assert.equal(pair.legacyStorage.has(SHOP_KEY), false);
});
