const db = require('../models/db');

async function getAllConfigs() {
  return db.queryAll('SELECT * FROM system_configs ORDER BY config_key ASC');
}

async function getConfig(key) {
  const row = await db.queryOne(
    'SELECT config_value FROM system_configs WHERE config_key = ?',
    [key]
  );
  return row ? row.config_value : null;
}

async function updateConfig(key, value, adminId) {
  await db.execute(
    `INSERT INTO system_configs (config_key, config_value, updated_by, updated_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [key, value, adminId]
  );

  return db.queryOne('SELECT * FROM system_configs WHERE config_key = ?', [key]);
}

async function updateConfigs(configs, adminId) {
  const results = [];
  for (const { key, value } of configs) {
    const result = await updateConfig(key, value, adminId);
    results.push(result);
  }
  return results;
}

async function getPublicConfigs() {
  const rows = await db.queryAll(
    "SELECT config_key, config_value FROM system_configs WHERE config_key NOT LIKE 'system.%' ORDER BY config_key ASC"
  );
  const config = {};
  for (const row of rows) {
    config[row.config_key] = row.config_value;
  }
  return config;
}

module.exports = {
  getAllConfigs,
  getConfig,
  updateConfig,
  updateConfigs,
  getPublicConfigs,
};
