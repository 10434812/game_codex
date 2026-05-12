const db = require('../models/db');
const { mapLog } = require('../utils/admin-presenters');

async function listLogs(filters = {}, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (filters.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }
  if (filters.targetType) {
    conditions.push('target_type = ?');
    params.push(filters.targetType);
  }
  if (filters.adminId) {
    conditions.push('admin_id = ?');
    params.push(filters.adminId);
  }
  if (filters.adminQuery) {
    const query = String(filters.adminQuery).trim();
    const numericId = Number(query);
    if (Number.isFinite(numericId) && query !== '') {
      conditions.push('(admin_id = ? OR admin_name LIKE ?)');
      params.push(numericId, `%${query}%`);
    } else if (query) {
      conditions.push('admin_name LIKE ?');
      params.push(`%${query}%`);
    }
  }
  if (filters.dateFrom) {
    conditions.push('created_at >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('created_at <= ?');
    params.push(filters.dateTo);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const total = await db.queryOne(
    `SELECT COUNT(*) as total FROM operation_logs ${where}`,
    params
  );
  const records = await db.queryAll(
    `SELECT * FROM operation_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, String(limit), String(offset)]
  );

  return { records: records.map(mapLog), total: total?.total || 0, page: Number(page), limit: Number(limit) };
}

async function getLog(id) {
  const log = await db.queryOne('SELECT * FROM operation_logs WHERE id = ?', [id]);
  return mapLog(log);
}

async function getLogStats() {
  const [actionCounts, dailyCounts] = await Promise.all([
    db.queryAll(
      'SELECT action, COUNT(*) as count FROM operation_logs GROUP BY action ORDER BY count DESC'
    ),
    db.queryAll(
      "SELECT DATE(created_at) as date, COUNT(*) as count FROM operation_logs GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30"
    ),
  ]);

  return {
    total: actionCounts.reduce((sum, item) => sum + Number(item.count || 0), 0),
    distribution: actionCounts,
    actionCounts,
    dailyCounts,
  };
}

module.exports = {
  listLogs,
  getLog,
  getLogStats,
};
