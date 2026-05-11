const express = require('express');

const router = express.Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ code: 0, message: 'ok', data: { status: 'healthy', timestamp: Date.now() } });
});

// Mount route modules (lazy require to avoid startup failures on first pass)
const tryMount = (path, name) => {
  try {
    router.use(path, require(name));
    console.log(`[Routes] Mounted /api${path}`);
  } catch (err) {
    console.warn(`[Routes] Skipped /api${path} (${err.message})`);
  }
};

tryMount('/auth', './auth');
tryMount('/user', './user');
tryMount('/rooms', './rooms');
tryMount('/games', './games');
tryMount('/shop', './shop');
tryMount('/stats', './stats');
tryMount('/leaderboard', './leaderboard');
tryMount('/admin', './admin');

module.exports = router;
