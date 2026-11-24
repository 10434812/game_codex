const db = require('../models/db');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolve the query date range. When `limit` is given (and no explicit
 * from/to), the range is exactly the last `limit` calendar days ending today
 * (true "近 N 日"), so the Dashboard no longer plots all history.
 */
function resolveRange(from, to, limit) {
  if (from || to) {
    return { start: from || '1970-01-01', end: to ? `${to} 23:59:59` : '2099-12-31 23:59:59' };
  }
  const days = Math.min(Math.max(Number(limit) || 7, 1), 366);
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1));
  return {
    start: formatDate(startDate),
    end: `${formatDate(endDate)} 23:59:59`,
    dateKeys: Array.from({ length: days }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      return formatDate(date);
    }),
  };
}

/** Normalize mysql2 dates and aggregates before returning or filling a series. */
function dailySeries(rows, field, dateKeys) {
  if (!dateKeys) {
    return rows.map((row) => ({ date: dateKey(row.date), [field]: Number(row[field]) }));
  }
  const values = new Map(rows.map((row) => [dateKey(row.date), Number(row[field])]));
  return dateKeys.map((date) => ({ date, [field]: values.get(date) ?? 0 }));
}

function dateKey(date) {
  return date instanceof Date ? formatDate(date) : date;
}

async function getOverview(from, to, limit) {
  const range = resolveRange(from, to, limit);
  const { start, end, dateKeys } = range;
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
  return {
    dau: dailySeries(dau, 'count', dateKeys),
    games: dailySeries(games, 'count', dateKeys),
    revenue: dailySeries(revenue, 'amount', dateKeys),
  };
}

async function getTopPlayers(limit = 50) {
  return db.queryAll('SELECT id, nick_name, avatar_url, level, total_income, total_exp, game_count, win_count, coins FROM users WHERE deleted_at IS NULL ORDER BY total_income DESC LIMIT ?', [String(limit)]);
}

module.exports = { getOverview, getTopPlayers };
