const express = require('express');
const router = express.Router();
['auth', 'dashboard', 'users', 'items', 'games', 'stats', 'admins', 'rooms', 'announcements', 'configs', 'logs'].forEach(name => {
  try { router.use('/' + name, require('./' + name)); } catch (e) {}
});
module.exports = router;
