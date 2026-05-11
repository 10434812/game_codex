const db = require('../models/db');
const engine = require('../game-engine/game-engine');
const { GAME_DURATION_SECONDS, INITIAL_SCORE_RANGE, MIN_PLAYERS } = require('../game-engine/constants');

// Active games: sessionId -> { timer, state }
const activeGames = new Map();

function getActiveGames() {
  return activeGames;
}

/**
 * Start a game session from a room. Creates DB records for the session
 * and players, pairs them into teams, and kicks off the tick loop.
 *
 * @param {number} roomId
 * @param {number} hostUserId
 * @param {object} [io] - Socket.IO server instance (required for tick loop)
 * @returns {Promise<{ sessionId: number, gameState: object }>}
 */
async function startGameSession(roomId, hostUserId, io) {
  // 1. Get room info
  const room = await db.queryOne('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) throw Object.assign(new Error('房间不存在'), { statusCode: 404 });
  if (room.status !== 'playing') throw Object.assign(new Error('游戏未开始'), { statusCode: 400 });

  // 2. Get room players
  const roomPlayers = await db.queryAll(
    'SELECT * FROM room_players WHERE room_id = ? ORDER BY seat ASC',
    [roomId]
  );
  if (roomPlayers.length < MIN_PLAYERS) throw new Error('Not enough players');

  // 3. Get user details (nick_name, avatar_url)
  const userIds = roomPlayers.map((p) => p.user_id);
  const userDetails = await db.queryAll(
    'SELECT id, nick_name, avatar_url FROM users WHERE id IN (?)',
    [userIds]
  );
  const userMap = Object.fromEntries(userDetails.map((u) => [u.id, u]));

  // 4. Create game_sessions record (if not already created by room-service)
  let sessionId;
  const existingSession = await db.queryOne(
    "SELECT id FROM game_sessions WHERE room_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
    [roomId]
  );
  if (existingSession) {
    sessionId = existingSession.id;
  } else {
    const [result] = await db.execute(
      'INSERT INTO game_sessions (room_id, stage_id, status, duration) VALUES (?, ?, ?, ?)',
      [roomId, room.stage_id, 'playing', GAME_DURATION_SECONDS]
    );
    sessionId = result.insertId;
  }

  // 5. Build engine players from room players
  const enginePlayers = roomPlayers.map((rp) => {
    const user = userMap[rp.user_id] || {};
    return {
      id: String(rp.user_id),
      name: user.nick_name || 'Player',
      avatar: user.avatar_url || '',
      isRobot: false,
      isSelf: rp.is_host ? true : false,
      seat: rp.seat,
      score: Math.floor(INITIAL_SCORE_RANGE.min + Math.random() * (INITIAL_SCORE_RANGE.max - INITIAL_SCORE_RANGE.min + 1)),
      teamId: null,
      ready: true,
      state: rp.is_host ? '房主·已准备' : '已就绪',
    };
  });

  // 6. Pair into teams using the engine
  const paired = engine.pairPlayers(enginePlayers);

  // 7. Insert game_players (if not already created by room-service)
  const existingGamePlayers = await db.queryAll(
    'SELECT user_id FROM game_players WHERE session_id = ?',
    [sessionId]
  );
  const existingUserIds = new Set(existingGamePlayers.map((p) => p.user_id));

  for (const p of paired.players) {
    if (!existingUserIds.has(Number(p.id))) {
      await db.execute(
        'INSERT INTO game_players (session_id, user_id, seat, team_id, initial_score, final_score) VALUES (?, ?, ?, ?, ?, ?)',
        [sessionId, Number(p.id), p.seat, p.teamId, p.score, p.score]
      );
    } else {
      await db.execute(
        'UPDATE game_players SET team_id = ? WHERE session_id = ? AND user_id = ?',
        [p.teamId, sessionId, Number(p.id)]
      );
    }
  }

  // 8. Initialize game state in memory
  const gameState = {
    sessionId,
    roomId,
    stageId: room.stage_id,
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    round: 0,
    status: 'playing',
    players: paired.players,
    teams: paired.teams,
    initialScores: Object.fromEntries(paired.players.map((p) => [p.id, p.score])),
    scoreLog: Object.fromEntries(paired.players.map((p) => [p.id, []])),
  };

  activeGames.set(sessionId, gameState);

  // 9. Start the tick loop
  if (io) {
    startTickLoop(sessionId, io);
  }

  return { sessionId, gameState };
}

/**
 * Start the per-second tick loop for an active game session.
 * @param {number} sessionId
 * @param {import('socket.io').Server} io
 */
function startTickLoop(sessionId, io) {
  const game = activeGames.get(sessionId);
  if (!game) return;

  if (game.timer) clearInterval(game.timer);

  game.timer = setInterval(async () => {
    try {
      await tick(game, io);
    } catch (err) {
      console.error(`[GameService] Tick error for session ${sessionId}:`, err);
    }
  }, 1000);
}

/**
 * Single tick: decrement timer, process rounds, broadcast state.
 * Runs every 1 second. Rounds are processed every 3 seconds.
 * @param {object} game - In-memory game state
 * @param {import('socket.io').Server} io
 */
async function tick(game, io) {
  game.timeLeft--;

  // Every 3 seconds, process a round
  if (game.timeLeft % 3 === 0 && game.timeLeft > 0) {
    game.round++;

    // Generate and apply round events using the engine
    // playRound already applies events internally and returns updated players
    const roundResult = engine.playRound(game.players, game.teams, {
      random: Math.random,
      round: game.round,
    });

    game.players = roundResult.players;
    game.teams = roundResult.teams;

    for (const event of roundResult.events) {
      if (event && event.actorId && typeof event.delta === 'number') {
        if (!game.scoreLog[event.actorId]) game.scoreLog[event.actorId] = [];
        game.scoreLog[event.actorId].push({
          type: 'round',
          delta: event.delta,
          round: game.round,
          timestamp: Date.now(),
        });
      }
    }

    // Save round to DB
    try {
      await db.execute(
        'INSERT INTO game_rounds (session_id, round_num, events_json) VALUES (?, ?, ?)',
        [game.sessionId, game.round, JSON.stringify(roundResult.events)]
      );
    } catch (err) {
      console.error('[GameService] Save round error:', err);
    }

    // Broadcast round update
    io.to(`arena:${game.sessionId}`).emit('game_tick', {
      timeLeft: game.timeLeft,
      round: game.round,
      events: roundResult.events,
      players: game.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        teamId: p.teamId,
      })),
      teams: game.teams,
    });
  }

  // Broadcast time update every second
  io.to(`arena:${game.sessionId}`).emit('time_update', {
    timeLeft: game.timeLeft,
  });

  // Check game over
  if (game.timeLeft <= 0) {
    await finishGame(game, io);
  }
}

/**
 * Finish the game: stop timer, calculate results, save to DB, broadcast.
 * @param {object} game - In-memory game state
 * @param {import('socket.io').Server} io
 */
async function finishGame(game, io) {
  if (game.timer) {
    clearInterval(game.timer);
    game.timer = null;
  }

  // Calculate results using engine
  const result = engine.buildResult(game.players);

  await db.execute(
    'UPDATE game_sessions SET status = ?, finished_at = NOW(), round_count = ? WHERE id = ?',
    ['finished', game.round, game.sessionId]
  );

  for (const player of result.ranking) {
    const userId = Number(player.id);
    const coinsEarned = Math.floor(
      Math.max(0, player.score - (game.initialScores[player.id] || 0)) * 3
    );
    await db.execute(
      'UPDATE game_players SET final_score = ?, rank = ?, coins_earned = ? WHERE session_id = ? AND user_id = ?',
      [player.score, player.rank, coinsEarned, game.sessionId, userId]
    );

    await db.execute(
      'UPDATE users SET coins = coins + ?, game_count = game_count + 1, total_income = total_income + ?, total_exp = total_exp + ?, win_count = win_count + ? WHERE id = ?',
      [
        coinsEarned,
        coinsEarned,
        Math.max(0, player.score - (game.initialScores[player.id] || 0)),
        player.rank === 1 ? 1 : 0,
        userId,
      ]
    );
  }

  // Save final result
  await db.execute(
    'INSERT INTO game_results (session_id, result_json) VALUES (?, ?)',
    [game.sessionId, JSON.stringify(result)]
  );

  game.status = 'finished';

  // Broadcast finish
  io.to(`arena:${game.sessionId}`).emit('game_finished', {
    sessionId: game.sessionId,
    result,
  });

  // Clean up after 5 minutes
  setTimeout(() => {
    activeGames.delete(game.sessionId);
  }, 5 * 60 * 1000);
}

/**
 * Get current in-memory game state for a session.
 * @param {number|string} sessionId
 * @returns {object|null}
 */
function getGameState(sessionId) {
  const game = activeGames.get(Number(sessionId));
  if (!game) return null;
  return {
    sessionId: game.sessionId,
    timeLeft: game.timeLeft,
    round: game.round,
    status: game.status,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      teamId: p.teamId,
      avatar: p.avatar,
    })),
    teams: game.teams,
  };
}

module.exports = {
  startGameSession,
  startTickLoop,
  getGameState,
  getActiveGames,
  tick,
  finishGame,
};
