const bcrypt = require('bcryptjs');
const db = require('../models/db');
const { mapAdmin } = require('../utils/admin-presenters');

const SALT_ROUNDS = 10;
const ADMIN_ROLES = ['super', 'normal'];
const MIN_PASSWORD_LENGTH = 8;

function badRequest(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function assertRole(role) {
  if (!ADMIN_ROLES.includes(role)) throw badRequest('角色只支持 super / normal');
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
}

// 防止超管把自己降级/停用后，后台没有任何启用中的超级管理员而永久锁死。
async function assertNotLastActiveSuper(id) {
  const target = await db.queryOne('SELECT role, is_active FROM admins WHERE id = ?', [id]);
  if (!target || target.role !== 'super' || !target.is_active) return;
  const remaining = await db.queryOne(
    "SELECT COUNT(*) AS total FROM admins WHERE role = 'super' AND is_active = 1 AND id <> ?",
    [id]
  );
  if (!Number(remaining?.total)) throw badRequest('至少需要保留一名启用中的超级管理员', 409);
}

async function listAdmins(page = 1, limit = 20, keyword = '') {
  const offset = (page - 1) * limit;
  let where = '';
  const params = [];
  if (keyword) {
    where = 'WHERE username LIKE ?';
    params.push(`%${keyword}%`);
  }
  const total = await db.queryOne(`SELECT COUNT(*) as total FROM admins ${where}`, params);
  const records = await db.queryAll(
    `SELECT id, username, role, is_active, last_login_at, created_at
     FROM admins ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, String(limit), String(offset)]
  );
  return { records: records.map(mapAdmin), total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getAdmin(id) {
  const admin = await db.queryOne(
    'SELECT id, username, role, is_active, last_login_at, created_at FROM admins WHERE id = ?',
    [id]
  );
  return mapAdmin(admin);
}

async function createAdmin(username, password, role) {
  const finalRole = role || 'normal';
  assertRole(finalRole);
  assertPassword(password);
  const existing = await db.queryOne('SELECT id FROM admins WHERE username = ?', [username]);
  if (existing) {
    throw new Error('用户名已存在');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [result] = await db.execute(
    'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
    [username, passwordHash, finalRole]
  );

  const admin = await db.queryOne(
    'SELECT id, username, role, is_active, last_login_at, created_at FROM admins WHERE id = ?',
    [result.insertId]
  );
  return mapAdmin(admin);
}

async function updateAdmin(id, updates) {
  const setClauses = [];
  const params = [];
  if (updates.role !== undefined) assertRole(updates.role);
  if (updates.password) assertPassword(updates.password);
  const nextActive = updates.isBanned !== undefined
    ? !updates.isBanned
    : (updates.is_active !== undefined ? updates.is_active : updates.isActive);
  const demotes = updates.role !== undefined && updates.role !== 'super';
  const deactivates = (updates.isBanned !== undefined || updates.is_active !== undefined || updates.isActive !== undefined)
    && !nextActive;
  if (demotes || deactivates) await assertNotLastActiveSuper(id);

  if (updates.username !== undefined) {
    const username = String(updates.username).trim();
    if (!username) throw new Error('用户名不能为空');
    const existing = await db.queryOne('SELECT id FROM admins WHERE username = ? AND id <> ?', [username, id]);
    if (existing) throw new Error('用户名已存在');
    setClauses.push('username = ?');
    params.push(username);
  }
  if (updates.role !== undefined) {
    setClauses.push('role = ?');
    params.push(updates.role);
  }
  if (updates.is_active !== undefined || updates.isActive !== undefined || updates.isBanned !== undefined) {
    setClauses.push('is_active = ?');
    params.push(nextActive ? 1 : 0);
  }
  if (updates.password) {
    const passwordHash = await bcrypt.hash(updates.password, SALT_ROUNDS);
    setClauses.push('password_hash = ?');
    params.push(passwordHash);
  }

  if (setClauses.length === 0) return getAdmin(id);

  params.push(id);
  await db.execute(
    `UPDATE admins SET ${setClauses.join(', ')} WHERE id = ?`,
    params
  );

  return getAdmin(id);
}

async function deleteAdmin(id) {
  await assertNotLastActiveSuper(id);
  await db.execute('UPDATE admins SET is_active = 0 WHERE id = ?', [id]);
  return { deleted: true };
}

async function resetPassword(id, newPassword) {
  assertPassword(newPassword);
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.execute('UPDATE admins SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  return { reset: true };
}

module.exports = { listAdmins, getAdmin, createAdmin, updateAdmin, deleteAdmin, resetPassword };
