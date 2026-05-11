const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const statsService = require('../../services/admin-stats-service');
const { success, fail } = require('../../utils/response');

router.get('/overview', adminAuth, async (req, res) => {
  try { const data = await statsService.getOverview(req.query.from, req.query.to); res.json(success(data)); }
  catch (err) { console.error('[Admin Stats]', err); res.status(500).json(fail('获取统计数据失败', 500)); }
});

router.get('/top-players', adminAuth, async (req, res) => {
  try { const data = await statsService.getTopPlayers(Number(req.query.limit) || 50); res.json(success(data)); }
  catch (err) { console.error('[Admin Top]', err); res.status(500).json(fail('获取排行榜失败', 500)); }
});

module.exports = router;
