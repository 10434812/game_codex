const db = require('../models/db');

/**
 * Log an admin operation to the operation_logs table.
 * @param {Object} admin - req.admin object {adminId, username}
 * @param {string} action - Operation type (create/update/delete/ban/login/etc)
 * @param {string} targetType - Target type (user/item/game/room/admin/config/announcement)
 * @param {string|number} targetId - Target record ID
 * @param {Object} [detail] - Optional detail data (will be JSON stringified)
 * @param {string} [ipAddress=''] - Client IP address
 */
async function logOperation(admin, action, targetType, targetId, detail, ipAddress = '') {
  try {
    await db.execute(
      'INSERT INTO operation_logs (admin_id, admin_name, action, target_type, target_id, detail, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        admin.adminId,
        admin.username || 'unknown',
        action,
        targetType,
        String(targetId || ''),
        detail ? JSON.stringify(detail) : null,
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
 * @returns {Function} Express middleware
 */
function operationLogger(action, targetType, getId) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400 && req.admin) {
        const targetId = getId ? getId(req) : req.params.id || req.body?.id || '';
        const detail = { body: req.body, params: req.params, query: req.query };
        logOperation(req.admin, action, targetType, targetId, detail, req.ip);
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { logOperation, operationLogger };
