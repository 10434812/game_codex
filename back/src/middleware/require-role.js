const { fail } = require('../utils/response');
const { CONFIG_DEFINITION_MAP } = require('../config/system-config-definitions');

/**
 * RBAC 角色校验中间件工厂。
 * 用法：router.use('/admins', adminAuth, requireRole('super'), subRouter)
 *
 * @param {...string} roles 允许访问的角色（如 'super'）
 */
function requireRole(...roles) {
  const allowed = new Set(roles);
  return function requireRoleMiddleware(req, res, next) {
    if (!req.admin) {
      return res.status(401).json(fail('请先登录管理后台', 401));
    }
    if (!allowed.has(req.admin.role)) {
      return res.status(403).json(fail('无权限执行该操作（仅限超级管理员）', 403));
    }
    next();
  };
}

/** 敏感配置字段（例如 AppSecret）的统一脱敏占位。 */
const SENSITIVE_MASK = '******';

function isSensitiveConfigKey(key) {
  const definition = CONFIG_DEFINITION_MAP[key];
  return !!(definition && definition.isSensitive);
}

/**
 * 配置读取响应脱敏中间件：normal 角色读取配置时，敏感字段值替换为 ******。
 * 必须挂在 adminAuth 之前（在 res.json 被调用时 req.admin 已就绪）。
 * 仅拦截 GET 响应（success 列表或单个 {key, value} 两种形态）。
 */
function maskSensitiveConfigForNormal() {
  return function maskSensitiveConfigMiddleware(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function maskedJson(body) {
      const isRead = req.method === 'GET' || req.method === 'HEAD';
      const isNormal = !req.admin || req.admin.role !== 'super';
      if (isRead && isNormal && body && body.code === 0 && body.data !== null && body.data !== undefined) {
        if (Array.isArray(body.data)) {
          body.data = body.data.map((item) => (
            item && item.isSensitive ? { ...item, value: SENSITIVE_MASK } : item
          ));
        } else if (typeof body.data === 'object' && body.data.key !== undefined) {
          if (isSensitiveConfigKey(body.data.key) && body.data.value !== undefined) {
            body.data.value = SENSITIVE_MASK;
          }
        }
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = {
  requireRole,
  maskSensitiveConfigForNormal,
  SENSITIVE_MASK,
};
