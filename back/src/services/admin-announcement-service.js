const db = require('../models/db');

async function listAnnouncements(status, type, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = await db.queryOne(
    `SELECT COUNT(*) as total FROM announcements ${where}`,
    params
  );
  const records = await db.queryAll(
    `SELECT * FROM announcements ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, String(limit), String(offset)]
  );

  return { records, total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getAnnouncement(id) {
  return db.queryOne('SELECT * FROM announcements WHERE id = ?', [id]);
}

async function createAnnouncement(data, adminId) {
  const { title, content, type = 'system', status = 'draft', priority = 'normal' } = data;

  let publishedAt = null;
  if (status === 'published') {
    publishedAt = new Date();
  }

  const [result] = await db.execute(
    `INSERT INTO announcements (title, content, type, status, priority, created_by, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, content, type, status, priority, adminId, publishedAt]
  );

  return db.queryOne('SELECT * FROM announcements WHERE id = ?', [result.insertId]);
}

async function updateAnnouncement(id, data) {
  const existing = await db.queryOne('SELECT * FROM announcements WHERE id = ?', [id]);
  if (!existing) return null;

  const fields = [];
  const params = [];

  if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title); }
  if (data.content !== undefined) { fields.push('content = ?'); params.push(data.content); }
  if (data.type !== undefined) { fields.push('type = ?'); params.push(data.type); }
  if (data.status !== undefined) { fields.push('status = ?'); params.push(data.status); }
  if (data.priority !== undefined) { fields.push('priority = ?'); params.push(data.priority); }

  if (data.status === 'published' && existing.status !== 'published') {
    fields.push('published_at = NOW()');
  }

  if (fields.length === 0) return existing;

  params.push(id);
  await db.execute(
    `UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  return db.queryOne('SELECT * FROM announcements WHERE id = ?', [id]);
}

async function deleteAnnouncement(id) {
  const [result] = await db.execute('DELETE FROM announcements WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

async function publishAnnouncement(id) {
  await db.execute(
    "UPDATE announcements SET status = 'published', published_at = NOW() WHERE id = ?",
    [id]
  );
  return db.queryOne('SELECT * FROM announcements WHERE id = ?', [id]);
}

async function archiveAnnouncement(id) {
  await db.execute(
    "UPDATE announcements SET status = 'archived' WHERE id = ?",
    [id]
  );
  return db.queryOne('SELECT * FROM announcements WHERE id = ?', [id]);
}

module.exports = {
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
};
