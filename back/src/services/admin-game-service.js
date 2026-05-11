const db = require('../models/db');

async function listGames(status = '', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  let where = '';
  let params = [];
  if (status) { where = 'WHERE gs.status = ?'; params.push(status); }
  const total = await db.queryOne(`SELECT COUNT(*) as total FROM game_sessions gs ${where}`, params);
  const records = await db.queryAll(`SELECT gs.*, r.room_code, (SELECT COUNT(*) FROM game_players WHERE session_id = gs.id) as player_count FROM game_sessions gs LEFT JOIN rooms r ON gs.room_id = r.id ${where} ORDER BY gs.started_at DESC LIMIT ? OFFSET ?`, [...params, String(limit), String(offset)]);
  return { records, total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getGameDetail(sessionId) {
  const session = await db.queryOne('SELECT * FROM game_sessions WHERE id = ?', [sessionId]);
  const players = await db.queryAll('SELECT gp.*, u.nick_name, u.avatar_url FROM game_players gp JOIN users u ON gp.user_id = u.id WHERE gp.session_id = ? ORDER BY gp.rank ASC', [sessionId]);
  const rounds = await db.queryAll('SELECT * FROM game_rounds WHERE session_id = ? ORDER BY round_num ASC', [sessionId]);
  const result = await db.queryOne('SELECT * FROM game_results WHERE session_id = ?', [sessionId]);
  return { session, players, rounds, result };
}

module.exports = { listGames, getGameDetail };
