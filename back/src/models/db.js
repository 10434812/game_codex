const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

/**
 * Execute a raw SQL query with parameters.
 * @param {string} sql - SQL statement with ? placeholders
 * @param {Array} params - Query parameters
 * @returns {Promise<[rows, fields]>}
 */
async function execute(sql, params = []) {
  const [rows, fields] = await pool.execute(sql, params);
  return [rows, fields];
}

/**
 * Query helper: returns a single row or null.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<Object|null>}
 */
async function queryOne(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Query helper: returns all matching rows.
 * @param {string} sql
 * @param {Array} params
 * @returns {Promise<Array>}
 */
async function queryAll(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = {
  pool,
  execute,
  queryOne,
  queryAll,
};
