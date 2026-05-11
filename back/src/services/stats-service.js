const db = require('../models/db');

/**
 * Get player summary stats.
 *
 * @param {number} userId
 * @returns {Promise<{ totalIncome: number, totalExp: number, gameCount: number, winCount: number, level: number, recordCount: number }>}
 */
async function getSummary(userId) {
  const user = await db.queryOne(
    `SELECT total_income, total_exp, game_count, win_count, level
     FROM users WHERE id = ?`,
    [userId]
  );

  if (!user) {
    return null;
  }

  const [{ recordCount }] = await db.execute(
    'SELECT COUNT(*) AS recordCount FROM game_players WHERE user_id = ?',
    [userId]
  );

  return {
    totalIncome: user.total_income,
    totalExp: user.total_exp,
    gameCount: user.game_count,
    winCount: user.win_count,
    level: user.level,
    recordCount,
  };
}

/**
 * Get user's game history with pagination.
 *
 * @param {number} userId
 * @param {number} page
 * @param {number} limit
 * @returns {Promise<{ records: Array, page: number, limit: number, total: number }>}
 */
async function getHistory(userId, page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * pageSize;

  const [[{ total }]] = await db.execute(
    `SELECT COUNT(*) AS total
     FROM game_players gp
     INNER JOIN game_sessions gs ON gp.session_id = gs.id
     WHERE gp.user_id = ?`,
    [userId]
  );

  const records = await db.queryAll(
    `SELECT
       gp.session_id AS sessionId,
       gp.seat,
       gp.team_id AS teamId,
       gp.initial_score AS initialScore,
       gp.final_score AS finalScore,
       gp.rank,
       gp.coins_earned AS coinsEarned,
       gs.stage_id AS stageId,
       gs.duration,
       gs.started_at AS startedAt,
       gs.finished_at AS finishedAt
     FROM game_players gp
     INNER JOIN game_sessions gs ON gp.session_id = gs.id
     WHERE gp.user_id = ?
     ORDER BY gs.started_at DESC
     LIMIT ? OFFSET ?`,
    [userId, pageSize, offset]
  );

  return { records, page: pageNum, limit: pageSize, total };
}

/**
 * Get global leaderboard.
 *
 * @param {string} type - 'income', 'exp', or 'games'
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function getLeaderboard(type = 'income', limit = 50) {
  const maxLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  let orderBy;
  switch (type) {
    case 'exp':
      orderBy = 'total_exp DESC';
      break;
    case 'games':
      orderBy = 'game_count DESC';
      break;
    case 'income':
    default:
      orderBy = 'total_income DESC';
      break;
  }

  const players = await db.queryAll(
    `SELECT
       id,
       nick_name AS nickName,
       avatar_url AS avatarUrl,
       level,
       total_income AS totalIncome,
       total_exp AS totalExp,
       game_count AS gameCount,
       win_count AS winCount
     FROM users
     WHERE is_banned = 0
     ORDER BY ${orderBy}
     LIMIT ?`,
    [maxLimit]
  );

  return players;
}

module.exports = { getSummary, getHistory, getLeaderboard };
