const db = require('../models/db');
const { formatDateTime, mapUser, mapItem, mapGameSession } = require('../utils/admin-presenters');

async function listUsers(page = 1, limit = 20, keyword = '') {
  const offset = (page - 1) * limit;
  let where = 'WHERE deleted_at IS NULL';
  let params = [];
  const trimmed = String(keyword || '').trim();
  if (trimmed) {
    if (/^\d+$/.test(trimmed)) {
      where += ' AND (id = ? OR nick_name LIKE ? OR openid LIKE ?)';
      params.push(Number(trimmed), `%${trimmed}%`, `%${trimmed}%`);
    } else {
      where += ' AND (nick_name LIKE ? OR openid LIKE ?)';
      params.push(`%${trimmed}%`, `%${trimmed}%`);
    }
  }
  const total = await db.queryOne(`SELECT COUNT(*) as total FROM users ${where}`, params);
  const records = await db.queryAll(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, String(limit), String(offset)]);
  return { records: records.map(mapUser), total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getUserDetail(userId) {
  const user = await db.queryOne('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [userId]);
  if (!user) return null;
  const items = await db.queryAll(
    `SELECT ui.*, si.name AS item_name, si.rarity AS item_rarity
       FROM user_items ui
       LEFT JOIN shop_items si ON si.item_id = ui.item_id
      WHERE ui.user_id = ?`,
    [userId]
  );
  const games = await db.queryAll('SELECT gp.*, gs.started_at, gs.stage_id, gs.status as game_status, gs.duration FROM game_players gp JOIN game_sessions gs ON gp.session_id = gs.id WHERE gp.user_id = ? ORDER BY gs.started_at DESC LIMIT 20', [userId]);
  const coinRecords = await db.queryAll('SELECT * FROM coin_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
  return {
    user: mapUser(user),
    items: items.map((item) => ({
      ...mapItem(item),
      name: item.item_name || item.item_id,
      rarity: item.item_rarity || item.rarity || '',
      acquiredAt: formatDateTime(item.acquired_at),
    })),
    games: games.map((game) => ({
      ...mapGameSession({
        id: game.session_id,
        stage_id: game.stage_id,
        status: game.game_status,
        duration: game.duration,
        started_at: game.started_at,
      }),
      rank: game.rank,
      score: game.final_score,
      playedAt: formatDateTime(game.started_at),
    })),
    coinRecords: coinRecords.map((record) => ({
      ...record,
      reason: record.title,
      createdAt: formatDateTime(record.created_at),
    })),
  };
}

async function toggleBan(userId, isBanned, reason = '') {
  await db.execute('UPDATE users SET is_banned = ?, banned_reason = ? WHERE id = ? AND deleted_at IS NULL', [isBanned ? 1 : 0, reason, userId]);
  const user = await db.queryOne('SELECT id, nick_name, avatar_url, game_count, win_count, total_income, total_exp, coins, level, is_banned, banned_reason FROM users WHERE id = ?', [userId]);
  return mapUser(user);
}

async function adjustCoins(userId, amount, reason = '') {
  // coin_records.amount is signed INT; users.coins is unsigned INT.
  if (!Number.isInteger(amount) || amount === 0 || amount < -2147483648 || amount > 2147483647) {
    throw Object.assign(new Error('调整金额必须为有效范围内的非零整数'), {statusCode: 400});
  }
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [userRows] = await connection.execute('SELECT coins FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [userId]);
    if (!userRows[0]) {
      throw Object.assign(new Error('用户不存在'), {statusCode: 404});
    }
    const previousCoins = Number(userRows[0].coins);
    const newCoins = Math.max(0, previousCoins + amount);
    if (!Number.isInteger(newCoins) || newCoins > 4294967295) {
      throw Object.assign(new Error('调整后余额超出有效范围'), {statusCode: 400});
    }
    const actualAmount = newCoins - previousCoins;
    await connection.execute('UPDATE users SET coins = ? WHERE id = ?', [newCoins, userId]);
    await connection.execute('INSERT INTO coin_records (user_id, amount, balance_after, type, title) VALUES (?, ?, ?, ?, ?)', [userId, actualAmount, newCoins, 'admin_adjust', reason || '管理员调整']);
    await connection.commit();
    return { coins: newCoins, amount: actualAmount };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally { connection.release(); }
}

module.exports = { listUsers, getUserDetail, toggleBan, adjustCoins };
