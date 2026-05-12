const db = require('../models/db');
const { formatDateTime, mapUser, mapItem, mapGameSession } = require('../utils/admin-presenters');

async function listUsers(page = 1, limit = 20, keyword = '') {
  const offset = (page - 1) * limit;
  let where = '';
  let params = [];
  if (keyword) { where = 'WHERE nick_name LIKE ? OR openid LIKE ?'; params.push(`%${keyword}%`, `%${keyword}%`); }
  const total = await db.queryOne(`SELECT COUNT(*) as total FROM users ${where}`, params);
  const records = await db.queryAll(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, String(limit), String(offset)]);
  return { records: records.map(mapUser), total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getUserDetail(userId) {
  const user = await db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const items = await db.queryAll('SELECT * FROM user_items WHERE user_id = ?', [userId]);
  const games = await db.queryAll('SELECT gp.*, gs.started_at, gs.stage_id, gs.status as game_status, gs.duration FROM game_players gp JOIN game_sessions gs ON gp.session_id = gs.id WHERE gp.user_id = ? ORDER BY gs.started_at DESC LIMIT 20', [userId]);
  const coinRecords = await db.queryAll('SELECT * FROM coin_records WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
  return {
    user: mapUser(user),
    items: items.map((item) => ({
      ...mapItem(item),
      name: item.item_id,
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
  await db.execute('UPDATE users SET is_banned = ?, banned_reason = ? WHERE id = ?', [isBanned ? 1 : 0, reason, userId]);
  const user = await db.queryOne('SELECT id, nick_name, avatar_url, game_count, win_count, total_income, total_exp, coins, level, is_banned, banned_reason FROM users WHERE id = ?', [userId]);
  return mapUser(user);
}

async function adjustCoins(userId, amount, reason = '') {
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET coins = GREATEST(0, CAST(coins AS SIGNED) + ?) WHERE id = ?', [amount, userId]);
    const [userRows] = await connection.execute('SELECT coins FROM users WHERE id = ?', [userId]);
    const newCoins = userRows[0]?.coins || 0;
    await connection.execute('INSERT INTO coin_records (user_id, amount, balance_after, type, title) VALUES (?, ?, ?, ?, ?)', [userId, amount, newCoins, 'admin_adjust', reason || '管理员调整']);
    await connection.commit();
    return { coins: newCoins };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally { connection.release(); }
}

module.exports = { listUsers, getUserDetail, toggleBan, adjustCoins };
