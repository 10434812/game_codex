const {taskDate} = require('./daily-task-service');
const db = require('../models/db');
const engine = require('../game-engine/game-engine');
const runArena = require('../game-engine/run-arena');
const gameActions = require('./game-actions-service');
const {
  GAME_DURATION_SECONDS,
  INITIAL_SCORE_RANGE,
  MIN_PLAYERS,
  STAGES,
} = require('../game-engine/constants');
const { buildAchievement, buildAchievementMedal } = require('../game-engine/achievement-medals');
const { buildExpProgress } = require('../game-engine/progression');

const ONLINE_MODE_TEXT = '联网对战';
const START_CONFIRM_TIMEOUT_MS = 30000;
const FAILED_START_RECOVERY_ATTEMPTS = 3;
const FAILED_START_RECOVERY_BASE_DELAY_MS = 200;

// Active games: sessionId -> { timer, state }
const activeGames = new Map();

function getActiveGames() {
  return activeGames;
}

function getActiveGame(sessionId) {
  return activeGames.get(Number(sessionId)) || null;
}

function findStageById(stageId) {
  const id = Number(stageId);
  return STAGES.find((stage) => Number(stage.id) === id) || null;
}

function createInitialScore(random = Math.random) {
  return Math.floor(INITIAL_SCORE_RANGE.min + random() * (INITIAL_SCORE_RANGE.max - INITIAL_SCORE_RANGE.min + 1));
}

function buildEnginePlayers(roomPlayers, userMap = {}, options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  return (roomPlayers || []).map((rp) => {
    const user = userMap[rp.user_id] || {};
    return {
      id: String(rp.user_id),
      name: user.nick_name || 'Player',
      avatar: user.avatar_url || '',
      isRobot: false,
      isSelf: rp.is_host ? true : false,
      seat: rp.seat,
      score: createInitialScore(random),
      teamId: null,
      ready: true,
      state: rp.is_host ? '房主·已准备' : '已就绪',
    };
  });
}

function fillArenaPlayers(players, options = {}) {
  return engine.ensureMinimumPlayers(players, options);
}

function isViewerPlayer(player, viewerUserId) {
  if (viewerUserId === undefined || viewerUserId === null || viewerUserId === '') {
    return !!(player && player.isSelf);
  }
  return String(player && player.id) === String(viewerUserId);
}

function formatScore(score) {
  return Number(score || 0).toLocaleString('en-US');
}

function mapStatePlayer(player, viewerUserId) {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    teamId: player.teamId,
    independent: !!player.independent,
    avatar: player.avatar,
    seat: player.seat,
    isRobot: !!player.isRobot,
    isSelf: isViewerPlayer(player, viewerUserId),
    state: player.state || '',
  };
}

function buildOnlinePlayers(roomPlayers, userMap) {
  const realPlayers = (roomPlayers || []).map((rp) => {
    const user = userMap[rp.user_id] || {};
    return {
      id: String(rp.user_id),
      name: user.nick_name || 'Player',
      avatar: user.avatar_url || '',
      isRobot: false,
      isSelf: false,
      seat: rp.seat,
      score: Math.floor(INITIAL_SCORE_RANGE.min + Math.random() * (INITIAL_SCORE_RANGE.max - INITIAL_SCORE_RANGE.min + 1)),
      teamId: null,
      ready: true,
      state: rp.is_host ? '房主·已准备' : '已就绪',
    };
  });

  return engine.ensureMinimumPlayers(realPlayers);
}

function mapResultPlayer(player, viewerUserId) {
  return {
    id: player.id,
    rank: player.rank,
    name: player.name,
    score: formatScore(player.score),
    avatar: player.avatar,
    isSelf: isViewerPlayer(player, viewerUserId),
  };
}

function buildTop3(ranking, viewerUserId) {
  return {
    first: ranking[0] ? mapResultPlayer(ranking[0], viewerUserId) : null,
    second: ranking[1] ? mapResultPlayer(ranking[1], viewerUserId) : null,
    third: ranking[2] ? mapResultPlayer(ranking[2], viewerUserId) : null,
  };
}

function buildResultPayload(game, viewerUserId) {
  const result = engine.buildResult(game.players || []);
  const ranking = (result.ranking || []).map((player) => ({
    ...player,
    isSelf: isViewerPlayer(player, viewerUserId),
  }));
  const selfPlayer = ranking.find((player) => player.isSelf) || ranking[0] || null;
  const selfRank = selfPlayer ? selfPlayer.rank : 0;
  const initialScore = selfPlayer ? Number((game.initialScores || {})[selfPlayer.id]) || 0 : 0;
  const gain = selfPlayer ? Math.max(0, Number(selfPlayer.score || 0) - initialScore) : 0;
  const stage = game.stage || findStageById(game.stageId) || null;
  const achievement = buildAchievement(stage);

  return {
    ...result,
    ranking,
    top3: buildTop3(ranking, viewerUserId),
    performanceMap: runArena.runPerformanceMap(game.runWorld),
    rest: ranking.slice(3).map((player) => mapResultPlayer(player, viewerUserId)),
    resultId: viewerUserId ? `session-${game.sessionId}-user-${viewerUserId}` : `session-${game.sessionId}`,
    gain,
    coins: gain * 3,
    rank: selfRank,
    achievement,
    achievementMedal: buildAchievementMedal({
      stage,
      achievement,
      gain,
      rank: selfRank,
    }),
    modeText: ONLINE_MODE_TEXT,
    ...(game.interrupted ? {interrupted: true, title: '对局已中断', reason: game.feedText} : {}),
  };
}

function personalizeStoredResultPayload(result, options = {}) {
  const viewerUserId = options.viewerUserId;
  const sessionId = options.sessionId || result.sessionId || '';
  const ranking = (result.ranking || []).map((player) => ({
    ...player,
    isSelf: isViewerPlayer(player, viewerUserId),
  }));
  const playerRow = options.playerRow || null;
  const selfPlayer = ranking.find((player) => player.isSelf) || null;
  const selfRank = Number(playerRow && playerRow.rank) || (selfPlayer ? selfPlayer.rank : 0);
  const gain = playerRow
    ? Math.max(0, Number(playerRow.final_score || 0) - Number(playerRow.initial_score || 0))
    : Number(result.gain || 0);
  const coins = playerRow ? Number(playerRow.coins_earned || 0) : Number(result.coins || gain * 3);
  const stage = options.stage || findStageById(options.stageId) || result.stage || null;
  const achievement = result.achievement || buildAchievement(stage);

  return {
    ...result,
    ranking,
    top3: buildTop3(ranking, viewerUserId),
    rest: ranking.slice(3).map((player) => mapResultPlayer(player, viewerUserId)),
    resultId: viewerUserId ? `session-${sessionId}-user-${viewerUserId}` : (result.resultId || `session-${sessionId}`),
    gain,
    coins,
    rank: selfRank,
    achievement,
    // The stored payload is built without a viewer, so its medal belongs to the
    // first-ranked player. Recompute per viewer whenever the viewer's row is known.
    achievementMedal: (playerRow || !result.achievementMedal)
      ? buildAchievementMedal({ stage, achievement, gain, rank: selfRank })
      : result.achievementMedal,
    modeText: result.modeText || ONLINE_MODE_TEXT,
  };
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
  // 3. Get user details (nick_name, avatar_url)
  const userIds = roomPlayers.map((p) => p.user_id);
  if (!userIds.length) throw Object.assign(new Error('房间内没有玩家'), { statusCode: 400 });
  const userDetails = await db.queryAll(
    `SELECT id, nick_name, avatar_url FROM users WHERE id IN (${userIds.map(() => '?').join(', ')})`,
    userIds
  );
  const userMap = Object.fromEntries(userDetails.map((u) => [u.id, u]));

  // 4. Create game_sessions record (if not already created by room-service).
  //    The uk_room_playing unique index (only non-NULL while status='playing')
  //    makes this find-or-create atomic: a concurrent duplicate INSERT fails
  //    with ER_DUP_ENTRY and we fall back to re-reading the winner's session.
  let sessionId;
  const existingSession = await db.queryOne(
    "SELECT id FROM game_sessions WHERE room_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
    [roomId]
  );
  if (existingSession) {
    sessionId = existingSession.id;
  } else {
    try {
      const [result] = await db.execute(
        'INSERT INTO game_sessions (room_id, stage_id, status, duration) VALUES (?, ?, ?, ?)',
        [roomId, room.stage_id, 'playing', GAME_DURATION_SECONDS]
      );
      sessionId = result.insertId;
    } catch (err) {
      if (!isDuplicateEntryError(err)) throw err;
      const concurrent = await db.queryOne(
        "SELECT id FROM game_sessions WHERE room_id = ? AND status = 'playing' ORDER BY id DESC LIMIT 1",
        [roomId]
      );
      if (!concurrent) throw err;
      sessionId = concurrent.id;
    }
  }

  // 5. Build engine players from room players
  const enginePlayers = buildOnlinePlayers(roomPlayers, userMap);

  // 6. Pair into teams using the engine
  const paired = {players: enginePlayers.map((player) => ({...player, independent: true, teamId: null})), teams: []};

  // 7. Insert game_players (if not already created by room-service)
  const existingGamePlayers = await db.queryAll(
    'SELECT user_id FROM game_players WHERE session_id = ?',
    [sessionId]
  );
  const existingUserIds = new Set(existingGamePlayers.map((p) => p.user_id));

  // Robots are memory-only: their ids ('robot-*') are not real user ids and
  // must never be written to game_players.user_id (Number('robot-3-12345') is
  // NaN and would fail the INSERT under STRICT mode, freezing the room).
  for (const p of paired.players) {
    if (p.isRobot) continue;
    if (!existingUserIds.has(Number(p.id))) {
      await db.execute(
        'INSERT INTO game_players (session_id, user_id, seat, team_id, initial_score, final_score) VALUES (?, ?, ?, ?, ?, ?)',
        [sessionId, Number(p.id), p.seat, p.teamId, p.score, p.score]
      );
    } else {
      // 行已由 room-service.startGame 创建。把内存中引擎算出的初始分数写回，
      // 保证持久化的 initial_score 与 gameState.initialScores 一致，否则结算页
      // 按 DB 的 initial_score 重算增益会与实发金币对不上。
      await db.execute(
        'UPDATE game_players SET team_id = ?, initial_score = ? WHERE session_id = ? AND user_id = ?',
        [p.teamId, p.score, sessionId, Number(p.id)]
      );
    }
  }

  // 8. Initialize game state in memory
  const gameState = {
    sessionId,
    roomId,
    stageId: room.stage_id,
    stage: findStageById(room.stage_id),
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    round: 0,
    status: 'playing',
    awaitingStartIds: paired.players.filter((player) => !player.isRobot).map((player) => player.id),
    players: paired.players,
    teams: paired.teams,
    runWorld: runArena.createRunWorld(paired.players),
    initialScores: Object.fromEntries(paired.players.map((p) => [p.id, p.score])),
    scoreLog: Object.fromEntries(paired.players.map((p) => [p.id, []])),
    lastEvents: [],
    feedText: `对局进行中（${ONLINE_MODE_TEXT}）`,
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
function startTickLoop(sessionId, realtime) {
  const game = activeGames.get(sessionId);
  if (!game) return;

  if (game.timer) clearTimeout(game.timer);
  let previousAt = Date.now();

  // Serial loop: the next tick is only scheduled after the current one fully
  // settles (including finishGame). With a plain setInterval, a slow DB tick
  // could overlap the next tick and cause duplicate settlement.
  const scheduleNext = () => {
    if (!activeGames.has(game.sessionId) || game.status === 'finished') return;
    game.timer = setTimeout(async () => {
      try {
        const now = Date.now();
        const deltaMs = Math.min(1000, Math.max(0, now - previousAt));
        previousAt = now;
        await tick(game, realtime, deltaMs);
      } catch (err) {
        console.error(`[GameService] Tick error for session ${sessionId}:`, err);
      }
      scheduleNext();
    }, game.runWorld ? 50 : 1000);
    if (game.timer && typeof game.timer.unref === 'function') {
      game.timer.unref();
    }
  };

  scheduleNext();
}

/**
 * Single tick: decrement timer, process rounds, broadcast state.
 * Runs every 1 second. Rounds are processed every 3 seconds.
 * @param {object} game - In-memory game state
 * @param {object} realtime
 */
async function tick(game, realtime, deltaMs = 1000) {
  if (game.status !== 'playing' || game.settlementDone) return;
  if (game.awaitingStartIds?.length) {
    game.startWaitMs = (game.startWaitMs || 0) + deltaMs;
    if (game.startWaitMs >= START_CONFIRM_TIMEOUT_MS) {
      await cancelPendingStart(game.sessionId, realtime, '有玩家未确认，已取消本次开局');
    }
    return;
  }
  if (game.runWorld) {
    if (game.status !== 'playing' || game.settlementDone) return;
    const previousRound = game.round;
    const next = runArena.advanceRunArena(game.runWorld, game.players, Math.min(deltaMs, game.duration * 1000 - game.runWorld.elapsedMs));
    game.runWorld = next.world; game.players = next.players; game.teams = next.teams;
    game.timeLeft = Math.max(0, game.duration - Math.floor(next.world.elapsedMs / 1000));
    game.round = Math.floor(next.world.elapsedMs / 3000);
    game.lastEvents = next.events;
    game.pendingRunEvents = [...(game.pendingRunEvents || []), ...next.events];
    game.scoreLog ||= {};
    for (const event of next.events.filter((e) => e.type === 'pickup')) {
      for (const [id, delta, type] of [[event.actorId, event.delta, event.kind], [event.teammateId, event.linkedDelta, 'team_bonus']]) {
        if (!id) continue;
        game.scoreLog[id] ||= [];
        game.scoreLog[id].push({type, delta, round: game.round, timestamp: Date.now()});
      }
    }
    game.stateVersion = (game.stateVersion || 0) + 1;
    if (game.round > previousRound) {
      const roundEvents = game.pendingRunEvents;
      game.pendingRunEvents = [];
      try {await db.execute('INSERT INTO game_rounds (session_id, round_num, events_json) VALUES (?, ?, ?)', [game.sessionId, game.round, JSON.stringify(roundEvents)]);}
      catch (err) {console.error('[GameService] Save running events error:', err);}
    }
    if (next.world.elapsedMs >= (game.nextBroadcastAt || 0)) {
      game.nextBroadcastAt = next.world.elapsedMs + 100;
      realtime?.emitToSession?.(game.sessionId, 'game_frame', {sessionId: game.sessionId});
    }
    if (game.timeLeft === 0) await finishGame(game, realtime);
    return;
  }
  game.stateVersion = (game.stateVersion || 0) + 1;
  game.timeLeft--;

  // Every 3 seconds, process a round
  if ((game.duration - game.timeLeft) % 3 === 0 && game.timeLeft > 0) {
    game.round++;

    // Generate and apply round events using the engine
    // playRound already applies events internally and returns updated players
    const roundResult = engine.playRound(game.players, game.teams, {
      random: Math.random,
      round: game.round,
      lockedPairs: game.lockedPairs || [],
    });

    game.players = roundResult.players;
    game.teams = roundResult.teams;
    game.lastEvents = roundResult.events;
    game.feedText = `第 ${game.round} 轮好运事件已刷新`;

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
    if (realtime && typeof realtime.emitToSession === 'function') {
      realtime.emitToSession(game.sessionId, 'game_tick', {
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
  }

  // Broadcast time update every second
  if (realtime && typeof realtime.emitToSession === 'function') {
    realtime.emitToSession(game.sessionId, 'time_update', {
      timeLeft: game.timeLeft,
    });
  }

  // Check game over
  if (game.timeLeft <= 0) {
    await finishGame(game, realtime);
  }
}

/**
 * Finish the game: stop timer, settle in a single transaction, broadcast.
 * Idempotent: an in-memory settlement lock plus a row-level DB status check
 * make it safe against overlapping ticks, double calls and multi-process races.
 * @param {object} game - In-memory game state
 * @param {object} realtime
 */
async function finishGame(game, realtime) {
  if (!game || game.status === 'finished' || game.settlementDone) {
    return;
  }
  // In-memory lock: any second settlement attempt while this one is running
  // (or after it completed) is a no-op.
  game.settlementDone = true;

  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }

  // Calculate results using engine
  const result = buildResultPayload(game);

  let conn;
  try {
    conn = await db.pool.getConnection();
    await conn.beginTransaction();

    // Row lock + status check: if another process already settled this
    // session, do nothing (no double rewards).
    const [sessionRows] = await conn.execute(
      'SELECT status FROM game_sessions WHERE id = ? FOR UPDATE',
      [game.sessionId]
    );
    const sessionRow = sessionRows && sessionRows[0];
    if (sessionRow && sessionRow.status === 'finished') {
      await conn.rollback();
      game.status = 'finished';
      broadcastGameFinished(game, realtime, result);
      scheduleCleanup(game);
      return;
    }

    await conn.execute(
      'UPDATE game_sessions SET status = ?, finished_at = NOW(), round_count = ? WHERE id = ?',
      ['finished', game.round, game.sessionId]
    );
    await conn.execute(
      "UPDATE rooms SET status = 'finished', finished_at = NOW() WHERE id = ? AND status = 'playing'",
      [game.roomId]
    );

    const dailyTaskDate = taskDate();
    for (const player of result.ranking) {
      if (player.isRobot) {
        continue;
      }
      const userId = Number(player.id);
      const gain = Math.max(0, player.score - (game.initialScores[player.id] || 0));
      const coinsEarned = Math.floor(gain * 3);
      const expGained = gain;
      const winIncrement = player.rank === 1 ? 1 : 0;

      await conn.execute(
        'UPDATE game_players SET final_score = ?, `rank` = ?, coins_earned = ? WHERE session_id = ? AND user_id = ?',
        [player.score, player.rank, coinsEarned, game.sessionId, userId]
      );

      await conn.execute(
        'UPDATE users SET coins = coins + ?, game_count = game_count + 1, total_income = total_income + ?, total_exp = total_exp + ?, win_count = win_count + ? WHERE id = ?',
        [coinsEarned, coinsEarned, expGained, winIncrement, userId]
      );

      // Daily task progress is auxiliary: a failure here (e.g. missing table on
      // an unmigrated database) must not roll back the whole settlement.
      await conn.query('SAVEPOINT daily_task_progress');
      try {
        await conn.execute(
          'INSERT INTO daily_tasks (user_id, task_date, games, teamed) VALUES (?, ?, 1, ?) ON DUPLICATE KEY UPDATE games = games + 1, teamed = teamed + VALUES(teamed)',
          [userId, dailyTaskDate, player.teamId ? 1 : 0]
        );
        await conn.query('RELEASE SAVEPOINT daily_task_progress');
      } catch (taskErr) {
        await conn.query('ROLLBACK TO SAVEPOINT daily_task_progress');
        await conn.query('RELEASE SAVEPOINT daily_task_progress');
        console.error('[settlement] daily task progress skipped:', taskErr && taskErr.message);
      }

      // Level is derived from accumulated experience and stored so API/admin readers see it.
      const [[{ coins, total_exp: totalExp }]] = await conn.execute(
        'SELECT coins, total_exp FROM users WHERE id = ?',
        [userId]
      );
      await conn.execute('UPDATE users SET level = ? WHERE id = ?', [
        buildExpProgress(totalExp).level,
        userId,
      ]);

      // Ledger row so the income page can reconcile every game reward.
      // Zero-reward players get no ledger entry to avoid "+0" noise.
      if (coinsEarned > 0) {
        const stageName = (game.stage && game.stage.name) || '';
        await conn.execute(
          'INSERT INTO coin_records (user_id, amount, balance_after, type, title) VALUES (?, ?, ?, ?, ?)',
          [userId, coinsEarned, coins, 'game_reward', `对局奖励 · ${stageName} · 第${player.rank}名`]
        );
      }
    }

    // Idempotent result row: a retry/duplicate insert must not fail.
    await conn.execute(
      'INSERT INTO game_results (session_id, result_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE result_json = VALUES(result_json)',
      [game.sessionId, JSON.stringify(result)]
    );

    await conn.commit();
  } catch (err) {
    if (conn && typeof conn.rollback === 'function') {
      try {
        await conn.rollback();
      } catch (_rollbackErr) {}
    }
    // Allow the next tick to retry settlement (session stays 'playing').
    // Also released if getConnection itself failed: the lock must not stick.
    game.settlementDone = false;
    throw err;
  } finally {
    if (conn && typeof conn.release === 'function') {
      conn.release();
    }
  }

  game.status = 'finished';
  broadcastGameFinished(game, realtime, result);
  scheduleCleanup(game);
}

function broadcastGameFinished(game, realtime, result) {
  if (realtime && typeof realtime.emitToSession === 'function') {
    realtime.emitToSession(game.sessionId, 'game_finished', {
      sessionId: game.sessionId,
      result,
    });
  }
}

function scheduleCleanup(game) {
  const cleanupTimer = setTimeout(() => {
    activeGames.delete(game.sessionId);
  }, 5 * 60 * 1000);
  if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

async function cancelPendingStart(sessionId, realtime, reason = '玩家取消了本次开局') {
  const game = getActiveGame(sessionId);
  if (!game || game.status !== 'playing' || game.settlementDone || !game.awaitingStartIds?.length) {
    throw Object.assign(new Error('本局已开始或已结束，不能取消开局'), {statusCode: 409});
  }
  game.settlementDone = true;
  await interruptOrphanSession({id: game.sessionId, room_id: game.roomId, stage_id: game.stageId}, reason).catch((error) => {
    game.settlementDone = false;
    throw error;
  });
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
  game.status = 'finished';
  game.interrupted = true;
  game.feedText = reason;
  game.awaitingStartIds = [];
  game.stateVersion = (game.stateVersion || 0) + 1;
  broadcastGameFinished(game, realtime, buildResultPayload(game));
  scheduleCleanup(game);
}

function isDuplicateEntryError(err) {
  return !!(err && err.code === 'ER_DUP_ENTRY');
}

/**
 * Force-finish an in-memory game session (admin intervention).
 *
 * Stops the tick loop, settles by elapsed time (default) or rolls back,
 * writes the finished state back to DB and broadcasts the end event so
 * players leave the arena page instead of hanging forever.
 *
 * @param {number|string} sessionId
 * @param {object} [realtime] - arenaRealtime hub ({ emitToSession })
 * @param {object} [options]
 * @param {boolean} [options.settle=true] - true: settle rewards by current
 *   in-memory scores (same as natural finish); false: rollback without rewards.
 * @param {string} [options.reason=''] - reason surfaced in the abort event
 * @returns {Promise<{aborted: boolean, inMemory: boolean, settled: boolean, sessionId: number}>}
 */
async function forceFinishSession(sessionId, realtime, options = {}) {
  const numericId = Number(sessionId);
  const game = activeGames.get(numericId);

  if (!game) {
    // No in-memory state (e.g. process restarted): just close the DB record.
    await db.execute(
      "UPDATE game_sessions SET status = 'finished', finished_at = NOW() WHERE id = ? AND status = 'playing'",
      [numericId]
    );
    return { aborted: true, inMemory: false, settled: false, sessionId: numericId };
  }

  if (game.status === 'finished') {
    return { aborted: false, inMemory: true, settled: false, alreadyFinished: true, sessionId: numericId };
  }

  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }

  const settle = options.settle !== false;
  if (settle) {
    // Settle by elapsed time: reuse the normal settlement path, which
    // writes final scores / rewards, inserts game_results and broadcasts
    // game_finished. Players keep what they earned up to this point.
    await finishGame(game, realtime);
    if (game.status !== 'finished') {
      // A tick may have been mid-settlement when we cleared the timer
      // (finishGame is a no-op while settlementDone is set). Retry once:
      // if that in-flight settlement failed, this call settles now that no
      // further tick can run.
      await finishGame(game, realtime);
    }
  }

  if (game.status !== 'finished') {
    // Rollback / last resort: mark the session finished without granting any
    // rewards, so the room and session can never stay stuck in 'playing'.
    await db.execute(
      'UPDATE game_sessions SET status = ?, finished_at = NOW(), round_count = ? WHERE id = ?',
      ['finished', game.round || 0, numericId]
    );
    game.status = 'finished';
    if (realtime && typeof realtime.emitToSession === 'function') {
      realtime.emitToSession(numericId, 'game_finished', {
        sessionId: numericId,
        aborted: true,
        result: null,
      });
    }
  }

  // Extra abort notice (clients that don't handle it simply ignore it).
  if (realtime && typeof realtime.emitToSession === 'function') {
    realtime.emitToSession(numericId, 'game_aborted', {
      sessionId: numericId,
      aborted: true,
      reason: options.reason || '管理员强制关闭',
    });
  }

  return { aborted: true, inMemory: true, settled: settle, sessionId: numericId };
}

/**
 * Get current in-memory game state for a session.
 * @param {number|string} sessionId
 * @returns {object|null}
 */
function getGameState(sessionId, viewerUserId) {
  const game = activeGames.get(Number(sessionId));
  if (!game) return null;
  return {
    sessionId: game.sessionId,
    roomId: game.roomId,
    stageId: game.stageId,
    stage: game.stage || findStageById(game.stageId),
    duration: game.duration || GAME_DURATION_SECONDS,
    timeLeft: game.timeLeft,
    round: game.round,
    status: game.status,
    awaitingStart: !!game.awaitingStartIds?.length,
    needsStartAck: (game.awaitingStartIds || []).includes(String(viewerUserId)),
    startWaitSeconds: game.awaitingStartIds?.length ? Math.max(0, Math.ceil((START_CONFIRM_TIMEOUT_MS - (game.startWaitMs || 0)) / 1000)) : 0,
    modeText: ONLINE_MODE_TEXT,
    feedText: game.feedText || `对局进行中（${ONLINE_MODE_TEXT}）`,
    lastEvents: game.lastEvents || [],
    players: game.players.map((p) => mapStatePlayer(p, viewerUserId)),
    teams: game.teams,
    stateVersion: game.stateVersion || 0,
    runWorld: game.runWorld || null,
    ...(viewerUserId ? gameActions.getView(game, viewerUserId) : {}),
  };
}


/**
 * Startup reconciliation: any DB session stuck in status='playing' with no
 * in-memory state is an orphan left by a crash/restart. It is marked finished
 * (interrupted), any partial settlement is rolled back (scores reset to the
 * pre-game value, no rewards), a minimal result row is written so the result
 * page can render, and the room is returned to 'waiting' so players are never
 * stuck. Runs once at process startup.
 *
 * @returns {Promise<number>} number of orphaned sessions handled
 */
async function reconcileOrphanSessions() {
  const sessions = await db.queryAll(
    "SELECT id, room_id, stage_id FROM game_sessions WHERE status = 'playing'"
  );
  let handled = 0;
  for (const session of sessions) {
    if (activeGames.has(Number(session.id))) {
      continue; // live in memory, leave it alone
    }
    try {
      await interruptOrphanSession(session);
      handled += 1;
      console.log(`[GameService] Marked orphan session ${session.id} as interrupted`);
    } catch (err) {
      console.error(`[GameService] Failed to interrupt orphan session ${session.id}:`, err);
    }
  }
  return handled;
}

/**
 * Roll an orphaned session back to its pre-game state inside one transaction.
 * @param {object} session - { id, room_id, stage_id } row from game_sessions
 */
async function interruptOrphanSession(session, reason = '服务已重启，本局未完成，未发放奖励') {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sessionRows] = await conn.execute(
      'SELECT id, status FROM game_sessions WHERE id = ? FOR UPDATE',
      [session.id]
    );
    const row = sessionRows && sessionRows[0];
    if (!row || row.status !== 'playing') {
      await conn.rollback();
      return;
    }

    // Roll back any partial settlement: scores back to initial, no rewards.
    await conn.execute(
      'UPDATE game_players SET final_score = initial_score, `rank` = NULL, coins_earned = 0 WHERE session_id = ?',
      [session.id]
    );

    // Minimal result payload so the result page can show "对局已中断".
    const payload = await buildInterruptedResultPayload(session.id, session.stage_id);
    payload.reason = reason;

    await conn.execute(
      'INSERT INTO game_results (session_id, result_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE result_json = VALUES(result_json)',
      [session.id, JSON.stringify(payload)]
    );

    await conn.execute(
      "UPDATE game_sessions SET status = 'finished', finished_at = NOW() WHERE id = ? AND status = 'playing'",
      [session.id]
    );

    // Roll the room back to 'waiting' so the players can start again instead of
    // being stuck behind a finished/playing room. Only if no other session of
    // this room is still playing.
    const [otherPlayingRows] = await conn.execute(
      "SELECT id FROM game_sessions WHERE room_id = ? AND status = 'playing' AND id != ? LIMIT 1",
      [session.room_id, session.id]
    );
    if (!otherPlayingRows || otherPlayingRows.length === 0) {
      await conn.execute(
        "UPDATE rooms SET status = 'waiting' WHERE id = ? AND status = 'playing'",
        [session.room_id]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Compensate only the session committed by this failed start request.
async function recoverFailedStart(sessionId, options = {}) {
  const id = Number(sessionId);
  const game = activeGames.get(id);
  if (game && game.timer) clearTimeout(game.timer);
  activeGames.delete(id);
  const attempts = Math.max(1, Number(options.attempts) || FAILED_START_RECOVERY_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? FAILED_START_RECOVERY_BASE_DELAY_MS;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const session = await db.queryOne(
        "SELECT id, room_id, stage_id FROM game_sessions WHERE id = ? AND status = 'playing'",
        [id]
      );
      if (session) await interruptOrphanSession(session);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  // Still failing: leave the 'playing' row for the periodic reconciler, which
  // retries it later. Surface the error so callers can log it.
  throw lastError;
}

/**
 * Build a "game interrupted" result payload from the persisted game_players
 * rows (real players only — robots were never persisted). All scores are the
 * rolled-back initial scores, so gain/coins are 0.
 */
async function buildInterruptedResultPayload(sessionId, stageId) {
  const playerRows = await db.queryAll(
    `SELECT gp.user_id, gp.seat, gp.initial_score, u.nick_name, u.avatar_url
     FROM game_players gp
     JOIN users u ON u.id = gp.user_id
     WHERE gp.session_id = ?
     ORDER BY gp.seat ASC`,
    [sessionId]
  );
  const players = (playerRows || []).map((row) => ({
    id: String(row.user_id),
    name: row.nick_name || 'Player',
    avatar: row.avatar_url || '',
    isRobot: false,
    isSelf: false,
    seat: row.seat,
    score: row.initial_score,
    teamId: null,
    ready: true,
    state: '已就绪',
  }));
  const result = engine.buildResult(players);
  const stage = findStageById(stageId);
  const achievement = buildAchievement(stage);
  const ranking = (result.ranking || []).map((player) => ({
    ...player,
    isSelf: false,
  }));
  return {
    ...result,
    ranking,
    top3: buildTop3(ranking, null),
    rest: ranking.slice(3).map((player) => mapResultPlayer(player, null)),
    sessionId,
    stageId,
    stage,
    gain: 0,
    coins: 0,
    rank: 0,
    interrupted: true,
    achievement,
    achievementMedal: buildAchievementMedal({ stage, achievement, gain: 0, rank: 0 }),
    modeText: ONLINE_MODE_TEXT,
    resultId: `session-${sessionId}`,
    title: '对局已中断',
  };
}

/**
 * Stop every in-memory tick loop (used by graceful shutdown).
 */
function stopAllTimers() {
  for (const game of activeGames.values()) {
    if (game.timer) {
      clearTimeout(game.timer);
      game.timer = null;
    }
  }
}

module.exports = {
  recoverFailedStart,
  buildOnlinePlayers,
  buildEnginePlayers,
  fillArenaPlayers,
  startGameSession,
  startTickLoop,
  getGameState,
  getActiveGame,
  getActiveGames,
  buildResultPayload,
  personalizeStoredResultPayload,
  tick,
  cancelPendingStart,
  finishGame,
  forceFinishSession,
  reconcileOrphanSessions,
  interruptOrphanSession,
  stopAllTimers,
};
