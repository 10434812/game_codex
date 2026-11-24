const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');
const { fail } = require('../utils/response');

/**
 * JWT authentication middleware for admin users.
 * Reads token from Authorization: Bearer <token> header.
 * Uses a separate admin JWT secret (ADMIN_JWT_SECRET) from user auth.
 * Reads account state on each request so password changes revoke old tokens immediately.
 * Attaches { adminId, username, role } to req.admin (role from DB, not token).
 */
async function adminAuthMiddleware(req, res, next) {
  // Parent and child routers may both mount this middleware.
  if (req.admin) return next();
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
    const state = await db.queryOne(
      'SELECT username, role, is_active, session_version FROM admins WHERE id = ?',
      [decoded.adminId]
    );
    if (!state || !state.is_active) {
      return res.status(403).json(fail('该管理员账号已被停用，请联系超级管理员', 403));
    }
    if (!Number.isInteger(decoded.sessionVersion) || decoded.sessionVersion !== state.session_version) {
      return res.status(401).json(fail('登录凭证已失效，请重新登录', 401));
    }
    req.admin = {
      adminId: decoded.adminId,
      username: state.username,
      role: state.role,
    };
    next();
  } catch (err) {
    console.error('[AdminAuth] account lookup failed:', err.message);
    return res.status(500).json(fail('服务开小差了，请稍后重试', 500));
  }
}

module.exports = adminAuthMiddleware;
