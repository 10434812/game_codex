const express = require('express');
const auth = require('../middleware/auth');
const statsService = require('../services/stats-service');
const { success } = require('../utils/response');

const router = express.Router();

// Leaderboard routes require authentication
router.use(auth);

// GET /api/leaderboard — global ranking
router.get('/', async (req, res, next) => {
  try {
    const { type, limit } = req.query;
    const players = await statsService.getLeaderboard(type, limit);
    res.json(success(players));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
