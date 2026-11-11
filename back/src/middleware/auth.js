const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');
const { fail } = require('../utils/response');
const {assertTrialAccess} = require('../services/trial-access');

// 用户封禁状态短缓存：避免每个请求都查库；封禁/解封在 CACHE_TTL_MS 内生效
const USER_STATE_CACHE_TTL_MS = 15 * 1000;
/** @type {Map<number, { isBanned: boolean, isDeleted: boolean, checkedAt: number }>} */
const userStateCache = new Map();

async function loadUserState(userId) {
  const cached = userStateCache.get(userId);
  if (cached && Date.now() - cached.checkedAt < USER_STATE_CACHE_TTL_MS) {
    return cached;
  }
  const row = await db.queryOne('SELECT is_banned, deleted_at FROM users WHERE id = ?', [userId]);
  let state = null;
  if (row) {
    state = {
      isBanned: row.is_banned === 1 || row.is_banned === true,
      isDeleted: Boolean(row.deleted_at),
      checkedAt: Date.now(),
    };
  }
  userStateCache.set(userId, state);
  return state;
}

async function assertActiveUser(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw Object.assign(new Error('无效的登录凭证'), { statusCode: 401 });
  }
  assertTrialAccess(id);
  const state = await loadUserState(id);
  if (!state) throw Object.assign(new Error('账号不存在，请重新登录'), { statusCode: 401 });
  if (state.isDeleted) throw Object.assign(new Error('账号已注销，请重新登录'), { statusCode: 401 });
  if (state.isBanned) throw Object.assign(new Error('账号已被封禁，请联系客服'), { statusCode: 403 });
}

/**
 * JWT authentication middleware for mini-program users.
 * Reads token from Authorization: Bearer <token> header.
 * Attaches decoded user payload to req.user (containing { userId, openid }).
 * Re-validates ban status against the database (short cache): banned users
 * get 403 even with a valid token.
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(fail('未登录，请先授权', 401));
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(fail('登录已过期，请重新授权', 401));
    }
    return res.status(401).json(fail('无效的登录凭证', 401));
  }

  if (!decoded.userId) {
    return res.status(401).json(fail('无效的登录凭证', 401));
  }

  try {
    await assertActiveUser(decoded.userId);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      return res.status(err.statusCode).json(fail(err.message, err.statusCode));
    }
    console.error('[Auth] loadUserState error:', err.message);
    return res.status(500).json(fail('服务开小差了，请稍后重试', 500));
  }
}

module.exports = authMiddleware;
module.exports.assertActiveUser = assertActiveUser;
module.exports.__private = {
  userStateCache,
  loadUserState,
  USER_STATE_CACHE_TTL_MS,
  invalidateUserState(userId) {
    userStateCache.delete(Number(userId));
  },
};
