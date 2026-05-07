const SHOP_STORAGE_KEY = 'game_codex_shop_store_v1';

const DEFAULT_STATE = {
  coins: 8820,
  ownedSkins: ['skin-default'],
  ownedPets: [],
  equippedSkinId: 'skin-default',
  equippedPetId: '',
  records: [],
};
const MAX_RECORDS = 120;

const SKIN_RARITY_META = {
  base: {rank: 0, label: '基础'},
  common: {rank: 1, label: '普通'},
  rare: {rank: 2, label: '稀有'},
  legendary: {rank: 3, label: '传说'},
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
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-01.png',
      rarity: 'base',
      theme: '经典',
    },
    {
      id: 'skin-jade-rabbit',
      category: 'skin',
      name: '玉兔研灵',
      price: 1280,
      accent: '#7dbd8f',
      description: '青玉光晕，灵草与符文相伴。',
      skinClass: 'skin-sakura',
      skinIcon: '🐇',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-05.png',
      rarity: 'common',
      theme: '灵秀',
    },
    {
      id: 'skin-monk-bell',
      category: 'skin',
      name: '净心行者',
      price: 1280,
      accent: '#cc9a57',
      description: '一念清明，步履之间自有禅意。',
      skinClass: 'skin-default',
      skinIcon: '🧘',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-09.png',
      rarity: 'common',
      theme: '禅意',
    },
    {
      id: 'skin-owl-minister',
      category: 'skin',
      name: '夜枭博士',
      price: 1280,
      accent: '#8b6a4c',
      description: '沉着冷静，擅长洞察局势细节。',
      skinClass: 'skin-storm',
      skinIcon: '🦉',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-13.png',
      rarity: 'common',
      theme: '谋略',
    },
    {
      id: 'skin-night-owl',
      category: 'skin',
      name: '夜行卷轴',
      price: 1280,
      accent: '#8d7a62',
      description: '卷轴在手，策略与沉着兼得。',
      skinClass: 'skin-default',
      skinIcon: '📜',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-19.png',
      rarity: 'common',
      theme: '谋略',
    },
    {
      id: 'skin-red-koi',
      category: 'skin',
      name: '赤鳞逐浪',
      price: 1280,
      accent: '#e07e53',
      description: '赤鳞耀光，风格张扬且不失灵动。',
      skinClass: 'skin-sunrise',
      skinIcon: '🐠',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-20.png',
      rarity: 'common',
      theme: '水灵',
    },
    {
      id: 'skin-sakura',
      category: 'skin',
      name: '樱见春山',
      price: 2280,
      accent: '#d86b87',
      description: '柔和樱粉与金边，适合高调开局。',
      skinClass: 'skin-sakura',
      skinIcon: '🌸',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-08.png',
      rarity: 'rare',
      theme: '仙灵',
    },
    {
      id: 'skin-nine-tail',
      category: 'skin',
      name: '九尾灵焰',
      price: 2280,
      accent: '#e07f4f',
      description: '灵焰环绕，气场温柔却锋利。',
      skinClass: 'skin-sakura',
      skinIcon: '🦊',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-02.png',
      rarity: 'rare',
      theme: '瑞兽',
    },
    {
      id: 'skin-tiger-general',
      category: 'skin',
      name: '虎将旌旗',
      price: 2280,
      accent: '#d27a31',
      description: '披甲执旗，战意与胆识并存。',
      skinClass: 'skin-sunrise',
      skinIcon: '🐯',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-04.png',
      rarity: 'rare',
      theme: '武将',
    },
    {
      id: 'skin-storm',
      category: 'skin',
      name: '风暴夜航',
      price: 2280,
      accent: '#4c6edb',
      description: '深海蓝与冷银线条，更锋利的视觉识别。',
      skinClass: 'skin-storm',
      skinIcon: '🌊',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-06.png',
      rarity: 'rare',
      theme: '玄夜',
    },
    {
      id: 'skin-antler-rune',
      category: 'skin',
      name: '灵角秘纹',
      price: 2280,
      accent: '#6fc0b6',
      description: '秘纹环绕，带来沉稳而神秘的观感。',
      skinClass: 'skin-storm',
      skinIcon: '🦌',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-16.png',
      rarity: 'rare',
      theme: '瑞兽',
    },
    {
      id: 'skin-sunrise',
      category: 'skin',
      name: '鎏金日珥',
      price: 3280,
      accent: '#ea7b2c',
      description: '橙金渐变，适合强调自己的主角感。',
      skinClass: 'skin-sunrise',
      skinIcon: '🌞',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-07.png',
      rarity: 'legendary',
      theme: '尊耀',
    },
    {
      id: 'skin-qitian-hero',
      category: 'skin',
      name: '齐天小圣',
      price: 3280,
      accent: '#d89051',
      description: '英气十足，越战越勇的标志外观。',
      skinClass: 'skin-sunrise',
      skinIcon: '🐒',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-17.png',
      rarity: 'legendary',
      theme: '神话',
    },
    {
      id: 'skin-celestial-dancer',
      category: 'skin',
      name: '飞天羽衣',
      price: 3280,
      accent: '#dd8a93',
      description: '仙姿飘逸，适合高辨识度登场。',
      skinClass: 'skin-sakura',
      skinIcon: '🕊',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-18.png',
      rarity: 'legendary',
      theme: '仙灵',
    },
    {
      id: 'skin-mint-qilin',
      category: 'skin',
      name: '青麟守约',
      price: 3280,
      accent: '#67bdb8',
      description: '青麟护体，兼顾清爽与高级质感。',
      skinClass: 'skin-storm',
      skinIcon: '🐲',
      skinImage: 'https://xcx.ukb88.com/assets/skins/skin-21.png',
      rarity: 'legendary',
      theme: '瑞兽',
    },
  ],
  pet: [
    {
      id: 'pet-xiaohu',
      category: 'pet',
      name: '小虎',
      price: 1200,
      accent: '#c67a42',
      description: '风吹遁形的森林之王，其笑容纯真却威风十足。',
      petIcon: '🐯',
      petLabel: '小虎',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/xiaohu.png',
    },
    {
      id: 'pet-fulu',
      category: 'pet',
      name: '福鹿',
      price: 3500,
      accent: '#4f7a6a',
      description: '踏雪寻梅而来的使者，静谧中自带祥瑞气息。',
      petIcon: '🦌',
      petLabel: '福鹿',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/fulu.png',
    },
    {
      id: 'pet-dragon',
      category: 'pet',
      name: '淘气龙',
      price: 5800,
      accent: '#9f5b2b',
      description: '掌管云雨的小神龙，打架最凶却最爱撒娇。',
      petIcon: '🐉',
      petLabel: '淘气龙',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/taoqilong.png',
    },
    {
      id: 'pet-luckycat',
      category: 'pet',
      name: '招财猫',
      price: 888,
      accent: '#c77d28',
      description: '每日招小财，能为你招来旅途中的好运与惊喜。',
      petIcon: '🐱',
      petLabel: '招财猫',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/zhaocaimao.png',
    },
    {
      id: 'pet-xiongmao',
      category: 'pet',
      name: '熊猫',
      price: 2200,
      accent: '#5d704b',
      description: '憨态可掬，平日里最爱在竹林里晒太阳。',
      petIcon: '🐼',
      petLabel: '熊猫',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/xiongmao.png',
    },
    {
      id: 'pet-yutu',
      category: 'pet',
      name: '玉兔',
      price: 1800,
      accent: '#c58f93',
      description: '来自月宫的小精灵，捣药之外也会悄悄护你。',
      petIcon: '🐇',
      petLabel: '玉兔',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/yutu.png',
    },
    {
      id: 'pet-jinli',
      category: 'pet',
      name: '锦鲤',
      price: 666,
      accent: '#cb7b2a',
      description: '化龙池中的佼佼者，其发光鳞片象征顺遂。',
      petIcon: '🐟',
      petLabel: '锦鲤',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/jinli.png',
    },
    {
      id: 'pet-fox',
      category: 'pet',
      name: '灵狐',
      price: 4200,
      accent: '#de6a45',
      description: '青丘而来的小狐，机灵过人，总能先一步察觉危险。',
      petIcon: '🦊',
      petLabel: '灵狐',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/linghu.png',
    },
    {
      id: 'pet-xianhe',
      category: 'pet',
      name: '仙鹤',
      price: 2900,
      accent: '#6e8d8e',
      description: '乘风而来的修行伴侣，志向远大，声闻九天。',
      petIcon: '🕊',
      petLabel: '仙鹤',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/xianhe.png',
    },
    {
      id: 'pet-xiaofenghuang',
      category: 'pet',
      name: '小凤凰',
      price: 9999,
      accent: '#d05b1f',
      description: '是浴火涅槃，但尚且年幼，已隐隐显出王者气。',
      petIcon: '🐦',
      petLabel: '小凤凰',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/xiaofenghuang.png',
    },
    {
      id: 'pet-ruiquan',
      category: 'pet',
      name: '瑞犬',
      price: 1100,
      accent: '#9a5e3b',
      description: '极其忠诚，能守护主人的每一次关键抉择。',
      petIcon: '🐶',
      petLabel: '瑞犬',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/ruiquan.png',
    },
    {
      id: 'pet-momao',
      category: 'pet',
      name: '墨猫',
      price: 1500,
      accent: '#5a4a53',
      description: '如同宣纸上的一抹淡墨，动静之间自带风骨。',
      petIcon: '🐈',
      petLabel: '墨猫',
      petImage: 'https://xcx.ukb88.com/assets/111/pets/momao.png',
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

function normalizeRecords(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const amount = Math.floor(Number(item.amount) || 0);
      const balanceAfter = Math.max(0, Math.floor(Number(item.balanceAfter) || 0));
      const title = String(item.title || '').trim();
      if (!title) {
        return null;
      }
      return {
        id: String(item.id || `ledger-${index}`),
        type: String(item.type || 'unknown'),
        title,
        amount,
        balanceAfter,
        createdAt: Number(item.createdAt) || Date.now(),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RECORDS);
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

function buildLedgerRecord({type, title, amount, balanceAfter}) {
  return {
    id: `ledger-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    type: String(type || 'unknown'),
    title: String(title || '资金变动'),
    amount: Math.floor(Number(amount) || 0),
    balanceAfter: Math.max(0, Math.floor(Number(balanceAfter) || 0)),
    createdAt: Date.now(),
  };
}

function appendLedger(state, payload) {
  const current = normalizeState(state);
  const record = buildLedgerRecord(payload);
  return {
    ...current,
    records: [record, ...current.records].slice(0, MAX_RECORDS),
  };
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

function getSkinRarityMeta(rarity) {
  return SKIN_RARITY_META[rarity] || SKIN_RARITY_META.common;
}

function compareSkinItems(a, b) {
  const rarityA = getSkinRarityMeta(a.rarity).rank;
  const rarityB = getSkinRarityMeta(b.rarity).rank;
  if (rarityA !== rarityB) {
    return rarityA - rarityB;
  }
  const themeA = String(a.theme || '');
  const themeB = String(b.theme || '');
  const themeCompare = themeA.localeCompare(themeB, 'zh-Hans-CN');
  if (themeCompare !== 0) {
    return themeCompare;
  }
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
}

function buildGoodsView(category, state = loadState()) {
  const current = normalizeState(state);
  const ownedIds = category === 'pet' ? current.ownedPets : current.ownedSkins;
  const equippedId = category === 'pet' ? current.equippedPetId : current.equippedSkinId;
  const list = getGoodsByCategory(category);
  const sortedList = category === 'skin' ? list.sort(compareSkinItems) : list;
  return sortedList.map((item) => ({
    ...item,
    rarityLabel: category === 'skin' ? getSkinRarityMeta(item.rarity).label : '',
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
      message: '账户余额不足',
      state: clone(state),
    };
  }

  const nextCoins = state.coins - item.price;
  const nextState = saveState(appendLedger({
    ...state,
    coins: nextCoins,
    [ownedKey]: [...state[ownedKey], itemId],
  }, {
    type: 'purchase',
    title: `购买${item.name}`,
    amount: -item.price,
    balanceAfter: nextCoins,
  }));
  return {
    ok: true,
    code: 'PURCHASED',
    message: '购买成功，已入库',
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
    return {ok: true, code: 'EQUIPPED', message: '宠物已启用', state: clone(nextState)};
  }

  if (!state.ownedSkins.includes(itemId)) {
    return {ok: false, code: 'NOT_OWNED', message: '请先购买该皮肤', state: clone(state)};
  }
  const nextState = saveState({
    ...state,
    equippedSkinId: itemId,
  });
  return {ok: true, code: 'EQUIPPED', message: '皮肤已启用', state: clone(nextState)};
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
    skinImage: skin && skin.skinImage ? skin.skinImage : '',
    petIcon: pet && pet.petIcon ? pet.petIcon : '',
    petLabel: pet && pet.petLabel ? pet.petLabel : '',
    petImage: pet && pet.petImage ? pet.petImage : '',
    petAccent: pet && pet.accent ? pet.accent : '',
  };
}

function addCoins(amount, meta = {}) {
  const result = applyCoinsDelta(amount, {
    type: meta.type || 'game_reward',
    title: meta.title || '对局结算奖励',
  });
  return clone(result.state || loadState());
}

function applyCoinsDelta(amount, meta = {}) {
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

  const nextState = saveState(appendLedger({
    ...state,
    coins: nextCoins,
  }, {
    type: meta.type || (delta > 0 ? 'income' : 'expense'),
    title: meta.title || (delta > 0 ? '资金入账' : '资金支出'),
    amount: delta,
    balanceAfter: nextCoins,
  }));

  return {
    ok: true,
    code: 'UPDATED',
    message: delta > 0 ? '已入账' : '已扣款',
    delta,
    state: clone(nextState),
  };
}

function getCoinRecords() {
  return clone(loadState().records);
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
  getCoinRecords,
  buildGoodsView,
  addCoins,
  applyCoinsDelta,
  purchaseItem,
  equipItem,
  getEquippedDisplay,
  __resetForTests,
};
