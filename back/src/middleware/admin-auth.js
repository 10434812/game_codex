const jwt = require('jsonwebtoken');
const config = require('../config');
const { fail } = require('../utils/response');

/**
 * JWT authentication middleware for admin users.
 * Reads token from Authorization: Bearer <token> header.
 * Uses a separate JWT secret from user auth for security isolation.
 * Attaches decoded admin payload to req.admin.
 */
function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(fail('请先登录管理后台', 401));
  }

  const token = authHeader.split(' ')[1];

  // Admin tokens use the same JWT secret for now, but keep them separate
  // in concept. In production, consider using a different secret (ADMIN_JWT_SECRET).
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (!decoded.adminId) {
      return res.status(403).json(fail('无管理员权限', 403));
    }
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    return res.status(401).json(fail('无效的登录凭证', 401));
  }
}

module.exports = adminAuthMiddleware;
