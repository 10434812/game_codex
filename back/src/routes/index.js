const express = require('express');

const router = express.Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ code: 0, message: 'ok', data: { status: 'healthy', timestamp: Date.now() } });
});

const mount = (path, name) => {
  router.use(path, require(name));
  console.log(`[Routes] Mounted /api${path}`);
};

mount('/auth', './auth');
mount('/user', './user');
mount('/rooms', './rooms');
mount('/games', './games');
mount('/shop', './shop');
mount('/payments', './payments');
mount('/stats', './stats');
mount('/leaderboard', './leaderboard');
mount('/configs', './configs');
mount('/fortune-bags', './fortune-bags');
mount('/admin', './admin');

module.exports = router;
