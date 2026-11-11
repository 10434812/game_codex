const express = require('express');
const adminAuth = require('../../middleware/admin-auth');
const { requireRole, maskSensitiveConfigForNormal } = require('../../middleware/require-role');

const router = express.Router();

/**
 * RBAC 挂载说明：
 * - /admins：管理员管理（增删改/重置密码）仅 super 可访问（读+写）。
 * - /configs：写（PUT 批量/单个）仅 super；读（GET）normal 可见但敏感字段脱敏。
 * - /users/:id/coins：金币调整仅 super。
 * - 其余业务路由（users/items/games/rooms/announcements/logs/dashboard/stats/fortune）normal 可访问。
 */

// ── 敏感写路径守卫：金币调整仅 super ───────────────────────
router.use('/users/:id/coins', adminAuth, requireRole('super'), (_req, _res, next) => next());

// ── 配置：写仅 super，读对 normal 脱敏 ─────────────────────
const configWriteGuard = express.Router();
configWriteGuard.put('/', adminAuth, requireRole('super'), (_req, _res, next) => next());
configWriteGuard.put('/:key', adminAuth, requireRole('super'), (_req, _res, next) => next());
router.use('/configs', configWriteGuard);
router.use('/configs', maskSensitiveConfigForNormal());

// ── 普通业务模块挂载（各模块内部自行 adminAuth）────────────
const modules = [
  'auth',
  'dashboard',
  'users',
  'items',
  'games',
  'stats',
  'rooms',
  'announcements',
  'logs',
  'fortune',
];

for (const name of modules) {
  try {
    router.use('/' + name, require('./' + name));
  } catch (e) {
    console.warn(`[AdminRoutes] Skipped /admin/${name} (${e.message})`);
  }
}

// ── 管理员管理：整体仅 super（放在最后，避免被其他模块吞掉）──
router.use('/admins', adminAuth, requireRole('super'), require('./admins'));
router.use('/configs', require('./configs'));

module.exports = router;
