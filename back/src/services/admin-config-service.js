const db = require('../models/db');
const { mapConfig } = require('../utils/admin-presenters');
const config = require('../config');
const { CONFIG_DEFINITIONS, CONFIG_DEFINITION_MAP } = require('../config/system-config-definitions');

const CAPABILITY_FIELDS = {
  login: ['wechat.login_app_id', 'wechat.login_secret', 'wechat.login_agreement_url', 'wechat.login_privacy_url'],
  share: ['wechat.share_title', 'wechat.share_path', 'wechat.share_image_url', 'wechat.share_timeline_title'],
  payment: ['wechat.pay_mch_id', 'wechat.pay_api_v3_key', 'wechat.pay_notify_url', 'wechat.pay_goods_desc'],
};

async function ensureSystemConfigTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS system_configs (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '配置ID',
      config_key VARCHAR(128) NOT NULL COMMENT '配置键',
      config_value TEXT NOT NULL COMMENT '配置值',
      description VARCHAR(255) DEFAULT '' COMMENT '配置说明',
      updated_by INT UNSIGNED DEFAULT 0 COMMENT '最后修改人ID',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_config_key (config_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表'
  `);
}

async function ensureDefaultConfigs() {
  await ensureSystemConfigTable();
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

function normalizeConfigValue(value, definition) {
  if (!definition) {
    return String(value ?? '');
  }
  if (definition.valueType === 'boolean') {
    return normalizeBooleanString(value, false) ? 'true' : 'false';
  }
  if (definition.valueType === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(Math.max(0, parsed)) : String(definition.defaultValue || '0');
  }
  return String(value ?? '').trim();
}

function hasValue(value, definition) {
  if (definition && definition.valueType === 'boolean') {
    return normalizeBooleanString(value, false);
  }
  return String(value ?? '').trim() !== '';
}

async function getConfigMap(keys = null) {
  await ensureDefaultConfigs();
  const targetKeys = Array.isArray(keys) && keys.length > 0
    ? keys
    : CONFIG_DEFINITIONS.map((item) => item.key);
  const placeholders = targetKeys.map(() => '?').join(', ');
  const rows = await db.queryAll(
    `SELECT config_key, config_value FROM system_configs WHERE config_key IN (${placeholders})`,
    targetKeys
  );
  const configMap = {};
  for (const row of rows) {
    configMap[row.config_key] = row.config_value;
  }
  for (const key of targetKeys) {
    if (configMap[key] === undefined) {
      const definition = CONFIG_DEFINITION_MAP[key];
      configMap[key] = definition ? definition.defaultValue : '';
    }
  }
  return configMap;
}

function buildCapabilitySummary(configMap, capabilityKey, enabledKey, requiredKeys) {
  const enabledDefinition = CONFIG_DEFINITION_MAP[enabledKey];
  const enabled = hasValue(configMap[enabledKey], enabledDefinition);
  const missingKeys = requiredKeys.filter((key) => !hasValue(configMap[key], CONFIG_DEFINITION_MAP[key]));
  const readyCount = requiredKeys.length - missingKeys.length;

  return {
    capability: capabilityKey,
    enabled,
    enabledKey,
    requiredKeys,
    missingKeys,
    readyCount,
    requiredCount: requiredKeys.length,
    isReady: enabled && missingKeys.length === 0,
  };
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
  const normalizedValue = normalizeConfigValue(value, definition);
  await db.execute(
    `INSERT INTO system_configs (config_key, config_value, description, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = VALUES(description), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [key, normalizedValue, definition ? definition.description : '', adminId]
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
  const publicKeys = CONFIG_DEFINITIONS
    .filter((item) => item.isPublic)
    .map((item) => item.key);
  const configMap = await getConfigMap(publicKeys);

  return {
    configs: configMap,
    features: {
      maintenance: {
        enabled: normalizeBooleanString(await getConfig('system.maintenance_mode'), false),
        message: String(await getConfig('system.maintenance_message') || '').trim(),
      },
      wechat: {
        loginEnabled: normalizeBooleanString(configMap['wechat.login_enabled'], true),
        shareEnabled: normalizeBooleanString(configMap['wechat.share_enabled'], true),
        payEnabled: normalizeBooleanString(configMap['wechat.pay_enabled'], false),
      },
    },
  };
}

async function getWechatLoginSettings() {
  const [enabledValue, appIdValue, secretValue, tokenTtlValue] = await Promise.all([
    getConfig('wechat.login_enabled'),
    getConfig('wechat.login_app_id'),
    getConfig('wechat.login_secret'),
    getConfig('wechat.login_token_ttl'),
  ]);

  return {
    enabled: normalizeBooleanString(enabledValue, true),
    appId: String(appIdValue || config.wx.appId || '').trim(),
    secret: String(secretValue || config.wx.secret || '').trim(),
    tokenTtl: String(tokenTtlValue || config.jwt.expiresIn || '').trim() || config.jwt.expiresIn,
  };
}

async function getAdminConfigSummary() {
  const keys = CONFIG_DEFINITIONS.map((item) => item.key);
  const configMap = await getConfigMap(keys);

  return {
    totalConfigs: keys.length,
    publicConfigCount: CONFIG_DEFINITIONS.filter((item) => item.isPublic).length,
    sensitiveConfigCount: CONFIG_DEFINITIONS.filter((item) => item.isSensitive).length,
    capabilities: {
      login: buildCapabilitySummary(configMap, 'login', 'wechat.login_enabled', CAPABILITY_FIELDS.login),
      share: buildCapabilitySummary(configMap, 'share', 'wechat.share_enabled', CAPABILITY_FIELDS.share),
      payment: buildCapabilitySummary(configMap, 'payment', 'wechat.pay_enabled', CAPABILITY_FIELDS.payment),
    },
  };
}

module.exports = {
  getAllConfigs,
  getConfig,
  updateConfig,
  updateConfigs,
  getPublicConfigs,
  getWechatLoginSettings,
  getAdminConfigSummary,
};
