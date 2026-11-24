const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const gameService = require('../services/game-service');
const gameActions = require('../services/game-actions-service');
const db = require('../models/db');
const { success, fail } = require('../utils/response');
const challenges = require('../services/friend-challenge-service');

/**
 * A user may only read a game they actually played in. Non-members get the
 * same 404 as a missing game so sessionIds (auto-increment integers) are not
 * enumerable: outsiders cannot tell whether a given id exists.
 */
async function isGameMember(sessionId, userId) {
  const row = await db.queryOne(
    'SELECT id FROM game_players WHERE session_id = ? AND user_id = ?',
    [sessionId, userId]
  );
  return !!row;
}

function parseSessionId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

router.get('/current', auth, (req, res, next) => {
  return db.queryOne(
    `SELECT gs.id AS sessionId, gs.room_id AS roomId FROM game_sessions gs
     JOIN game_players gp ON gp.session_id = gs.id
     WHERE gp.user_id = ? AND gs.status = 'playing' ORDER BY gs.id DESC LIMIT 1`,
    [req.user.userId]
  ).then((session) => res.json(success(session))).catch(next);
});

router.post('/:id/rematch', auth, async (req, res, next) => {
  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) return res.status(400).json(fail('无效的对局ID', 400));
  try {
    const room = await require('../services/room-service').rematch(sessionId, req.user.userId);
    return res.json(success(room, '已返回原房间并准备'));
  } catch (error) {return next(error);}
});

router.post('/:id/cancel-start', auth, (req, res, next) => {
  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) return res.status(400).json(fail('无效的对局ID', 400));
  return isGameMember(sessionId, req.user.userId).then(async (member) => {
    if (!member) return res.status(404).json(fail('对局不存在', 404));
    await gameService.cancelPendingStart(sessionId, req.app.get('arenaRealtime'));
    return res.json(success({cancelled: true}));
  }).catch(next);
});

router.get('/:id', auth, async (req, res) => {
  try {
    const sessionId = parseSessionId(req.params.id);
    if (!sessionId) return res.status(400).json(fail('无效的对局ID', 400));
    if (!(await isGameMember(sessionId, req.user.userId))) {
      return res.status(404).json(fail('对局不存在', 404));
    }

    const state = gameService.getGameState(sessionId, req.user.userId);
    if (state) return res.json(success(state));

    const session = await db.queryOne('SELECT * FROM game_sessions WHERE id = ?', [sessionId]);
    if (!session) return res.status(404).json(fail('对局不存在', 404));
    res.json(success({ sessionId: session.id, status: session.status }));
  } catch (err) {
    console.error('[Games]', err);
    res.status(500).json(fail('获取对局状态失败', 500));
  }
});

// GET /api/games/:id/result - Get game result
router.get('/:id/result', auth, async (req, res) => {
  try {
    const sessionId = parseSessionId(req.params.id);
    if (!sessionId) return res.status(400).json(fail('无效的对局ID', 400));
    if (!(await isGameMember(sessionId, req.user.userId))) {
      return res.status(404).json(fail('对局不存在', 404));
    }

    const activeGame = gameService.getActiveGame(sessionId);
    if (activeGame) {
      if (activeGame.status !== 'finished') return res.status(409).json(fail('结算确认中，请稍后重试', 409));
      const payload = gameService.buildResultPayload(activeGame, req.user.userId);
      const fields = payload.interrupted ? {} : await challenges.resultFields(sessionId, req.user.userId);
      return res.json(success({...payload, ...fields}));
    }

    const result = await db.queryOne(
      'SELECT * FROM game_results WHERE session_id = ?',
      [sessionId]
    );
    if (!result) return res.status(404).json(fail('对局结果不存在', 404));
    const session = await db.queryOne(
      'SELECT id, stage_id, room_id FROM game_sessions WHERE id = ?',
      [sessionId]
    );
    const playerRow = await db.queryOne(
      'SELECT initial_score, final_score, `rank`, coins_earned FROM game_players WHERE session_id = ? AND user_id = ?',
      [sessionId, req.user.userId]
    );
    const storedResult = typeof result.result_json === 'string' ? JSON.parse(result.result_json) : result.result_json;
    const payload = gameService.personalizeStoredResultPayload(storedResult, {
      sessionId,
      viewerUserId: req.user.userId,
      stageId: session && session.stage_id,
      roomId: session && session.room_id,
      playerRow,
    });
    const fields = payload.interrupted ? {} : await challenges.resultFields(sessionId, req.user.userId);
    res.json(success({...payload, ...fields}));
  } catch (err) {
    console.error('[Game Result]', err);
    res.status(500).json(fail('获取对局结果失败', 500));
  }
});

router.post('/:id/emotes', auth, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!sessionId) {
      return res.status(400).json(fail('无效的对局ID', 400));
    }

    if (!(await isGameMember(sessionId, req.user.userId))) return res.status(404).json(fail('对局不存在', 404));
    const { emoteId } = req.body || {};
    if (!emoteId) {
      return res.status(400).json(fail('缺少表情参数', 400));
    }

    const activeGame = gameService.getActiveGame(sessionId);
    if (!activeGame || activeGame.status !== 'playing') {
      return res.status(400).json(fail('对局未进行中', 400));
    }
    gameActions.acceptEmote(activeGame, req.user.userId, emoteId);

    const arenaRealtime = req.app.get('arenaRealtime');
    if (arenaRealtime && typeof arenaRealtime.emitToSession === 'function') {
      arenaRealtime.emitToSession(sessionId, 'emote_broadcast', {
        fromUserId: req.user.userId,
        emoteId: String(emoteId),
      });
    }

    return res.json(success({ accepted: true }));
  } catch (err) {
    console.error('[Game Emote]', err);
    res.status(err.statusCode || 500).json(fail(err.message || '发送表情失败', err.statusCode || 500));
  }
});

for (const [path, action] of [
  ['move', (game, userId, body) => gameActions.move(game, userId, body)],
  ['team', (game, userId, body) => gameActions.setTeam(game, userId, body.targetId)],
  ['fortune-bag/claim', (game, userId, body) => gameActions.claimFortuneBag(game, userId, body.offerId)],
  ['ready', (game, userId) => gameActions.ready(game, userId)],
]) {
  router.post(`/:id/${path}`, auth, async (req, res) => {
    try {
      const sessionId = parseSessionId(req.params.id);
      if (!sessionId) return res.status(400).json(fail('无效的对局ID', 400));
      if (!(await isGameMember(sessionId, req.user.userId))) return res.status(404).json(fail('对局不存在', 404));
      const game = gameService.getActiveGame(sessionId);
      action(game, req.user.userId, req.body || {});
      const hub = req.app.get('arenaRealtime');
      if (hub && path !== 'move') hub.emitToSession(sessionId, 'state_changed', { stateVersion: game.stateVersion });
      return res.json(success(gameService.getGameState(sessionId, req.user.userId)));
    } catch (err) {
      return res.status(err.statusCode || 500).json(fail(err.message, err.statusCode || 500));
    }
  });
}

module.exports = router;
