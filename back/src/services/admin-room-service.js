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

async function forceCloseRoom(roomId) {
  await db.execute(
    "UPDATE rooms SET status = 'finished', finished_at = NOW() WHERE id = ?",
    [roomId]
  );
  return { closed: true };
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
