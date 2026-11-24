const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const {assertActiveUser} = require('../middleware/auth');
const {requestBudget} = require('../middleware/traffic-guard');
const analytics = require('../services/analytics-service');
const {success} = require('../utils/response');
const router = express.Router();
// Both budgets must pass: rotating device IDs must not bypass the IP limit.
const ipLimit = requestBudget({limit: 120, windowMs: 60000, key: (req) => req.ip});
const deviceLimit = requestBudget({limit: 30, windowMs: 60000, key: (req) => `${req.ip}:${String(req.body?.deviceId || '').slice(0, 64)}`});
router.post('/', ipLimit, deviceLimit, async (req, res, next) => {
  try {
    analytics.normalizeBatch(req.body);
    let userId = null;
    try {
      const decoded = jwt.verify(String(req.headers.authorization || '').replace(/^Bearer /, ''), config.jwt.secret);
      await assertActiveUser(decoded.userId); userId = Number(decoded.userId);
    } catch (error) {
      if (error.statusCode && error.statusCode !== 401 && error.statusCode !== 403) throw error;
      // Invalid/expired/disabled accounts cannot produce attributable events.
      if (!error.name?.includes('Token') && ![401, 403].includes(error.statusCode)) throw error;
    }
    res.json(success(await analytics.recordBatch(req.body, userId)));
  } catch (error) {next(error);}
});
module.exports = router;
