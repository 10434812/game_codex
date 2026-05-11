/**
 * Unified API response helpers.
 * All endpoints return { code: number, message: string, data: any }
 */

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
 */
function fail(message = 'error', code = 400) {
  return { code, message, data: null };
}

module.exports = { success, fail };
