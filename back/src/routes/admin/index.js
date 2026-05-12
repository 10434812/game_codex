const express = require('express');
const router = express.Router();
['auth', 'dashboard', 'users', 'items', 'games', 'stats', 'admins', 'rooms', 'announcements', 'configs', 'logs'].forEach(name => {
  try {
    router.use('/' + name, require('./' + name));
  } catch (e) {
    console.warn(`[AdminRoutes] Skipped /admin/${name} (${e.message})`);
  }
});
module.exports = router;
