const express = require('express');
const auth = require('../middleware/auth');
const statsService = require('../services/stats-service');
const { success, fail } = require('../utils/response');

const router = express.Router();

// All stats routes require authentication
router.use(auth);

// GET /api/stats/summary — player overview
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await statsService.getSummary(req.user.userId);
    if (!summary) {
      return res.status(404).json(fail('用户不存在', 404));
    }
    res.json(success(summary));
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/history — game history with pagination
router.get('/history', async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await statsService.getHistory(req.user.userId, page, limit);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/coin-records — account ledger with pagination
router.get('/coin-records', async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await statsService.getCoinRecords(req.user.userId, page, limit);
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
