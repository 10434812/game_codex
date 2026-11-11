const express = require('express');
const db = require('../models/db');

const router = express.Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ code: 0, message: 'ok', data: { status: 'healthy', timestamp: Date.now() } });
});

// Readiness checks the database separately so liveness remains independent of it.
router.get('/ready', (_req, res) => db.execute('SELECT 1')
  .then(() => res.json({ code: 0, message: 'ok', data: { status: 'ready' } }))
  .catch(() => res.status(503).json({ code: 503, message: '服务暂不可用', data: { status: 'unavailable' } })));

const mount = (path, name) => {
  router.use(path, require(name));
  console.log(`[Routes] Mounted /api${path}`);
};

mount('/auth', './auth');
mount('/user', './user');
mount('/rooms', './rooms');
mount('/games', './games');
mount('/shop', './shop');
mount('/stats', './stats');
mount('/tasks', './tasks');
mount('/leaderboard', './leaderboard');
mount('/configs', './configs');
mount('/announcements', './announcements');
mount('/admin', './admin');

module.exports = router;
