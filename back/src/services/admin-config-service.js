const db = require('../models/db');
const { mapConfig } = require('../utils/admin-presenters');
const config = require('../config');
const { CONFIG_DEFINITIONS, CONFIG_DEFINITION_MAP } = require('../config/system-config-definitions');

async function ensureDefaultConfigs() {
  for (const item of CONFIG_DEFINITIONS) {
    await db.execute(
      `INSERT INTO system_configs (config_key, config_value, description, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [item.key, item.defaultValue, item.description]
    );
  }
}

function normalizeBooleanString(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

async function getAllConfigs() {
  await ensureDefaultConfigs();
  const rows = await db.queryAll('SELECT * FROM system_configs ORDER BY config_key ASC');
  return rows.map((row) => {
    const definition = CONFIG_DEFINITION_MAP[row.config_key] || null;
    return mapConfig(row, definition);
  });
}

async function getConfig(key) {
  await ensureDefaultConfigs();
  const row = await db.queryOne(
    'SELECT config_value FROM system_configs WHERE config_key = ?',
    [key]
  );
  if (row) return row.config_value;
  const definition = CONFIG_DEFINITION_MAP[key];
  return definition ? definition.defaultValue : null;
}

async function updateConfig(key, value, adminId) {
  const definition = CONFIG_DEFINITION_MAP[key];
  await db.execute(
    `INSERT INTO system_configs (config_key, config_value, description, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = VALUES(description), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [key, value, definition ? definition.description : '', adminId]
  );

  const row = await db.queryOne('SELECT * FROM system_configs WHERE config_key = ?', [key]);
  return mapConfig(row, definition);
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
  await ensureDefaultConfigs();
  const publicKeys = CONFIG_DEFINITIONS
    .filter((item) => item.isPublic)
    .map((item) => item.key);
  if (publicKeys.length === 0) {
    return {};
  }
  const placeholders = publicKeys.map(() => '?').join(', ');
  const rows = await db.queryAll(
    `SELECT config_key, config_value FROM system_configs WHERE config_key IN (${placeholders}) ORDER BY config_key ASC`,
    publicKeys
  );
  const config = {};
  for (const row of rows) {
    config[row.config_key] = row.config_value;
  }
  for (const key of publicKeys) {
    if (config[key] === undefined) {
      config[key] = CONFIG_DEFINITION_MAP[key].defaultValue;
    }
  }
  return config;
}

async function getWechatLoginSettings() {
  const [enabledValue, appIdValue, secretValue] = await Promise.all([
    getConfig('wechat.login_enabled'),
    getConfig('wechat.login_app_id'),
    getConfig('wechat.login_secret'),
  ]);

  return {
    enabled: normalizeBooleanString(enabledValue, true),
    appId: String(appIdValue || config.wx.appId || '').trim(),
    secret: String(secretValue || config.wx.secret || '').trim(),
  };
}

module.exports = {
  getAllConfigs,
  getConfig,
  updateConfig,
  updateConfigs,
  getPublicConfigs,
  getWechatLoginSettings,
};
