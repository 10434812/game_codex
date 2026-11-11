const db = require('../models/db');
const { mapRoom, mapRoomPlayer } = require('../utils/admin-presenters');

async function listRooms(status = '', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  let where = '';
  const params = [];

  if (status) {
    where = 'WHERE r.status = ?';
    params.push(status);
  }

  const total = await db.queryOne(
    `SELECT COUNT(*) as total FROM rooms r ${where}`,
    params
  );

  const records = await db.queryAll(
    `SELECT r.*, u.nick_name as host_name, u.avatar_url as host_avatar,
            (SELECT COUNT(*) FROM room_players WHERE room_id = r.id) as player_count
     FROM rooms r
     LEFT JOIN users u ON r.host_user_id = u.id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, String(limit), String(offset)]
  );

  return { records: records.map(mapRoom), total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getRoomDetail(roomId) {
  const room = await db.queryOne(
    `SELECT r.*, u.nick_name as host_name, u.avatar_url as host_avatar
     FROM rooms r
     LEFT JOIN users u ON r.host_user_id = u.id
     WHERE r.id = ?`,
    [roomId]
  );

  if (!room) return null;

  const players = await db.queryAll(
    `SELECT rp.*, u.nick_name, u.avatar_url
     FROM room_players rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.room_id = ?
     ORDER BY rp.seat ASC`,
    [roomId]
  );

  return {
    ...mapRoom(room),
    players: players.map(mapRoomPlayer),
  };
}

/**
 * Force close a room. This not only flips the rooms row: if the room has a
 * playing game session, the in-memory game is truly terminated via
 * gameService.forceFinishSession (tick loop stopped, end event broadcast,
 * DB session/players written back, rewards settled by elapsed time or rolled
 * back). See report: 强制关闭房间之前只改 rooms 表，内存对局继续跑完并发币。
 *
 * @param {number} roomId
 * @param {object} [options]
 * @param {object} [options.realtime] - arenaRealtime hub for broadcasting
 * @param {boolean} [options.settle=true] - settle rewards or roll back
 * @returns {Promise<{closed: boolean, sessionId: number|null, aborted: boolean}>}
 */
async function forceCloseRoom(roomId, options = {}) {
  const gameService = require('./game-service');
  const realtime = options.realtime || null;

  const session = await db.queryOne(
    "SELECT id FROM game_sessions WHERE room_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
    [roomId]
  );

  let sessionResult = null;
  if (session) {
    try {
      sessionResult = await gameService.forceFinishSession(session.id, realtime, {
        settle: options.settle !== false,
        reason: '管理员强制关闭房间',
      });
    } catch (err) {
      console.error('[AdminRoom] forceFinishSession failed for session', session.id, err.message);
    }
  }

  await db.execute(
    "UPDATE rooms SET status = 'finished', finished_at = NOW() WHERE id = ?",
    [roomId]
  );

  return {
    closed: true,
    sessionId: session ? session.id : null,
    aborted: !!(sessionResult && sessionResult.aborted),
  };
}

async function getRoomStats() {
  const rows = await db.queryAll(
    `SELECT status, COUNT(*) as count FROM rooms GROUP BY status`
  );

  const stats = { waiting: 0, playing: 0, finished: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  stats.total = stats.waiting + stats.playing + stats.finished;

  return stats;
}

module.exports = { listRooms, getRoomDetail, forceCloseRoom, getRoomStats };
