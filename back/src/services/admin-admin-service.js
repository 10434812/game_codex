const bcrypt = require('bcryptjs');
const db = require('../models/db');

const SALT_ROUNDS = 10;

async function listAdmins(page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const total = await db.queryOne('SELECT COUNT(*) as total FROM admins', []);
  const records = await db.queryAll(
    'SELECT id, username, role, is_active, last_login_at, created_at FROM admins ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [String(limit), String(offset)]
  );
  return { records, total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getAdmin(id) {
  return db.queryOne(
    'SELECT id, username, role, is_active, last_login_at, created_at FROM admins WHERE id = ?',
    [id]
  );
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

  return db.queryOne(
    'SELECT id, username, role, is_active, last_login_at, created_at FROM admins WHERE id = ?',
    [result.insertId]
  );
}

async function updateAdmin(id, updates) {
  const allowedFields = ['role', 'is_active'];
  const setClauses = [];
  const params = [];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(updates[field]);
    }
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
