const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const gameService = require('../services/game-service');
const db = require('../models/db');
const { success, fail } = require('../utils/response');

router.get('/:id', auth, async (req, res) => {
  try {
    const state = gameService.getGameState(req.params.id);
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
    const result = await db.queryOne(
      'SELECT * FROM game_results WHERE session_id = ?',
      [req.params.id]
    );
    if (!result) return res.status(404).json(fail('对局结果不存在', 404));
    res.json(success(JSON.parse(result.result_json)));
  } catch (err) {
    console.error('[Game Result]', err);
    res.status(500).json(fail('获取对局结果失败', 500));
  }
});

module.exports = router;
