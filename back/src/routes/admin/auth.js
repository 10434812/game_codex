const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../models/db');
const config = require('../../config');
const { success, fail } = require('../../utils/response');

const router = express.Router();
const SALT_ROUNDS = 10;

async function ensureBootstrapAdmin(username, password) {
  const count = await db.queryOne('SELECT COUNT(*) as total FROM admins');
  if ((count?.total || 0) > 0) return;
  if (!config.admin.password) return;
  if (username !== config.admin.username || password !== config.admin.password) return;

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  await db.execute(
    'INSERT INTO admins (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)',
    [username, passwordHash, 'super']
  );
}

// POST /api/admin/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json(fail('请输入用户名和密码', 400));
    }

    await ensureBootstrapAdmin(username, password);

    const admin = await db.queryOne(
      'SELECT id, username, password_hash, role, is_active FROM admins WHERE username = ?',
      [username]
    );

    if (!admin) {
      return res.status(401).json(fail('用户名或密码错误', 401));
    }

    if (!admin.is_active) {
      return res.status(403).json(fail('该管理员账号已被禁用', 403));
    }

    const passwordMatch = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatch) {
      return res.status(401).json(fail('用户名或密码错误', 401));
    }

    const token = jwt.sign(
      { adminId: admin.id, username: admin.username, role: admin.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    await db.execute('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);

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
