const SHOP_STORAGE_KEY = 'game_codex_shop_store_v1';

const DEFAULT_STATE = {
  coins: 8820,
  ownedSkins: ['skin-default'],
  ownedPets: [],
  equippedSkinId: 'skin-default',
  equippedPetId: '',
};

const GOODS = {
  skin: [
    {
      id: 'skin-default',
      category: 'skin',
      name: '旅人本色',
      price: 0,
      accent: '#d14e42',
      description: '基础皮肤，沉稳的赤金外框。',
      skinClass: 'skin-default',
      skinIcon: '🎴',
    },
    {
      id: 'skin-sakura',
      category: 'skin',
      name: '樱见春山',
      price: 1680,
      accent: '#d86b87',
      description: '柔和樱粉与金边，适合高调开局。',
      skinClass: 'skin-sakura',
      skinIcon: '🌸',
    },
    {
      id: 'skin-storm',
      category: 'skin',
      name: '风暴夜航',
      price: 2380,
      accent: '#4c6edb',
      description: '深海蓝与冷银线条，更锋利的视觉识别。',
      skinClass: 'skin-storm',
      skinIcon: '🌊',
    },
    {
      id: 'skin-sunrise',
      category: 'skin',
      name: '鎏金日珥',
      price: 2880,
      accent: '#ea7b2c',
      description: '橙金渐变，适合强调自己的主角感。',
      skinClass: 'skin-sunrise',
      skinIcon: '🌞',
    },
  ],
  pet: [
    {
      id: 'pet-luckycat',
      category: 'pet',
      name: '招财喵',
      price: 980,
      accent: '#c77d28',
      description: '笑眯眯的招财猫，陪你稳稳收金。',
      petIcon: '🐱',
      petLabel: '招财喵',
    },
    {
      id: 'pet-fox',
      category: 'pet',
      name: '小灵狐',
      price: 1480,
      accent: '#de6a45',
      description: '动作轻快，适合灵活切换局势。',
      petIcon: '🦊',
      petLabel: '灵狐',
    },
    {
      id: 'pet-dragon',
      category: 'pet',
      name: '云游龙',
      price: 2280,
      accent: '#5c8c7b',
      description: '稀有宠物，气场更强。',
      petIcon: '🐉',
      petLabel: '云游龙',
    },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeArray(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean)));
}

function getSkinById(id) {
  return GOODS.skin.find((item) => item.id === id) || null;
}

function getPetById(id) {
  return GOODS.pet.find((item) => item.id === id) || null;
}

function normalizeState(raw) {
  const next = {
    ...DEFAULT_STATE,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  next.coins = Number.isFinite(Number(next.coins)) ? Math.max(0, Number(next.coins)) : DEFAULT_STATE.coins;
  next.ownedSkins = normalizeArray(next.ownedSkins);
  next.ownedPets = normalizeArray(next.ownedPets);
  if (!next.ownedSkins.includes('skin-default')) {
    next.ownedSkins.unshift('skin-default');
  }

  if (!getSkinById(next.equippedSkinId) || !next.ownedSkins.includes(next.equippedSkinId)) {
    next.equippedSkinId = 'skin-default';
  }
  if (!next.equippedPetId || !getPetById(next.equippedPetId) || !next.ownedPets.includes(next.equippedPetId)) {
    next.equippedPetId = '';
  }
  return next;
}

function loadState() {
  try {
    return normalizeState(wx.getStorageSync(SHOP_STORAGE_KEY));
  } catch (error) {
    return normalizeState(null);
  }
}

function saveState(state) {
  const normalized = normalizeState(state);
  try {
    wx.setStorageSync(SHOP_STORAGE_KEY, normalized);
  } catch (error) {}
  return normalized;
}

function getStoreState() {
  return clone(loadState());
}

function getCatalog() {
  return clone(GOODS);
}

function getGoodsByCategory(category) {
  if (category === 'pet') {
    return clone(GOODS.pet);
  }
  return clone(GOODS.skin);
}

function buildGoodsView(category, state = loadState()) {
  const current = normalizeState(state);
  const ownedIds = category === 'pet' ? current.ownedPets : current.ownedSkins;
  const equippedId = category === 'pet' ? current.equippedPetId : current.equippedSkinId;
  return getGoodsByCategory(category).map((item) => ({
    ...item,
    owned: ownedIds.includes(item.id),
    equipped: equippedId === item.id,
    canBuy: item.price <= current.coins && !ownedIds.includes(item.id),
  }));
}

function purchaseItem(category, itemId) {
  const list = category === 'pet' ? GOODS.pet : GOODS.skin;
  const item = list.find((goods) => goods.id === itemId);
  if (!item) {
    return {ok: false, code: 'NOT_FOUND', message: '商品不存在'};
  }

  const state = loadState();
  const ownedKey = category === 'pet' ? 'ownedPets' : 'ownedSkins';
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
      message: '幸运金币不足',
      state: clone(state),
    };
  }

  const nextState = saveState({
    ...state,
    coins: state.coins - item.price,
    [ownedKey]: [...state[ownedKey], itemId],
  });
  return {
    ok: true,
    code: 'PURCHASED',
    message: '购买成功',
    item: clone(item),
    state: clone(nextState),
  };
}

function equipItem(category, itemId) {
  const state = loadState();
  if (category === 'pet') {
    if (!state.ownedPets.includes(itemId)) {
      return {ok: false, code: 'NOT_OWNED', message: '请先购买该宠物', state: clone(state)};
    }
    const nextState = saveState({
      ...state,
      equippedPetId: itemId,
    });
    return {ok: true, code: 'EQUIPPED', message: '宠物已装备', state: clone(nextState)};
  }

  if (!state.ownedSkins.includes(itemId)) {
    return {ok: false, code: 'NOT_OWNED', message: '请先购买该皮肤', state: clone(state)};
  }
  const nextState = saveState({
    ...state,
    equippedSkinId: itemId,
  });
  return {ok: true, code: 'EQUIPPED', message: '皮肤已装备', state: clone(nextState)};
}

function getEquippedDisplay() {
  const state = loadState();
  const skin = getSkinById(state.equippedSkinId) || getSkinById('skin-default');
  const pet = state.equippedPetId ? getPetById(state.equippedPetId) : null;
  return {
    coins: state.coins,
    equippedSkinId: state.equippedSkinId,
    equippedPetId: state.equippedPetId,
    skinClass: skin && skin.skinClass ? skin.skinClass : 'skin-default',
    skinName: skin && skin.name ? skin.name : '旅人本色',
    petIcon: pet && pet.petIcon ? pet.petIcon : '',
    petLabel: pet && pet.petLabel ? pet.petLabel : '',
  };
}

function addCoins(amount) {
  const delta = Math.floor(Number(amount) || 0);
  if (delta <= 0) {
    return clone(loadState());
  }
  const state = loadState();
  const nextState = saveState({
    ...state,
    coins: state.coins + delta,
  });
  return clone(nextState);
}

function __resetForTests() {
  try {
    wx.removeStorageSync(SHOP_STORAGE_KEY);
  } catch (error) {}
  return getStoreState();
}

module.exports = {
  getCatalog,
  getGoodsByCategory,
  getStoreState,
  buildGoodsView,
  addCoins,
  purchaseItem,
  equipItem,
  getEquippedDisplay,
  __resetForTests,
};
