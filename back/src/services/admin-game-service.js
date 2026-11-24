const db = require('../models/db');
const { getActiveGame } = require('./game-service');
const { mapGamePlayer, mapGameSession, mapRound } = require('../utils/admin-presenters');

// A room created for quick matching can later host a friend-style rematch.
// Archived results capture the mode of that particular session.
const modeSql = `CASE
  WHEN JSON_TYPE(JSON_EXTRACT(gr.result_json, '$.matchmaking')) = 'BOOLEAN'
    THEN IF(JSON_UNQUOTE(JSON_EXTRACT(gr.result_json, '$.matchmaking')) = 'true', 'quick', 'friends')
  WHEN gs.status = 'playing' AND r.status = 'playing'
    THEN IF(r.match_due_at IS NOT NULL, 'quick', 'friends')
  WHEN r.max_players > 4 THEN 'friends'
  ELSE 'unknown'
END`;

const gameTables = `FROM game_sessions gs
  LEFT JOIN rooms r ON gs.room_id = r.id
  LEFT JOIN game_results gr ON gs.id = gr.session_id`;
const countPlayers = '(SELECT COUNT(*) FROM game_players WHERE session_id = gs.id) AS player_count';

async function listGames(status = '', page = 1, limit = 20, mode = '') {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('gs.status = ?');
    params.push(status);
  }
  if (mode) {
    conditions.push(`(${modeSql}) = ?`);
    params.push(mode);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [total, records] = await Promise.all([
    db.queryOne(`SELECT COUNT(*) AS total ${gameTables} ${where}`, params),
    db.queryAll(
      `SELECT gs.*, r.room_code, ${modeSql} AS mode, ${countPlayers}
       ${gameTables} ${where}
       ORDER BY gs.started_at DESC, gs.id DESC
       LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    ),
  ]);

  return { records: records.map(mapGameSession), total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

function readResult(raw) {
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch (_error) {
    return null;
  }
}

function getPlayerDetails(rows, roster, settlementStatus) {
  const rosterById = new Map(roster.map((player) => [String(player.id), player]));
  const settled = settlementStatus === 'settled';
  const players = rows.map((row) => {
    const player = mapGamePlayer(row);
    const observed = rosterById.get(String(player.uid));
    return {
      ...player,
      nickname: observed?.name || player.nickname,
      teamId: observed?.teamId || (settled ? player.teamId : ''),
      score: settled ? player.score : observed?.score ?? null,
      rank: settled ? player.rank ?? observed?.rank ?? null : null,
      coinsEarned: settled || settlementStatus === 'interrupted' ? player.coinsEarned : null,
    };
  });
  for (const player of roster) {
    if (player.isRobot !== true && !String(player.id).startsWith('robot-')) continue;
    players.push({
      uid: null,
      nickname: player.name || '机器人',
      avatarUrl: player.avatar || '',
      teamId: player.teamId || '',
      score: player.score ?? null,
      rank: settled ? player.rank ?? null : null,
      seat: player.seat,
      coinsEarned: null,
      isBot: true,
    });
  }
  return players.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.seat - b.seat);
}

async function getGameDetail(sessionId) {
  const row = await db.queryOne(
    `SELECT gs.*, r.room_code, ${modeSql} AS mode, ${countPlayers},
            gr.id AS result_id, gr.created_at AS result_created_at, gr.result_json
     ${gameTables}
     WHERE gs.id = ?`,
    [sessionId]
  );
  if (!row) return null;

  const { result_id, result_created_at, result_json, ...sessionRow } = row;
  const payload = readResult(result_json);
  const active = row.status === 'playing' ? getActiveGame(sessionId) : null;
  let status = 'unrecorded';
  if (row.status === 'playing') status = active?.awaitingStartIds?.length ? 'awaiting_start' : 'pending';
  else if (payload) status = payload.interrupted ? 'interrupted' : 'settled';

  const roster = active?.players || (status === 'settled' && Array.isArray(payload.ranking) ? payload.ranking : []);
  const [playerRows, rounds] = await Promise.all([
    db.queryAll(
      'SELECT gp.*, u.nick_name, u.avatar_url FROM game_players gp LEFT JOIN users u ON gp.user_id = u.id WHERE gp.session_id = ? ORDER BY gp.seat',
      [sessionId]
    ),
    db.queryAll('SELECT * FROM game_rounds WHERE session_id = ? ORDER BY round_num ASC', [sessionId]),
  ]);
  const players = getPlayerDetails(playerRows, roster, status);
  const hasBotRoster = Boolean(active || (status === 'settled' && Array.isArray(payload.ranking) && payload.ranking.length));
  return {
    session: mapGameSession(sessionRow),
    players,
    rounds: rounds.map(mapRound),
    result: result_id ? { id: result_id, session_id: row.id, result_json, created_at: result_created_at } : null,
    settlement: {
      status,
      reason: status === 'interrupted' ? payload.reason || '' : '',
      humanCount: playerRows.length,
      botCount: hasBotRoster ? players.length - playerRows.length : null,
      totalCoins: status === 'settled' ? players.reduce((sum, player) => sum + (player.coinsEarned || 0), 0)
        : status === 'interrupted' ? 0 : null,
    },
  };
}

module.exports = { listGames, getGameDetail };
