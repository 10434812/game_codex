const jwt = require('jsonwebtoken');
const config = require('../config');
const {fail} = require('../utils/response');

function requestBudget({limit, windowMs, key, now = Date.now}) {
  const entries = new Map();
  let cleanupAt = 0;
  return (req, res, next) => {
    const at = now();
    if (at >= cleanupAt) {
      for (const [id, entry] of entries) if (entry.until <= at) entries.delete(id);
      cleanupAt = at + windowMs;
    }
    const id = key(req);
    let entry = entries.get(id);
    if (!entry || entry.until <= at) {
      // Refuse new keys at capacity; never evict a live counter to bypass limits.
      if (!entry && entries.size >= 10000) return res.status(429).json(fail('请求频繁，请稍后再试', 429));
      entry = {count: 0, until: at + windowMs}; entries.set(id, entry);
    }
    if (++entry.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((entry.until - at) / 1000)));
      return res.status(429).json(fail('请求频繁，请稍后再试', 429));
    }
    next();
  };
}

function userKey(req) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const user = jwt.verify(token, config.jwt.secret);
    if (Number.isSafeInteger(Number(user.userId)) && Number(user.userId) > 0) return `user:${user.userId}`;
  } catch (_) {}
  return `ip:${req.ip}`;
}
function apiTrafficGuard() {
  const auth = requestBudget({limit: 20, windowMs: 60000, key: (req) => req.ip});
  const write = requestBudget({limit: 30, windowMs: 1000, key: userKey});
  return (req, res, next) => {
    if (req.method === 'POST' && /^\/auth\/(login|refresh)\/?$/.test(req.path)) return auth(req, res, next);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && /^\/(rooms|games|matchmaking|retention|tasks)(\/|$)/.test(req.path)) return write(req, res, next);
    next();
  };
}
module.exports = {requestBudget, apiTrafficGuard};
