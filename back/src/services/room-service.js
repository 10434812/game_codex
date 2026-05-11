const db = require('../models/db');

// ─── Game Constants ───────────────────────────────────────
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const GAME_DURATION_SECONDS = 180;
const INITIAL_SCORE_RANGE = { min: 80, max: 220 };

// ─── Helpers ──────────────────────────────────────────────

/**
 * Generate a random 4-digit room code (1000-9999).
 * @returns {string}
 */
function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Check if a room code is unique (not already in use for active rooms).
 * Only checks rooms not in 'finished' status.
 * @param {string} code
 * @returns {Promise<boolean>}
 */
async function isCodeUnique(code) {
  const existing = await db.queryOne(
    "SELECT id FROM rooms WHERE room_code = ? AND status != 'finished'",
    [code]
  );
  return !existing;
}

/**
 * Generate a guaranteed-unique room code.
 * @returns {Promise<string>}
 */
async function generateUniqueRoomCode() {
  let code;
  let attempts = 0;
  do {
    code = generateRoomCode();
    attempts++;
    if (attempts > 20) {
      throw new Error('Unable to generate unique room code');
    }
  } while (!(await isCodeUnique(code)));
  return code;
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
 * Uses a database transaction for atomicity.
 *
 * @param {number} userId - Host user ID
 * @param {number} stageId - Stage/scenic spot ID
 * @returns {Promise<Object>} { room, players[] }
 */
async function createRoom(userId, stageId) {
  const roomCode = await generateUniqueRoomCode();

  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();

    // Insert the room
    const [roomResult] = await connection.execute(
      `INSERT INTO rooms (room_code, stage_id, status, host_user_id, max_players, current_players)
       VALUES (?, ?, 'waiting', ?, ?, 1)`,
      [roomCode, stageId, userId, MAX_PLAYERS]
    );
    const roomId = roomResult.insertId;

    // Insert host as first player (seat=1)
    await connection.execute(
      `INSERT INTO room_players (room_id, user_id, seat, is_ready, is_host)
       VALUES (?, ?, 1, 1, 1)`,
      [roomId, userId]
    );

    await connection.commit();

    // Fetch the created room and player list
    return getRoom(roomId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/**
 * Get a room by ID, including its player list with user info.
 *
 * @param {number} roomId
 * @returns {Promise<Object>} { room, players[] }
 */
async function getRoom(roomId) {
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);

  if (!room) {
    return null;
  }

  const players = await getPlayers(roomId);

  return { room, players };
}

/**
 * List all available (waiting) rooms with player counts.
 *
 * @returns {Promise<Array>}
 */
async function listAvailableRooms() {
  const rooms = await db.queryAll(
    "SELECT * FROM rooms WHERE status = 'waiting' ORDER BY created_at DESC"
  );

  // For each room, count the current players
  const result = [];
  for (const room of rooms) {
    const countResult = await db.queryOne(
      'SELECT COUNT(*) as count FROM room_players WHERE room_id = ?',
      [room.id]
    );
    result.push({
      ...room,
      player_count: countResult ? countResult.count : 0,
    });
  }

  return result;
}

/**
 * Join a room. Validates room exists, is waiting, not full, and user not already in.
 *
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<Object>} { room, players[] }
 */
async function joinRoom(roomId, userId) {
  // Validate room exists and is waiting
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) {
    throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  }
  if (room.status !== 'waiting') {
    throw Object.assign(new Error('游戏已开始，无法加入'), { statusCode: 400 });
  }
  if (room.current_players >= room.max_players) {
    throw Object.assign(new Error('房间已满'), { statusCode: 400 });
  }

  // Validate user not already in room
  const existing = await db.queryOne(
    'SELECT id FROM room_players WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  if (existing) {
    throw Object.assign(new Error('你已在房间中'), { statusCode: 400 });
  }

  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();

    // Find next available seat (find the highest seat + 1)
    const seatResult = await connection.execute(
      'SELECT MAX(seat) as max_seat FROM room_players WHERE room_id = ?',
      [roomId]
    );
    const nextSeat = (seatResult[0][0].max_seat || 0) + 1;

    // Insert the player
    await connection.execute(
      'INSERT INTO room_players (room_id, user_id, seat, is_ready, is_host) VALUES (?, ?, ?, 0, 0)',
      [roomId, userId, nextSeat]
    );

    // Update current_players count
    await connection.execute(
      'UPDATE rooms SET current_players = current_players + 1 WHERE id = ?',
      [roomId]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return getRoom(roomId);
}

/**
 * Leave a room. If the leaving user is host, reassign host or delete the room.
 *
 * @param {number} roomId
 * @param {number} userId
 * @returns {Promise<Object>} Result with updated state
 */
async function leaveRoom(roomId, userId) {
  // Validate room exists
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) {
    throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  }

  // Get the player record
  const player = await db.queryOne(
    'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  if (!player) {
    throw Object.assign(new Error('你不在该房间中'), { statusCode: 400 });
  }

  const isHost = player.is_host === 1;

  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();

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
    const updated = await getRoom(roomId);
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
  // Validate room exists
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) {
    throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  }
  if (room.status !== 'waiting') {
    throw Object.assign(new Error('游戏已开始，无法操作'), { statusCode: 400 });
  }

  // Get the player record
  const player = await db.queryOne(
    'SELECT * FROM room_players WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  if (!player) {
    throw Object.assign(new Error('你不在该房间中'), { statusCode: 400 });
  }

  // Toggle is_ready
  const newReady = player.is_ready === 1 ? 0 : 1;
  await db.execute(
    'UPDATE room_players SET is_ready = ? WHERE room_id = ? AND user_id = ?',
    [newReady, roomId, userId]
  );

  return getRoom(roomId);
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
  // Validate room exists and is waiting
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) {
    throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  }
  if (room.status !== 'waiting') {
    throw Object.assign(new Error('游戏已开始'), { statusCode: 400 });
  }
  if (room.host_user_id !== userId) {
    throw Object.assign(new Error('仅房主可以开始游戏'), { statusCode: 403 });
  }

  // Validate min players
  if (room.current_players < MIN_PLAYERS) {
    throw Object.assign(new Error(`至少需要${MIN_PLAYERS}名玩家才能开始`), {
      statusCode: 400,
    });
  }

  // Get all room players
  const roomPlayers = await getPlayers(roomId);

  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();

    // Update room status
    await connection.execute(
      "UPDATE rooms SET status = 'playing' WHERE id = ?",
      [roomId]
    );

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
        `INSERT INTO game_players (session_id, user_id, seat, team_id, initial_score, final_score, rank, coins_earned)
         VALUES (?, ?, ?, NULL, ?, 0, NULL, 0)`,
        [sessionId, rp.user_id, rp.seat, initialScore]
      );
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
async function getPlayers(roomId) {
  const sql = `
    SELECT rp.*, u.nick_name, u.avatar_url
    FROM room_players rp
    JOIN users u ON u.id = rp.user_id
    WHERE rp.room_id = ?
    ORDER BY rp.seat ASC
  `;
  return db.queryAll(sql, [roomId]);
}

module.exports = {
  createRoom,
  getRoom,
  listAvailableRooms,
  joinRoom,
  leaveRoom,
  toggleReady,
  startGame,
  getPlayers,
  generateRoomCode,
  MIN_PLAYERS,
  MAX_PLAYERS,
};
