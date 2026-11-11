const { fail } = require('../utils/response');
const config = require('../config');

const GENERIC_SERVER_ERROR = '服务开小差了，请稍后重试';

/**
 * Express global error handler middleware.
 * Must have 4 parameters for Express to recognize it as error handler.
 *
 * 生产环境安全策略：
 * - 5xx（服务器内部错误）统一返回通用文案，堆栈/内部细节只进服务端日志；
 * - 4xx（业务可控错误，携带显式 statusCode）保留受控文案。
 */
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;

  // 服务端日志始终记录完整错误（生产只记录 5xx，开发记录全部）
  if (statusCode >= 500 || config.nodeEnv !== 'production') {
    console.error('[ErrorHandler]', err);
  }

  const message = statusCode >= 500 && config.nodeEnv === 'production'
    ? GENERIC_SERVER_ERROR
    : (err.message || 'Internal Server Error');

  res.status(statusCode).json(fail(message, statusCode));
}

module.exports = errorHandler;
