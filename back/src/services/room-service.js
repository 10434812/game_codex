const db = require('../models/db');

// ─── Game Constants ───────────────────────────────────────
const {MIN_PLAYERS, MAX_PLAYERS, GAME_DURATION_SECONDS, INITIAL_SCORE_RANGE} = require('../game-engine/constants');

// ─── Helpers ──────────────────────────────────────────────
// Every membership-creating transaction takes account locks before room locks.
// This serializes against account deletion, including already-authenticated requests.
async function lockActiveUser(connection, userId) {
  const [rows] = await connection.execute(
    'SELECT id, deleted_at, is_banned FROM users WHERE id = ? FOR UPDATE', [userId]
  );
  const user = rows[0];
  if (!user || user.deleted_at || user.is_banned) {
    throw Object.assign(new Error('账号不可用，无法加入或开始对局'), {statusCode: 403});
  }
}

/**
 * Generate a random 4-digit room code (1000-9999).
 * @returns {string}
 */
function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Find a 4-digit room code that is not held by an active room.
 * Finished rooms can have their code archived (`F<id>`) so the 9,000-code
 * space is never permanently exhausted over the lifetime of the database.
 * @returns {Promise<{ code: string, reclaimRoomId: number | null }>}
 */
async function generateUniqueRoomCode() {
  let attempts = 0;
  while (attempts < 40) {
    attempts++;
    const code = generateRoomCode();
    const existing = await db.queryOne(
      'SELECT id, status FROM rooms WHERE room_code = ?',
      [code]
    );
    if (!existing) {
      return { code, reclaimRoomId: null };
    }
    if (existing.status === 'finished') {
      return { code, reclaimRoomId: existing.id };
    }
  }
  throw Object.assign(new Error('暂时无法分配房间码，请稍后重试'), { statusCode: 503 });
}

/**
 * Random integer between min and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Room Service ─────────────────────────────────────────

/**
 * Create a new room and add the host as the first player.
 * Uses a database transaction for atomicity and retries on room_code collisions.
 *
 * @param {number} userId - Host user ID
 * @param {number} stageId - Stage/scenic spot ID
 * @returns {Promise<Object>} { room, players[] }
 */
async function createRoom(userId, stageId, options = {}) {
  const maxRetries = 5;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { code: roomCode, reclaimRoomId } = await generateUniqueRoomCode();

    const connection = await db.pool.getConnection();
    try {
      await connection.beginTransaction();
      await lockActiveUser(connection, userId);

      if (reclaimRoomId) {
        await connection.execute(
          "UPDATE rooms SET room_code = CONCAT('F', id) WHERE id = ? AND status = 'finished'",
          [reclaimRoomId]
        );
      }

      // Insert the room
      const [roomResult] = await connection.execute(
        `INSERT INTO rooms (room_code, stage_id, status, host_user_id, max_players, current_players)
         VALUES (?, ?, 'waiting', ?, ?, 1)`,
        [roomCode, stageId, userId, MAX_PLAYERS]
      );
      const roomId = roomResult.insertId;
      if (options.matchmaking) await connection.execute('UPDATE rooms SET max_players = 4, match_due_at = DATE_ADD(NOW(), INTERVAL 8 SECOND) WHERE id = ?', [roomId]);

      // Insert host as first player (seat=1)
      await connection.execute(
        `INSERT INTO room_players (room_id, user_id, seat, is_ready, is_host)
         VALUES (?, ?, 1, 1, 1)`,
        [roomId, userId]
      );
      if (options.challenge) await assignChallenge(connection, roomId, userId, options.challenge);

      await connection.commit();

      // Fetch the created room and player list
      return getRoom(roomId, userId);
    } catch (err) {
      await connection.rollback();
      if (err && err.code === 'ER_DUP_ENTRY' && attempt < maxRetries) {
        continue;
      }
      throw err;
    } finally {
      connection.release();
    }
  }
}

/**
 * Get a room by ID, including its player list with user info.
 *
 * @param {number} roomId
 * @returns {Promise<Object>} { room, players[] }
 */
async function getRoom(roomId, viewerUserId) {
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);

  if (!room) {
    return null;
  }

  const players = await getPlayers(roomId, viewerUserId);
  if (room.status === 'waiting' && players.some((p) => Number(p.user_id) === Number(viewerUserId))) {
    await db.execute("UPDATE rooms SET last_active_at = NOW() WHERE id = ? AND status = 'waiting' AND last_active_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)", [roomId]);
  }
  let sessionId = null;

  if (room.status === 'playing' || room.status === 'finished') {
    const session = await db.queryOne(
      'SELECT id FROM game_sessions WHERE room_id = ? ORDER BY id DESC LIMIT 1',
      [roomId]
    );
    sessionId = session ? session.id : null;
  }

  return { room, players, sessionId };
}

async function getRoomByCode(roomCode, viewerUserId) {
  const normalizedCode = String(roomCode || '').trim();
  if (!normalizedCode) {
    return null;
  }
  const room = await db.queryOne('SELECT id FROM rooms WHERE room_code = ?', [normalizedCode]);
  if (!room) {
    return null;
  }
  return getRoom(room.id, viewerUserId);
}

/**
 * List all available (waiting) rooms with player counts.
 *
 * @returns {Promise<Array>}
 */
async function listAvailableRooms(userId) {
  if (!userId) return [];
  const rooms = await db.queryAll(
    `SELECT r.*, (SELECT COUNT(*) FROM room_players rp2 WHERE rp2.room_id = r.id) AS player_count
       FROM rooms r
       INNER JOIN room_players rp ON rp.room_id = r.id AND rp.user_id = ?
      WHERE r.status = 'waiting'
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [userId]
  );

  return rooms.map((room) => ({
    ...room,
    player_count: Number(room.player_count) || 0,
  }));
}

/**
 * Join a room. Validates room exists, is waiting, not full, and user not already in.
 *
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<Object>} { room, players[] }
 */
async function joinRoom(roomId, userId, {challenge, allowMatchmaking = false} = {}) {
  // Validate room exists and is waiting
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) {
    throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  }
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockActiveUser(connection, userId);
    const [lockedRooms] = await connection.execute('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [roomId]);
    const lockedRoom = lockedRooms[0];
    if (!lockedRoom) throw Object.assign(new Error('房间不存在'), {statusCode: 404});
    if (challenge && (!lockedRoom.match_due_at || lockedRoom.status !== 'waiting' || Number(lockedRoom.stage_id) !== challenge.stageId)) {
      throw Object.assign(new Error('请离开当前房间，再开始好友挑战'), {statusCode: 409});
    }
    const [members] = await connection.execute(
      'SELECT id FROM room_players WHERE room_id = ? AND user_id = ? FOR UPDATE', [roomId, userId]
    );
    if (members.length) {
      if (challenge) await assignChallenge(connection, roomId, userId, challenge);
      await connection.commit();
      return getRoom(roomId, userId);
    }
    if (!allowMatchmaking && lockedRoom.match_due_at) {
      throw Object.assign(new Error('匹配房间不支持直接加入'), {statusCode: 403});
    }
    if (lockedRoom.status !== 'waiting') throw Object.assign(new Error('游戏已开始，无法加入'), {statusCode: 400});

    // Atomically claim a seat slot: the conditional UPDATE locks the room row
    // and only succeeds while the room is still waiting and not full, closing
    // the concurrent-join overfill race. If it affects 0 rows the pre-checks
    // above were stale and this join must fail.
    const [claimResult] = await connection.execute(
      'UPDATE rooms SET current_players = current_players + 1 WHERE id = ? AND status = ? AND current_players < max_players',
      [roomId, 'waiting']
    );
    if (!claimResult || claimResult.affectedRows !== 1) {
      await connection.rollback();
      throw Object.assign(new Error('房间已满或游戏已开始'), { statusCode: 400 });
    }

    // Find next available seat (find the highest seat + 1).
    // The room row is locked by the UPDATE above, so concurrent joins are
    // serialized and cannot compute the same seat.
    const seatResult = await connection.execute(
      'SELECT MAX(seat) as max_seat FROM room_players WHERE room_id = ?',
      [roomId]
    );
    const nextSeat = (seatResult[0][0].max_seat || 0) + 1;

    // Insert the player
    await connection.execute(
      // 被邀请/匹配加入的玩家默认已准备，可在房间内手动取消。
      'INSERT INTO room_players (room_id, user_id, seat, is_ready, is_host) VALUES (?, ?, ?, 1, 0)',
      [roomId, userId, nextSeat]
    );
    if (challenge) await assignChallenge(connection, roomId, userId, challenge);

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return getRoom(roomId, userId);
}

function assignChallenge(connection, roomId, userId, challenge) {
  return connection.execute(
    'UPDATE room_players SET challenge_source_session_id = ?, challenge_source_user_id = ? WHERE room_id = ? AND user_id = ?',
    [challenge.sessionId, challenge.userId, roomId, userId]
  );
}

async function joinRoomByCode(roomCode, userId) {
  const room = await db.queryOne('SELECT id FROM rooms WHERE room_code = ?', [String(roomCode || '').trim()]);
  if (!room) {
    throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  }
  return joinRoom(room.id, userId);
}

/**
 * Leave a room. If the leaving user is host, reassign host or delete the room.
 *
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<Object>} Result with updated state
 */
async function leaveRoom(roomId, userId) {
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock the room row first (same order as joinRoom/startGame: rooms before
    // room_players). This serializes with joins and keeps the member count
    // consistent, and prevents an InnoDB deadlock with startGame.
    const [roomRows] = await connection.execute(
      'SELECT * FROM rooms WHERE id = ? FOR UPDATE',
      [roomId]
    );
    const room = roomRows[0];
    if (!room) {
      throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
    }
    if (room.status === 'playing') {
      throw Object.assign(new Error('对局进行中无法离开房间'), { statusCode: 400 });
    }

    const [playerRows] = await connection.execute(
      'SELECT * FROM room_players WHERE room_id = ? AND user_id = ? FOR UPDATE',
      [roomId, userId]
    );
    const player = playerRows[0];
    if (!player) {
      throw Object.assign(new Error('你不在该房间中'), { statusCode: 400 });
    }

    const isHost = player.is_host === 1;

    // Remove the player
    await connection.execute(
      'DELETE FROM room_players WHERE room_id = ? AND user_id = ?',
      [roomId, userId]
    );

    // Get remaining player count after deletion
    const countResult = await connection.execute(
      'SELECT COUNT(*) as count FROM room_players WHERE room_id = ?',
      [roomId]
    );
    const remainingCount = countResult[0][0].count;

    if (remainingCount === 0) {
      // No players left — delete the room entirely
      await connection.execute('DELETE FROM rooms WHERE id = ?', [roomId]);
      await connection.commit();
      return { roomId, removed: true, remainingCount: 0 };
    }

    // Update current_players
    await connection.execute(
      'UPDATE rooms SET current_players = ? WHERE id = ?',
      [remainingCount, roomId]
    );

    // If the leaving user was host, assign a new host (oldest remaining player)
    if (isHost) {
      const oldest = await connection.execute(
        'SELECT user_id FROM room_players WHERE room_id = ? ORDER BY joined_at ASC LIMIT 1',
        [roomId]
      );
      const newHostUserId = oldest[0][0].user_id;

      await connection.execute(
        'UPDATE room_players SET is_host = 1, is_ready = 1 WHERE room_id = ? AND user_id = ?',
        [roomId, newHostUserId]
      );

      await connection.execute(
        'UPDATE rooms SET host_user_id = ? WHERE id = ?',
        [newHostUserId, roomId]
      );
    }

    await connection.commit();

    // Return updated room state
    const updated = await getRoom(roomId, userId);
    return { roomId, removed: false, ...updated };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Toggle the ready status of a player in a room.
 *
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<Object>} { room, players[] }
 */
async function toggleReady(roomId, userId) {
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    await lockActiveUser(connection, userId);
    const [[room]] = await connection.execute('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [roomId]);
    if (!room) throw Object.assign(new Error('房间不存在'), {statusCode: 404});
    if (room.status !== 'waiting') throw Object.assign(new Error('游戏已开始，无法操作'), {statusCode: 409});
    if (room.match_due_at) throw Object.assign(new Error('匹配会自动开始，取消匹配请离开房间'), {statusCode: 409});
    const [[player]] = await connection.execute(
      'SELECT * FROM room_players WHERE room_id = ? AND user_id = ? FOR UPDATE', [roomId, userId]
    );
    if (!player) throw Object.assign(new Error('你不在该房间中'), {statusCode: 403});
    await connection.execute('UPDATE room_players SET is_ready = ? WHERE room_id = ? AND user_id = ?',
      [player.is_ready ? 0 : 1, roomId, userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {connection.release();}
  return getRoom(roomId, userId);
}

/** 原场次成员主动续玩；重开只清空一次准备状态，重试不会取消已确认玩家的准备。 */
async function rematch(sessionId, userId) {
  const connection = await db.pool.getConnection();
  let roomId;
  try {
    await connection.beginTransaction();
    await lockActiveUser(connection, userId);
    const [[session]] = await connection.execute(
      'SELECT gs.id, gs.room_id, gs.status FROM game_sessions gs JOIN game_players gp ON gp.session_id = gs.id WHERE gs.id = ? AND gp.user_id = ?',
      [sessionId, userId]
    );
    if (!session) throw Object.assign(new Error('对局不存在'), {statusCode: 404});
    if (session.status !== 'finished') throw Object.assign(new Error('结算尚未完成，请稍后重试'), {statusCode: 409});
    roomId = session.room_id;
    const [[room]] = await connection.execute('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [roomId]);
    if (!room) throw Object.assign(new Error('原房间已解散，可以新建好友房'), {statusCode: 410});
    if (!['waiting', 'finished'].includes(room.status)) {
      throw Object.assign(new Error('原房间已进入新的对局，请从首页返回当前对局'), {statusCode: 409});
    }
    const [[member]] = await connection.execute(
      'SELECT * FROM room_players WHERE room_id = ? AND user_id = ? FOR UPDATE', [roomId, userId]
    );
    if (!member) throw Object.assign(new Error('你已离开原房间，可以新建好友房'), {statusCode: 410});
    const [[latest]] = await connection.execute(
      'SELECT id FROM game_sessions WHERE room_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [roomId]
    );
    if (Number(latest?.id) !== Number(sessionId)) {
      throw Object.assign(new Error('原房间已进入新的对局，请从首页返回当前对局'), {statusCode: 409});
    }
    if (room.status === 'finished') {
      await connection.execute("UPDATE rooms SET status = 'waiting', finished_at = NULL, last_active_at = NOW(), match_due_at = NULL WHERE id = ?", [roomId]);
      await connection.execute('UPDATE room_players SET is_ready = 0 WHERE room_id = ?', [roomId]);
    }
    await connection.execute('UPDATE room_players SET is_ready = 1 WHERE room_id = ? AND user_id = ?', [roomId, userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {connection.release();}
  return getRoom(roomId, userId);
}

/**
 * Start the game. Host-only, requires minimum players.
 * Creates a game_session and game_players records.
 *
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<Object>} { roomId, sessionId, players[] }
 */
async function startGame(roomId, userId) {
  // Candidates only determine account lock order; never use this snapshot to
  // create game_players. A join/leave before the room lock causes a safe retry.
  const candidates = await db.queryAll('SELECT user_id FROM room_players WHERE room_id = ? ORDER BY user_id', [roomId]);
  const candidateIds = [...new Set([...candidates.map((player) => Number(player.user_id)), Number(userId)])].sort((a, b) => a - b);

  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const id of candidateIds) await lockActiveUser(connection, id);
    const [rooms] = await connection.execute('SELECT * FROM rooms WHERE id = ? FOR UPDATE', [roomId]);
    const room = rooms[0];
    if (!room) throw Object.assign(new Error('房间不存在'), {statusCode: 404});
    if (room.status !== 'waiting') throw Object.assign(new Error('游戏已开始'), {statusCode: 400});
    if (room.match_due_at) {
      const [[due]] = await connection.execute('SELECT (match_due_at <= NOW() OR current_players >= 4) AS ready FROM rooms WHERE id = ?', [roomId]);
      if (!due.ready) throw Object.assign(new Error('正在匹配真人，请稍候或取消匹配'), {statusCode: 409});
    }
    if (Number(room.host_user_id) !== Number(userId)) throw Object.assign(new Error('仅房主可以开始游戏'), {statusCode: 403});
    const [roomPlayers] = await connection.execute(
      'SELECT * FROM room_players WHERE room_id = ? ORDER BY user_id FOR UPDATE', [roomId]
    );
    const currentIds = roomPlayers.map((player) => Number(player.user_id)).sort((a, b) => a - b);
    if (!currentIds.includes(Number(userId))) throw Object.assign(new Error('房主已不在房间内'), {statusCode: 403});
    if (currentIds.length !== candidateIds.length || currentIds.some((id, index) => id !== candidateIds[index])) {
      throw Object.assign(new Error('房间成员已变化，请重试开始游戏'), {statusCode: 409});
    }
    if (roomPlayers.some((player) => !player.is_host && !player.is_ready)) {
      throw Object.assign(new Error('请等待所有玩家准备后开始'), {statusCode: 409});
    }

    // Atomically claim the room for this game: only succeeds while the room
    // is still 'waiting', so two concurrent start requests (double-tap) can
    // never both create a game_session / tick loop for the same room.
    const [statusResult] = await connection.execute(
      "UPDATE rooms SET status = 'playing' WHERE id = ? AND status = 'waiting'",
      [roomId]
    );
    if (!statusResult || statusResult.affectedRows !== 1) {
      await connection.rollback();
      throw Object.assign(new Error('游戏已开始'), { statusCode: 400 });
    }

    // Create game session
    const [sessionResult] = await connection.execute(
      `INSERT INTO game_sessions (room_id, stage_id, status, duration, round_count)
       VALUES (?, ?, 'playing', ?, 0)`,
      [roomId, room.stage_id, GAME_DURATION_SECONDS]
    );
    const sessionId = sessionResult.insertId;

    // Create game_players for each room player
    for (const rp of roomPlayers) {
      const initialScore = randomInt(
        INITIAL_SCORE_RANGE.min,
        INITIAL_SCORE_RANGE.max
      );
      await connection.execute(
        `INSERT INTO game_players (session_id, user_id, seat, team_id, initial_score, final_score, \`rank\`, coins_earned)
         VALUES (?, ?, ?, NULL, ?, 0, NULL, 0)`,
        [sessionId, rp.user_id, rp.seat, initialScore]
      );
      if (room.match_due_at && rp.challenge_source_session_id) {
        await connection.execute(
          'UPDATE game_players SET challenge_source_session_id = ?, challenge_source_user_id = ? WHERE session_id = ? AND user_id = ?',
          [rp.challenge_source_session_id, rp.challenge_source_user_id, sessionId, rp.user_id]
        );
      }
    }

    await connection.commit();

    // Fetch the created game players
    const gamePlayers = await db.queryAll(
      'SELECT * FROM game_players WHERE session_id = ? ORDER BY seat ASC',
      [sessionId]
    );

    return { roomId, sessionId, players: gamePlayers };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Get all players in a room with their user profile info.
 *
 * @param {number} roomId
 * @returns {Promise<Array>}
 */
async function getPlayers(roomId, viewerUserId) {
  const sql = `
    SELECT rp.id, rp.room_id, rp.user_id, rp.seat, rp.is_ready, rp.is_host, rp.joined_at, u.nick_name, u.avatar_url,
           CASE WHEN rp.user_id = ? THEN 1 ELSE 0 END AS is_self
    FROM room_players rp
    JOIN users u ON u.id = rp.user_id
    WHERE rp.room_id = ?
    ORDER BY rp.seat ASC
  `;
  return db.queryAll(sql, [Number(viewerUserId) || 0, roomId]);
}

// Close rather than delete: game history and room membership remain auditable.
async function cleanupStaleRooms() {
  const [result] = await db.execute("UPDATE rooms SET status = 'finished', finished_at = NOW() WHERE status = 'waiting' AND last_active_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)", [30]);
  return result.affectedRows;
}

module.exports = {
  cleanupStaleRooms,
  createRoom,
  getRoom,
  getRoomByCode,
  listAvailableRooms,
  joinRoom,
  joinRoomByCode,
  leaveRoom,
  toggleReady,
  rematch,
  startGame,
  getPlayers,
  generateRoomCode,
  MIN_PLAYERS,
  MAX_PLAYERS,
};
