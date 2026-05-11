const jwt = require('jsonwebtoken');
const config = require('../config');
const { fail } = require('../utils/response');

/**
 * JWT authentication middleware for mini-program users.
 * Reads token from Authorization: Bearer <token> header.
 * Attaches decoded user payload to req.user (containing { userId, openid }).
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(fail('未登录，请先授权', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json(fail('登录已过期，请重新授权', 401));
    }
    return res.status(401).json(fail('无效的登录凭证', 401));
  }
}

module.exports = authMiddleware;
