const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const gameService = require('../../services/admin-game-service');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try { const data = await gameService.listGames(req.query.status || '', Number(req.query.page) || 1, Number(req.query.limit) || 20); res.json(success(data)); }
  catch (err) { console.error('[Admin Games]', err); res.status(500).json(fail('获取对局列表失败', 500)); }
});

router.get('/:id', adminAuth, async (req, res) => {
  try {
    const data = await gameService.getGameDetail(req.params.id);
    if (!data) return res.status(404).json(fail('对局不存在', 404));
    res.json(success(data));
  }
  catch (err) { console.error('[Admin Game Detail]', err); res.status(500).json(fail('获取对局详情失败', 500)); }
});

module.exports = router;
