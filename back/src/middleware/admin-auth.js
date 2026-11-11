const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');
const { fail } = require('../utils/response');

// 管理员状态短缓存：避免每个请求都查库；停用/删号在 CACHE_TTL_MS 内生效
const ADMIN_STATE_CACHE_TTL_MS = 30 * 1000;
/** @type {Map<number, { username: string, role: string, isActive: boolean, checkedAt: number }>} */
const adminStateCache = new Map();

/**
 * 查询管理员最新状态（is_active / role），带短 TTL 缓存。
 * token 与数据库状态一致性：停用/删除/改角色后最多 CACHE_TTL_MS 内失效。
 */
async function loadAdminState(adminId) {
  const cached = adminStateCache.get(adminId);
  if (cached && Date.now() - cached.checkedAt < ADMIN_STATE_CACHE_TTL_MS) {
    return cached;
  }
  const row = await db.queryOne(
    'SELECT id, username, role, is_active FROM admins WHERE id = ?',
    [adminId]
  );
  let state = null;
  if (row) {
    state = {
      username: row.username,
      role: row.role,
      isActive: row.is_active === 1 || row.is_active === true,
      checkedAt: Date.now(),
    };
  }
  adminStateCache.set(adminId, state);
  return state;
}

/**
 * JWT authentication middleware for admin users.
 * Reads token from Authorization: Bearer <token> header.
 * Uses a separate admin JWT secret (ADMIN_JWT_SECRET) from user auth.
 * Each request re-validates the admin against the database (short cache)
 * so disabled/deleted admins lose access promptly.
 * Attaches { adminId, username, role } to req.admin (role from DB, not token).
 */
async function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(fail('请先登录管理后台', 401));
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.adminSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    return res.status(401).json(fail('无效的登录凭证', 401));
  }

  if (!decoded.adminId) {
    return res.status(403).json(fail('无管理员权限', 403));
  }

  try {
    const state = await loadAdminState(decoded.adminId);
    if (!state || !state.isActive) {
      return res.status(403).json(fail('该管理员账号已被停用，请联系超级管理员', 403));
    }
    // 角色以数据库为准（角色变更在缓存 TTL 内生效），username 同步数据库值
    req.admin = {
      adminId: decoded.adminId,
      username: state.username || decoded.username || '',
      role: state.role || decoded.role || 'normal',
    };
    next();
  } catch (err) {
    console.error('[AdminAuth] loadAdminState error:', err.message);
    return res.status(500).json(fail('服务开小差了，请稍后重试', 500));
  }
}

module.exports = adminAuthMiddleware;
module.exports.__private = {
  adminStateCache,
  loadAdminState,
  ADMIN_STATE_CACHE_TTL_MS,
};
