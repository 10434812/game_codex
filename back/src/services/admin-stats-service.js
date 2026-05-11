const db = require('../models/db');

async function getOverview(from, to) {
  const dau = await db.queryAll(`SELECT DATE(gs.started_at) as date, COUNT(DISTINCT gp.user_id) as dau FROM game_sessions gs JOIN game_players gp ON gs.id = gp.session_id WHERE gs.started_at >= ? AND gs.started_at <= ? GROUP BY DATE(gs.started_at) ORDER BY date`, [from || '1970-01-01', to || '2099-12-31']);
  return { dau };
}

async function getTopPlayers(limit = 50) {
  return db.queryAll('SELECT id, nick_name, avatar_url, level, total_income, total_exp, game_count, win_count, coins FROM users ORDER BY total_income DESC LIMIT ?', [String(limit)]);
}

module.exports = { getOverview, getTopPlayers };
