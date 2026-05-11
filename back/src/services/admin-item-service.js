const db = require('../models/db');

const DEFAULT_ITEMS = [
  { item_id:'skin-default', category:'skin', name:'旅人本色', price:0, rarity:'base', theme:'经典', sort_order:1 },
  { item_id:'skin-jade-rabbit', category:'skin', name:'玉兔研灵', price:1280, rarity:'common', theme:'灵秀', sort_order:2 },
  { item_id:'skin-monk-bell', category:'skin', name:'净心行者', price:1280, rarity:'common', theme:'禅意', sort_order:3 },
  { item_id:'skin-night-owl', category:'skin', name:'夜行卷轴', price:1280, rarity:'common', theme:'谋略', sort_order:4 },
  { item_id:'skin-red-koi', category:'skin', name:'赤鳞逐浪', price:1280, rarity:'common', theme:'水灵', sort_order:5 },
  { item_id:'skin-sakura', category:'skin', name:'樱见春山', price:2280, rarity:'rare', theme:'和风', sort_order:6 },
  { item_id:'skin-spring-bamboo', category:'skin', name:'青竹听雨', price:2280, rarity:'rare', theme:'雅致', sort_order:7 },
  { item_id:'skin-lion-seal', category:'skin', name:'醒狮印', price:2280, rarity:'rare', theme:'国潮', sort_order:8 },
  { item_id:'skin-crimson-night', category:'skin', name:'赤霄夜行', price:2280, rarity:'rare', theme:'暗夜', sort_order:9 },
  { item_id:'skin-ink-landscape', category:'skin', name:'墨染山水', price:2280, rarity:'rare', theme:'水墨', sort_order:10 },
  { item_id:'skin-snow-mountain', category:'skin', name:'雪域圣山', price:2580, rarity:'rare', theme:'雪山', sort_order:11 },
  { item_id:'skin-golden-koi', category:'skin', name:'金鳞耀世', price:3880, rarity:'legendary', theme:'至尊', sort_order:12 },
  { item_id:'skin-peach-blossom', category:'skin', name:'桃花映雪', price:3880, rarity:'legendary', theme:'唯美', sort_order:13 },
  { item_id:'skin-dragon-zodiac', category:'skin', name:'龙腾九州', price:8880, rarity:'legendary', theme:'庆典', sort_order:14 },
  { item_id:'pet-xiaohu', category:'pet', name:'小虎', price:1280, rarity:'common', theme:'萌宠', sort_order:15 },
  { item_id:'pet-fulu', category:'pet', name:'福鹿', price:1280, rarity:'common', theme:'萌宠', sort_order:16 },
  { item_id:'pet-taoqilong', category:'pet', name:'淘气龙', price:1280, rarity:'common', theme:'萌宠', sort_order:17 },
  { item_id:'pet-zhaocaimao', category:'pet', name:'招财猫', price:1280, rarity:'common', theme:'萌宠', sort_order:18 },
  { item_id:'pet-xiongmao', category:'pet', name:'熊猫', price:1580, rarity:'common', theme:'萌宠', sort_order:19 },
  { item_id:'pet-yutu', category:'pet', name:'玉兔', price:1580, rarity:'common', theme:'萌宠', sort_order:20 },
  { item_id:'pet-jinli', category:'pet', name:'锦鲤', price:2580, rarity:'rare', theme:'祥瑞', sort_order:21 },
  { item_id:'pet-linghu', category:'pet', name:'灵狐', price:3880, rarity:'legendary', theme:'仙灵', sort_order:22 },
  { item_id:'pet-xianhe', category:'pet', name:'仙鹤', price:3880, rarity:'legendary', theme:'仙灵', sort_order:23 },
  { item_id:'pet-xiaofenghuang', category:'pet', name:'小凤凰', price:8880, rarity:'legendary', theme:'神兽', sort_order:24 },
];

async function ensureItemsSeeded() {
  const count = await db.queryOne('SELECT COUNT(*) as total FROM shop_items');
  if (count && count.total > 0) return;

  for (const item of DEFAULT_ITEMS) {
    await db.execute(
      `INSERT IGNORE INTO shop_items (item_id, name, category, price, rarity, theme, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [item.item_id, item.name, item.category, item.price, item.rarity, item.theme, item.sort_order]
    );
  }
}

async function listItems() {
  await ensureItemsSeeded();
  return db.queryAll(
    'SELECT * FROM shop_items WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
  );
}

async function getItem(itemId) {
  return db.queryOne('SELECT * FROM shop_items WHERE id = ?', [itemId]);
}

async function createItem(data) {
  const { item_id, name, category, price, rarity, theme, description, image_url, sort_order } = data;

  if (item_id) {
    const existing = await db.queryOne('SELECT id FROM shop_items WHERE item_id = ?', [item_id]);
    if (existing) throw new Error('商品标识已存在');
  }

  const [result] = await db.execute(
    `INSERT INTO shop_items (item_id, name, category, price, rarity, theme, description, image_url, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item_id || '', name, category || 'skin', price || 0, rarity || 'common', theme || '', description || '', image_url || '', sort_order || 0]
  );

  return db.queryOne('SELECT * FROM shop_items WHERE id = ?', [result.insertId]);
}

async function updateItem(itemId, data) {
  const allowedFields = ['item_id', 'name', 'category', 'price', 'rarity', 'theme', 'description', 'image_url', 'is_active', 'sort_order'];
  const setClauses = [];
  const params = [];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(data[field]);
    }
  }

  if (setClauses.length === 0) return getItem(itemId);

  params.push(itemId);
  await db.execute(`UPDATE shop_items SET ${setClauses.join(', ')} WHERE id = ?`, params);
  return getItem(itemId);
}

async function deleteItem(itemId) {
  await db.execute('UPDATE shop_items SET is_active = 0 WHERE id = ?', [itemId]);
  return { deleted: true };
}

async function toggleActive(itemId) {
  const item = await db.queryOne('SELECT is_active FROM shop_items WHERE id = ?', [itemId]);
  if (!item) return null;
  const newActive = item.is_active ? 0 : 1;
  await db.execute('UPDATE shop_items SET is_active = ? WHERE id = ?', [newActive, itemId]);
  return { id: Number(itemId), is_active: newActive };
}

module.exports = { listItems, getItem, createItem, updateItem, deleteItem, toggleActive };
