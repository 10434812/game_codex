const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../models/db');
const config = require('../../config');
const { success, fail } = require('../../utils/response');
const { adminLoginRateLimit } = require('../../middleware/rate-limiter');
const { logOperation } = require('../../middleware/operation-logger');

const router = express.Router();

// 登录爆破防护：同一 IP / IP+用户名 15 分钟内失败 5 次锁定 30 分钟（内存级）
const loginRateLimit = adminLoginRateLimit({
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 30 * 60 * 1000,
});

/**
 * 安全说明：
 * - 不再支持「admins 表为空时用 .env 默认凭据自动创建管理员」（原 ensureBootstrapAdmin 已删除）。
 * - 首次初始化必须显式创建：在服务器上执行 `node scripts/create-admin.js`（生成随机密码并打印一次）。
 * - 管理员 token 使用独立密钥 ADMIN_JWT_SECRET，与用户端 JWT_SECRET 分离。
 */
router.post('/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json(fail('请输入用户名和密码', 400));
    }

    const admin = await db.queryOne(
      'SELECT id, username, password_hash, role, is_active FROM admins WHERE username = ?',
      [username]
    );

    if (!admin) {
      // 输出初始化指引：admins 表为空时不再自举建号
      const count = await db.queryOne('SELECT COUNT(*) AS total FROM admins');
      if (count && Number(count.total) === 0) {
        return res.status(403).json(
          fail('管理后台尚未初始化，请在服务器执行 node scripts/create-admin.js 创建管理员', 403)
        );
      }
      return res.status(401).json(fail('用户名或密码错误', 401));
    }

    if (!admin.is_active) {
      return res.status(403).json(fail('该管理员账号已被禁用', 403));
    }

    const passwordMatch = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatch) {
      await logOperation({ id: admin.id, username: admin.username, role: admin.role }, 'login_failed', 'admin', admin.id, { reason: 'bad_password' }, req.ip);
      return res.status(401).json(fail('用户名或密码错误', 401));
    }

    const token = jwt.sign(
      { adminId: admin.id, username: admin.username, role: admin.role },
      config.jwt.adminSecret,
      { expiresIn: config.jwt.expiresIn }
    );

    await db.execute('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
    await logOperation({ id: admin.id, username: admin.username, role: admin.role }, 'login', 'admin', admin.id, {}, req.ip);

    res.json(
      success(
        {
          token,
          admin: {
            id: admin.id,
            username: admin.username,
            role: admin.role,
          },
        },
        '登录成功'
      )
    );
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json(fail('登录失败，请稍后重试', 500));
  }
});

module.exports = router;
