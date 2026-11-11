const db = require('../models/db');

// Keys whose values must never be stored in operation_logs in plain form
// (passwords, API secrets, ...).
const SENSITIVE_KEY_PATTERN = /password|secret|api[_-]?key|private[_-]?key|token|sign|key\b/i;

const MAX_DETAIL_LENGTH = 4000;

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERN.test(String(key || ''));
}

/**
 * Recursively mask sensitive values and truncate oversized payloads so the
 * audit log keeps a parameter summary without leaking secrets.
 * @param {*} value
 * @param {number} depth
 * @returns {*} sanitized copy
 */
function sanitizeDetail(value, depth = 0) {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDetail(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = '***';
      } else {
        out[key] = sanitizeDetail(item, depth + 1);
      }
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 200) {
    return value.slice(0, 200) + '...(truncated)';
  }

  return value;
}

/**
 * Log an admin operation to the operation_logs table.
 * @param {Object} admin - req.admin object {adminId, username}
 * @param {string} action - Operation type (create/update/delete/ban/login/etc)
 * @param {string} targetType - Target type (user/item/game/room/admin/config/announcement)
 * @param {string|number} targetId - Target record ID
 * @param {Object} [detail] - Optional detail data (will be JSON stringified; sensitive keys auto-masked)
 * @param {string} [ipAddress=''] - Client IP address
 */
async function logOperation(admin, action, targetType, targetId, detail, ipAddress = '') {
  try {
    let detailText = null;
    if (detail !== undefined && detail !== null) {
      const sanitized = sanitizeDetail(detail);
      detailText = JSON.stringify(sanitized);
      if (detailText.length > MAX_DETAIL_LENGTH) {
        detailText = detailText.slice(0, MAX_DETAIL_LENGTH) + '...(truncated)';
      }
    }
    await db.execute(
      'INSERT INTO operation_logs (admin_id, admin_name, action, target_type, target_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        admin.adminId,
        admin.username || 'unknown',
        action,
        targetType,
        String(targetId || ''),
        detailText,
        ipAddress
      ]
    );
  } catch (err) {
    console.error('[OperationLogger] Failed to log operation:', err.message);
  }
}

/**
 * Express middleware factory that automatically logs operations.
 * Use: router.delete('/:id', adminAuth, operationLogger('delete', 'user'), handler)
 *
 * @param {string} action - Operation action name
 * @param {string} targetType - Target type name
 * @param {Function} [getId] - Optional function to extract target ID from req
 * @param {Function} [summarize] - Optional function (req) => object; when given,
 *   its result is used as the detail instead of {body, params, query}.
 * @returns {Function} Express middleware
 */
function operationLogger(action, targetType, getId, summarize) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400 && req.admin) {
        const targetId = getId ? getId(req) : req.params.id || req.body?.id || '';
        const detail = summarize
          ? summarize(req)
          : { body: req.body, params: req.params, query: req.query };
        logOperation(req.admin, action, targetType, targetId, detail, req.ip);
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { logOperation, operationLogger };
