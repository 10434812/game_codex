const db = require('../models/db');

/**
 * Static goods catalog — copied from frontend shop-store.js
 * Flat array of all skin + pet items.
 */
const GOODS = [
  // ── Skins ───────────────────────────────────────────
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

  // ── Pets ────────────────────────────────────────────
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

  // ── Avatar Rings ─────────────────────────────────────
  {
    id: 'ring-amber-glow',
    category: 'ring',
    name: '琥珀流光',
    price: 880,
    accent: '#d88a2f',
    description: '暖金流动的基础光环，适合大部分头像。',
    ringIcon: '✨',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_01.png',
  },
  {
    id: 'ring-cloud-bloom',
    category: 'ring',
    name: '云霞锦簇',
    price: 1280,
    accent: '#d57554',
    description: '层叠花纹与暖霞边光，视觉更热闹。',
    ringIcon: '🌺',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_02.png',
  },
  {
    id: 'ring-verdant-song',
    category: 'ring',
    name: '青岚回响',
    price: 1580,
    accent: '#6fa66f',
    description: '偏青绿色系的雅致光环，风格清润。',
    ringIcon: '🍃',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_03.png',
  },
  {
    id: 'ring-sun-feather',
    category: 'ring',
    name: '金羽朝曦',
    price: 1880,
    accent: '#e39a3a',
    description: '羽纹外扩，适合强调主角位和高光时刻。',
    ringIcon: '☀️',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_04.png',
  },
  {
    id: 'ring-flame-dance',
    category: 'ring',
    name: '焰纹流彩',
    price: 2180,
    accent: '#df6d49',
    description: '更张扬的红金火纹，适合强存在感展示。',
    ringIcon: '🔥',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_05.png',
  },
  {
    id: 'ring-moon-frost',
    category: 'ring',
    name: '月华霜晕',
    price: 2480,
    accent: '#8f93c9',
    description: '偏冷调的环形光泽，适合静谧神秘风格。',
    ringIcon: '🌙',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_06.png',
  },
  {
    id: 'ring-crown-auspice',
    category: 'ring',
    name: '瑞冠天光',
    price: 2880,
    accent: '#c88a2b',
    description: '层次最完整的高级款，适合压轴登场。',
    ringIcon: '👑',
    ringLabel: '光环',
    ringImage: 'https://xcx.ukb88.com/assets/avatar-rings/avatar_ring_07.png',
  },
];

/**
 * Return the full goods catalog (no DB needed).
 */
async function getItems() {
  return GOODS;
}

/**
 * Buy an item: deduct coins, insert into user_items, log coin_record.
 * Uses a DB transaction for atomicity.
 *
 * @param {number} userId
 * @param {string} itemId
 * @returns {Promise<{ coins: number, item: object }>}
 */
async function buyItem(userId, itemId) {
  // 1. Find item in catalog
  const item = GOODS.find((g) => g.id === itemId);
  if (!item) {
    throw Object.assign(new Error('商品不存在'), { status: 404 });
  }

  // 2. Check user has enough coins
  const user = await db.queryOne('SELECT coins FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw Object.assign(new Error('用户不存在'), { status: 404 });
  }
  if (user.coins < item.price) {
    throw Object.assign(new Error('金币不足'), { status: 400 });
  }

  // 3. Check user doesn't already own this item
  const existing = await db.queryOne(
    'SELECT id FROM user_items WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  if (existing) {
    throw Object.assign(new Error('已拥有该物品'), { status: 400 });
  }

  // 4. Execute transaction
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    // Deduct coins
    await conn.execute(
      'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
      [item.price, userId, item.price]
    );

    // Get updated balance
    const [[{ coins }]] = await conn.execute('SELECT coins FROM users WHERE id = ?', [userId]);

    // Insert user_item
    await conn.execute(
      'INSERT INTO user_items (user_id, item_id, category) VALUES (?, ?, ?)',
      [userId, itemId, item.category]
    );

    // Insert coin record
    await conn.execute(
      'INSERT INTO coin_records (user_id, amount, balance_after, type, title) VALUES (?, ?, ?, ?, ?)',
      [userId, -item.price, coins, 'purchase', `购买 ${item.name}`]
    );

    await conn.commit();

    return { coins, item };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Equip an owned item. Unequips all other items in the same category first.
 *
 * @param {number} userId
 * @param {string} itemId
 * @param {string} category - 'skin' or 'pet'
 * @returns {Promise<{ success: boolean }>}
 */
async function equipItem(userId, itemId, category) {
  // Verify user owns the item
  const owned = await db.queryOne(
    'SELECT id FROM user_items WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  if (!owned) {
    throw Object.assign(new Error('未拥有该物品'), { status: 400 });
  }

  // Transaction: unequip all in category, then equip this one
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    // Unequip all items in this category
    await conn.execute(
      'UPDATE user_items SET is_equipped = 0 WHERE user_id = ? AND category = ?',
      [userId, category]
    );

    // Equip this specific item
    await conn.execute(
      'UPDATE user_items SET is_equipped = 1 WHERE user_id = ? AND item_id = ?',
      [userId, itemId]
    );

    await conn.commit();

    return { success: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Get user's inventory (all owned items).
 *
 * @param {number} userId
 * @returns {Promise<Array>}
 */
async function getInventory(userId) {
  const items = await db.queryAll(
    `SELECT
       item_id,
       item_id AS id,
       category,
       is_equipped,
       is_equipped AS isEquipped,
       acquired_at,
       acquired_at AS acquiredAt
     FROM user_items
     WHERE user_id = ?
     ORDER BY acquired_at DESC`,
    [userId]
  );
  return items;
}

module.exports = { getItems, buyItem, equipItem, getInventory, GOODS };
