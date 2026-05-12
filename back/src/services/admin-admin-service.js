const bcrypt = require('bcryptjs');
const db = require('../models/db');
const { mapAdmin } = require('../utils/admin-presenters');

const SALT_ROUNDS = 10;

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
  const existing = await db.queryOne('SELECT id FROM admins WHERE username = ?', [username]);
  if (existing) {
    throw new Error('用户名已存在');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [result] = await db.execute(
    'INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?)',
    [username, passwordHash, role || 'normal']
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
    const nextActive = updates.isBanned !== undefined
      ? !updates.isBanned
      : (updates.is_active !== undefined ? updates.is_active : updates.isActive);
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
  await db.execute('UPDATE admins SET is_active = 0 WHERE id = ?', [id]);
  return { deleted: true };
}

async function resetPassword(id, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.execute('UPDATE admins SET password_hash = ? WHERE id = ?', [passwordHash, id]);
  return { reset: true };
}

module.exports = { listAdmins, getAdmin, createAdmin, updateAdmin, deleteAdmin, resetPassword };
