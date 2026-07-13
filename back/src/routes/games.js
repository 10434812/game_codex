const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const gameService = require('../services/game-service');
const db = require('../models/db');
const { success, fail } = require('../utils/response');

router.get('/:id', auth, async (req, res) => {
  try {
    const state = gameService.getGameState(req.params.id, req.user.userId);
    if (state) return res.json(success(state));

    const session = await db.queryOne('SELECT * FROM game_sessions WHERE id = ?', [req.params.id]);
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
    const activeGame = gameService.getActiveGame(req.params.id);
    if (activeGame) {
      return res.json(success(gameService.buildResultPayload(activeGame, req.user.userId)));
    }

    const result = await db.queryOne(
      'SELECT * FROM game_results WHERE session_id = ?',
      [req.params.id]
    );
    if (!result) return res.status(404).json(fail('对局结果不存在', 404));
    const session = await db.queryOne(
      'SELECT id, stage_id FROM game_sessions WHERE id = ?',
      [req.params.id]
    );
    const playerRow = await db.queryOne(
      'SELECT initial_score, final_score, `rank`, coins_earned FROM game_players WHERE session_id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );
    res.json(success(gameService.personalizeStoredResultPayload(JSON.parse(result.result_json), {
      sessionId: req.params.id,
      viewerUserId: req.user.userId,
      stageId: session && session.stage_id,
      playerRow,
    })));
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

    const { emoteId } = req.body || {};
    if (!emoteId) {
      return res.status(400).json(fail('缺少表情参数', 400));
    }

    const activeGame = gameService.getActiveGame(sessionId);
    if (!activeGame || activeGame.status !== 'playing') {
      return res.status(400).json(fail('对局未进行中', 400));
    }

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
    res.status(500).json(fail('发送表情失败', 500));
  }
});

module.exports = router;
