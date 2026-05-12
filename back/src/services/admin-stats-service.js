const db = require('../models/db');

async function getOverview(from, to) {
  const start = from || '1970-01-01';
  const end = to ? `${to} 23:59:59` : '2099-12-31 23:59:59';
  const [dau, games, revenue] = await Promise.all([
    db.queryAll(
      `SELECT DATE(gs.started_at) as date, COUNT(DISTINCT gp.user_id) as count
       FROM game_sessions gs
       JOIN game_players gp ON gs.id = gp.session_id
       WHERE gs.started_at >= ? AND gs.started_at <= ?
       GROUP BY DATE(gs.started_at)
       ORDER BY date`,
      [start, end]
    ),
    db.queryAll(
      `SELECT DATE(started_at) as date, COUNT(*) as count
       FROM game_sessions
       WHERE started_at >= ? AND started_at <= ?
       GROUP BY DATE(started_at)
       ORDER BY date`,
      [start, end]
    ),
    db.queryAll(
      `SELECT DATE(created_at) as date, COALESCE(SUM(amount), 0) as amount
       FROM coin_records
       WHERE created_at >= ? AND created_at <= ? AND amount > 0
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [start, end]
    ),
  ]);
  return { dau, games, revenue };
}

async function getTopPlayers(limit = 50) {
  return db.queryAll('SELECT id, nick_name, avatar_url, level, total_income, total_exp, game_count, win_count, coins FROM users ORDER BY total_income DESC LIMIT ?', [String(limit)]);
}

module.exports = { getOverview, getTopPlayers };
