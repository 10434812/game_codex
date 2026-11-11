/**
 * 商城状态（原 utils/shop-store.js）。
 *
 * 两条资产通道严格隔离：
 * - 游客：读写本地 storage（assetSource = 'guest'）；
 * - 登录账号：只在当前会话内保存服务器快照，本地写入一律被拒绝
 *   （SERVER_AUTHORITY_REQUIRED），避免用本地存档覆盖账号资产。
 */

import * as api from './ApiClient';
import {GOODS} from './ShopCatalog';
import type {
  EquippedDisplay,
  GoodsViewItem,
  LedgerRecord,
  ShopActionResult,
  ShopCategory,
  ShopItem,
  ShopState,
} from './ShopTypes';
import {readJson, removeKey, writeJson} from '../platform/storage';

const SHOP_STORAGE_KEY = 'game_codex_shop_store_v1';
const INITIAL_COINS = 8820; // 新用户初始锦鲤币
const MAX_RECORDS = 120;

const DEFAULT_STATE: ShopState = {
  coins: INITIAL_COINS,
  ownedSkins: ['skin-default'],
  ownedPets: [],
  ownedRings: [],
  equippedSkinId: 'skin-default',
  equippedPetId: '',
  equippedRingId: '',
  records: [],
};

interface AccountSession {
  token: string;
  revision: number;
}

// 账号资产只保留当前登录会话内的服务器快照，绝不复用游客存档。
let accountToken = '';
let accountRevision = 0;
let accountState: ShopState | null = null;
let inventoryRequest: Promise<ShopState> | null = null;

export function resetAccountState(): void {
  accountToken = '';
  accountRevision += 1;
  accountState = null;
  inventoryRequest = null;
}

function getAccountSession(): AccountSession | null {
  const token = api.getToken();
  if (token !== accountToken) {
    resetAccountState();
    accountToken = token;
  }
  if (!token) {
    return null;
  }
  if (!accountState) {
    accountState = normalizeState({
      ...DEFAULT_STATE,
      coins: 0,
      assetSource: 'server',
      syncStatus: 'pending',
      syncError: '',
    });
  }
  return {token, revision: accountRevision};
}

function assertAccountSession(session: AccountSession): void {
  const current = getAccountSession();
  if (!current || current.token !== session.token || current.revision !== session.revision) {
    throw new Error('登录账号已变更，请重新同步');
  }
}

function rejectLocalAccountMutation(): ShopActionResult | null {
  if (!getAccountSession()) {
    return null;
  }
  return {
    ok: false,
    code: 'SERVER_AUTHORITY_REQUIRED',
    message: '账号资产由服务器确认，本地体验不会计入账号',
    state: getStoreState(),
  };
}

const SKIN_RARITY_META: Record<string, {rank: number; label: string}> = {
  base: {rank: 0, label: '基础'},
  common: {rank: 1, label: '普通'},
  rare: {rank: 2, label: '稀有'},
  legendary: {rank: 3, label: '传说'},
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeArray(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeRecords(list: unknown): LedgerRecord[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const source = item as Partial<LedgerRecord>;
      const amount = Math.floor(Number(source.amount) || 0);
      const balanceAfter = Math.max(0, Math.floor(Number(source.balanceAfter) || 0));
      const title = String(source.title || '').trim();
      if (!title) {
        return null;
      }
      return {
        id: String(source.id || `ledger-${index}`),
        type: String(source.type || 'unknown'),
        title,
        amount,
        balanceAfter,
        createdAt: Number(source.createdAt) || Date.now(),
      };
    })
    .filter((record): record is LedgerRecord => record !== null)
    .slice(0, MAX_RECORDS);
}

function getSkinById(id: string) {
  return GOODS.skin.find((item) => item.id === id) || null;
}

function getPetById(id: string) {
  return GOODS.pet.find((item) => item.id === id) || null;
}

function getRingById(id: string) {
  return GOODS.ring.find((item) => item.id === id) || null;
}

export function normalizeState(raw: unknown): ShopState {
  const source = raw && typeof raw === 'object' ? raw : {};
  const next: ShopState = {...DEFAULT_STATE, ...source};
  next.coins = Number.isFinite(Number(next.coins)) ? Math.max(0, Number(next.coins)) : DEFAULT_STATE.coins;
  next.ownedSkins = normalizeArray(next.ownedSkins);
  next.ownedPets = normalizeArray(next.ownedPets);
  next.ownedRings = normalizeArray(next.ownedRings);
  next.records = normalizeRecords(next.records);
  if (!next.ownedSkins.includes('skin-default')) {
    next.ownedSkins.unshift('skin-default');
  }

  if (!getSkinById(next.equippedSkinId) || !next.ownedSkins.includes(next.equippedSkinId)) {
    next.equippedSkinId = 'skin-default';
  }
  if (!next.equippedPetId || !getPetById(next.equippedPetId) || !next.ownedPets.includes(next.equippedPetId)) {
    next.equippedPetId = '';
  }
  if (!next.equippedRingId || !getRingById(next.equippedRingId) || !next.ownedRings.includes(next.equippedRingId)) {
    next.equippedRingId = '';
  }
  return next;
}

function loadState(): ShopState {
  if (getAccountSession()) {
    return accountState as ShopState;
  }
  return normalizeState(readJson<ShopState>(SHOP_STORAGE_KEY));
}

function saveState(state: unknown): ShopState {
  if (getAccountSession()) {
    throw new Error('账号资产只能由服务器同步');
  }
  const normalized = normalizeState(state);
  writeJson(SHOP_STORAGE_KEY, normalized);
  return normalized;
}

export function getStoreState(): ShopState {
  return clone(loadState());
}

function buildLedgerRecord(payload: {
  type?: unknown;
  title?: unknown;
  amount?: unknown;
  balanceAfter?: unknown;
}): LedgerRecord {
  return {
    id: `ledger-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    type: String(payload.type || 'unknown'),
    title: String(payload.title || '资金变动'),
    amount: Math.floor(Number(payload.amount) || 0),
    balanceAfter: Math.max(0, Math.floor(Number(payload.balanceAfter) || 0)),
    createdAt: Date.now(),
  };
}

function appendLedger(state: unknown, payload: Parameters<typeof buildLedgerRecord>[0]): ShopState {
  const current = normalizeState(state);
  const record = buildLedgerRecord(payload);
  return {
    ...current,
    records: [record, ...current.records].slice(0, MAX_RECORDS),
  };
}

export function getCatalog() {
  return clone(GOODS);
}

export function getGoodsByCategory(category: ShopCategory | string): ShopItem[] {
  if (category === 'pet') {
    return clone(GOODS.pet);
  }
  if (category === 'ring') {
    return clone(GOODS.ring);
  }
  return clone(GOODS.skin);
}

export function getSkinRarityMeta(rarity: string): {rank: number; label: string} {
  return SKIN_RARITY_META[rarity] || SKIN_RARITY_META.common;
}

function compareSkinItems(a: ShopItem, b: ShopItem): number {
  const rarityA = getSkinRarityMeta('rarity' in a ? a.rarity : '').rank;
  const rarityB = getSkinRarityMeta('rarity' in b ? b.rarity : '').rank;
  if (rarityA !== rarityB) {
    return rarityA - rarityB;
  }
  const themeA = 'theme' in a ? String(a.theme || '') : '';
  const themeB = 'theme' in b ? String(b.theme || '') : '';
  const themeCompare = themeA.localeCompare(themeB, 'zh-Hans-CN');
  if (themeCompare !== 0) {
    return themeCompare;
  }
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
}

export function buildGoodsView(category: ShopCategory | string, state: unknown = loadState()): GoodsViewItem[] {
  const current = normalizeState(state);
  const ownedIds =
    category === 'pet' ? current.ownedPets : category === 'ring' ? current.ownedRings : current.ownedSkins;
  const equippedId =
    category === 'pet'
      ? current.equippedPetId
      : category === 'ring'
        ? current.equippedRingId
        : current.equippedSkinId;
  const list = getGoodsByCategory(category);
  const sortedList = category === 'skin' ? list.sort(compareSkinItems) : list;
  return sortedList.map((item) => ({
    ...item,
    rarityLabel: category === 'skin' && 'rarity' in item ? getSkinRarityMeta(item.rarity).label : '',
    owned: ownedIds.includes(item.id),
    equipped: equippedId === item.id,
    canBuy: item.price <= current.coins && !ownedIds.includes(item.id),
  }));
}

export function purchaseItem(category: ShopCategory | string, itemId: string): ShopActionResult {
  const accountError = rejectLocalAccountMutation();
  if (accountError) {
    return accountError;
  }
  const list = category === 'pet' ? GOODS.pet : category === 'ring' ? GOODS.ring : GOODS.skin;
  const item = list.find((goods) => goods.id === itemId);
  if (!item) {
    return {ok: false, code: 'NOT_FOUND', message: '商品不存在'};
  }

  const state = loadState();
  const ownedKey: 'ownedPets' | 'ownedRings' | 'ownedSkins' =
    category === 'pet' ? 'ownedPets' : category === 'ring' ? 'ownedRings' : 'ownedSkins';
  if (state[ownedKey].includes(itemId)) {
    return {
      ok: false,
      code: 'ALREADY_OWNED',
      message: '已拥有该商品',
      state: clone(state),
    };
  }
  if (item.price > state.coins) {
    return {
      ok: false,
      code: 'INSUFFICIENT_COINS',
      message: '账户余额不足',
      state: clone(state),
    };
  }

  const nextCoins = state.coins - item.price;
  const nextState = saveState(
    appendLedger(
      {
        ...state,
        coins: nextCoins,
        [ownedKey]: [...state[ownedKey], itemId],
      },
      {
        type: 'purchase',
        title: `购买${item.name}`,
        amount: -item.price,
        balanceAfter: nextCoins,
      }
    )
  );
  return {
    ok: true,
    code: 'PURCHASED',
    message: '购买成功，已入库',
    item: clone(item),
    state: clone(nextState),
  };
}

export function equipItem(category: ShopCategory | string, itemId: string): ShopActionResult {
  const accountError = rejectLocalAccountMutation();
  if (accountError) {
    return accountError;
  }
  const state = loadState();
  if (category === 'pet') {
    if (!state.ownedPets.includes(itemId)) {
      return {ok: false, code: 'NOT_OWNED', message: '请先购买该宠物', state: clone(state)};
    }
    const nextState = saveState({...state, equippedPetId: itemId});
    return {ok: true, code: 'EQUIPPED', message: '宠物已启用', state: clone(nextState)};
  }

  if (category === 'ring') {
    if (!state.ownedRings.includes(itemId)) {
      return {ok: false, code: 'NOT_OWNED', message: '请先购买该光环', state: clone(state)};
    }
    const nextState = saveState({...state, equippedRingId: itemId});
    return {ok: true, code: 'EQUIPPED', message: '光环已启用', state: clone(nextState)};
  }

  if (!state.ownedSkins.includes(itemId)) {
    return {ok: false, code: 'NOT_OWNED', message: '请先购买该皮肤', state: clone(state)};
  }
  const nextState = saveState({...state, equippedSkinId: itemId});
  return {ok: true, code: 'EQUIPPED', message: '皮肤已启用', state: clone(nextState)};
}

export function getEquippedDisplay(): EquippedDisplay {
  const state = loadState();
  const skin = getSkinById(state.equippedSkinId) || getSkinById('skin-default');
  const pet = state.equippedPetId ? getPetById(state.equippedPetId) : null;
  const ring = state.equippedRingId ? getRingById(state.equippedRingId) : null;
  return {
    coins: state.coins,
    assetSource: state.assetSource || 'guest',
    syncStatus: state.syncStatus || 'ready',
    equippedSkinId: state.equippedSkinId,
    equippedPetId: state.equippedPetId,
    equippedRingId: state.equippedRingId,
    skinClass: skin && skin.skinClass ? skin.skinClass : 'skin-default',
    skinName: skin && skin.name ? skin.name : '旅人本色',
    skinImage: skin && skin.skinImage ? skin.skinImage : '',
    ringName: ring && ring.name ? ring.name : '',
    ringImage: ring && ring.ringImage ? ring.ringImage : '',
    ringAccent: ring && ring.accent ? ring.accent : '',
    petIcon: pet && 'petIcon' in pet ? pet.petIcon : '',
    petLabel: pet && 'petLabel' in pet ? pet.petLabel : '',
    petImage: pet && 'petImage' in pet ? pet.petImage : '',
    petAccent: pet && pet.accent ? pet.accent : '',
  };
}

export function addCoins(amount: unknown, meta: {type?: string; title?: string} = {}): ShopState {
  const result = applyCoinsDelta(amount, {
    type: meta.type || 'game_reward',
    title: meta.title || '对局结算奖励',
  });
  return clone(result.state || loadState());
}

export function applyCoinsDelta(
  amount: unknown,
  meta: {type?: string; title?: string} = {}
): ShopActionResult {
  const accountError = rejectLocalAccountMutation();
  if (accountError) {
    return accountError;
  }
  const delta = Math.floor(Number(amount) || 0);
  const state = loadState();
  if (!delta) {
    return {
      ok: false,
      code: 'NO_CHANGE',
      message: '资金未变化',
      state: clone(state),
    };
  }

  const nextCoins = state.coins + delta;
  if (nextCoins < 0) {
    return {
      ok: false,
      code: 'INSUFFICIENT_COINS',
      message: '账户余额不足',
      state: clone(state),
    };
  }

  const nextState = saveState(
    appendLedger(
      {...state, coins: nextCoins},
      {
        type: meta.type || (delta > 0 ? 'income' : 'expense'),
        title: meta.title || (delta > 0 ? '资金入账' : '资金支出'),
        amount: delta,
        balanceAfter: nextCoins,
      }
    )
  );

  return {
    ok: true,
    code: 'UPDATED',
    message: delta > 0 ? '已入账' : '已扣款',
    delta,
    state: clone(nextState),
  };
}

export function getCoinRecords(): LedgerRecord[] {
  return clone(loadState().records);
}

export function clearLocalData(): ShopState {
  resetAccountState();
  removeKey(SHOP_STORAGE_KEY);
  return getStoreState();
}

/** @private 仅测试使用 - 生产代码不要调用 */
export function __resetForTests(): ShopState {
  resetAccountState();
  return clearLocalData();
}

function readSuccessFlag(result: unknown): boolean | undefined {
  if (result && typeof result === 'object' && 'success' in result) {
    return result.success === true;
  }
  return undefined;
}

function readCoinsValue(result: unknown): number | undefined {
  if (result && typeof result === 'object' && 'coins' in result) {
    const coins = result.coins;
    return coins === null || coins === undefined ? undefined : Number(coins);
  }
  return undefined;
}

function readInventoryItems(items: unknown): {item_id: string; category: string; is_equipped?: unknown}[] | null {
  if (!Array.isArray(items)) {
    return null;
  }
  const normalized: {item_id: string; category: string; is_equipped?: unknown}[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('item_id' in item) || !('category' in item)) {
      return null;
    }
    normalized.push({
      item_id: String(item.item_id),
      category: String(item.category),
      is_equipped: 'is_equipped' in item ? item.is_equipped : undefined,
    });
  }
  return normalized;
}

async function runAccountAction(path: string, payload: unknown, actionLabel: string): Promise<ShopActionResult> {
  const session = getAccountSession();
  if (!session) {
    return {ok: false, code: 'LOGIN_REQUIRED', committed: false, message: '请先登录后再操作账号资产'};
  }
  let committed = false;
  try {
    const result = await api.post(path, payload);
    assertAccountSession(session);
    const successFlag = readSuccessFlag(result);
    const coinsValue = readCoinsValue(result);
    if (
      !result ||
      (path === '/shop/equip' && successFlag !== true) ||
      (path === '/shop/buy' && (coinsValue === undefined || !Number.isFinite(coinsValue) || coinsValue < 0))
    ) {
      throw new Error('服务器未确认操作结果，请同步后查看');
    }
    committed = true;
    // 不推算库存或余额，写接口成功后也必须重新读取服务器快照。
    // 写操作之前启动的读取可能仍是旧库存，不能复用它宣告成功。
    if (inventoryRequest) {
      await inventoryRequest.catch(() => undefined);
    }
    assertAccountSession(session);
    await refreshInventory();
    assertAccountSession(session);
    return {ok: true, code: 'CONFIRMED', committed: true, message: `${actionLabel}成功`, state: getStoreState()};
  } catch (error) {
    const message = committed
      ? `${actionLabel}已提交，资产同步失败，请刷新确认后勿重复操作`
      : (error instanceof Error ? error.message : '') || `${actionLabel}失败，请稍后重试`;
    return {ok: false, code: committed ? 'SYNC_FAILED' : 'API_FAILED', committed, message};
  }
}

export function buyViaApi(itemId: string): Promise<ShopActionResult> {
  return runAccountAction('/shop/buy', {itemId}, '购买');
}

export function equipViaApi(itemId: string, category: ShopCategory): Promise<ShopActionResult> {
  return runAccountAction('/shop/equip', {itemId, category}, '装备');
}

export function refreshInventory(profile?: unknown): Promise<ShopState> {
  const session = getAccountSession();
  if (!session) {
    return Promise.reject(new Error('请先登录后再同步账号资产'));
  }
  if (inventoryRequest) {
    return inventoryRequest;
  }
  accountState = {...(accountState as ShopState), syncStatus: 'loading', syncError: ''};
  const request: Promise<ShopState> = Promise.all([
    profile ? Promise.resolve(profile) : api.get('/user/profile'),
    api.get('/shop/inventory'),
  ])
    .then(([user, items]) => {
      assertAccountSession(session);
      const coinsValue = readCoinsValue(user);
      if (coinsValue === undefined || !Number.isFinite(coinsValue) || coinsValue < 0) {
        throw new Error('服务器余额数据无效，请稍后重新同步');
      }
      const normalizedItems = readInventoryItems(items);
      if (!normalizedItems) {
        throw new Error('服务器库存数据无效，请稍后重新同步');
      }
      const owned = (category: string) =>
        normalizedItems.filter((item) => item.category === category).map((item) => item.item_id);
      const equipped = (category: string) => {
        const item = normalizedItems.find(
          (entry) => entry.category === category && (entry.is_equipped === true || Number(entry.is_equipped) === 1)
        );
        return item ? item.item_id : '';
      };
      accountState = normalizeState({
        coins: coinsValue,
        ownedSkins: owned('skin'),
        ownedPets: owned('pet'),
        ownedRings: owned('ring'),
        equippedSkinId: equipped('skin') || 'skin-default',
        equippedPetId: equipped('pet'),
        equippedRingId: equipped('ring'),
        records: [],
        assetSource: 'server',
        syncStatus: 'ready',
        syncError: '',
      });
      return getStoreState();
    })
    .catch((error: unknown) => {
      const current = getAccountSession();
      if (current && current.token === session.token && current.revision === session.revision) {
        accountState = {
          ...(accountState as ShopState),
          syncStatus: 'error',
          syncError: error instanceof Error ? error.message : '资产同步失败',
        };
      }
      throw error;
    })
    .finally(() => {
      if (inventoryRequest === request) {
        inventoryRequest = null;
      }
    });
  inventoryRequest = request;
  return request;
}
