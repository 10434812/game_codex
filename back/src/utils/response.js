const config = require('../config');

/**
 * Unified API response helpers.
 * All endpoints return { code: number, message: string, data: any }
 */

const GENERIC_SERVER_ERROR = '服务开小差了，请稍后重试';

/**
 * Success response.
 * @param {*} data - Response payload
 * @param {string} message - Status message
 * @returns {{ code: 0, message: string, data: * }}
 */
function success(data = null, message = 'ok') {
  return { code: 0, message, data };
}

/**
 * Error/fail response.
 * @param {string} message - Error message
 * @param {number} code - HTTP status code (default 400)
 * @returns {{ code: number, message: string, data: null }}
 *
 * 生产环境安全策略：5xx 响应统一使用通用文案，避免把数据库报错原文/
 * 堆栈等内部细节回传客户端；4xx 业务错误保留受控文案。
 */
function fail(message = 'error', code = 400) {
  const safeCode = Number(code) || 400;
  const safeMessage = safeCode >= 500 && config.nodeEnv === 'production'
    ? GENERIC_SERVER_ERROR
    : message;
  return { code: safeCode, message: safeMessage, data: null };
}

module.exports = { success, fail };
