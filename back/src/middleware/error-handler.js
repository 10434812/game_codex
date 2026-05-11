const { fail } = require('../utils/response');
const config = require('../config');

/**
 * Express global error handler middleware.
 * Must have 4 parameters for Express to recognize it as error handler.
 */
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (config.nodeEnv === 'development') {
    console.error('[ErrorHandler]', err);
  }

  res.status(statusCode).json(fail(message, statusCode));
}

module.exports = errorHandler;
