const db = require('../models/db');
const { mapConfig } = require('../utils/admin-presenters');
const config = require('../config');
const { CONFIG_DEFINITIONS, CONFIG_DEFINITION_MAP } = require('../config/system-config-definitions');

const CONFIG_EXPORT_SCHEMA_VERSION = 1;
const CAPABILITY_FIELDS = {
  login: ['wechat.login_app_id', 'wechat.login_secret', 'wechat.login_agreement_url', 'wechat.login_privacy_url'],
  minigameLogin: ['wechat.minigame_app_id', 'wechat.minigame_secret', 'wechat.login_agreement_url', 'wechat.login_privacy_url'],
  share: ['wechat.share_title', 'wechat.share_path', 'wechat.share_image_url', 'wechat.share_timeline_title'],
  fortune: ['fortune.reality_enabled', 'fortune.public_signal_limit', 'fortune.refresh_interval_seconds'],
  aiDigest: ['ai.base_url', 'ai.api_key', 'ai.model'],
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

let ensureDefaultsPromise = null;

async function ensureDefaultConfigs() {
  if (!ensureDefaultsPromise) {
    ensureDefaultsPromise = (async () => {
      await ensureSystemConfigTable();
      for (const item of CONFIG_DEFINITIONS) {
        await db.execute(
          `INSERT INTO system_configs (config_key, config_value, description, updated_at)
           VALUES (?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE description = VALUES(description)`,
          [item.key, item.defaultValue, item.description]
        );
      }
    })().catch((err) => {
      ensureDefaultsPromise = null;
      throw err;
    });
  }
  return ensureDefaultsPromise;
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
    const mapped = mapConfig(row, definition);
    return {...mapped, restartRequired: !!(definition && definition.restartRequired)};
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
  return writeConfig(db, key, value, adminId);
}

async function writeConfig(connection, key, value, adminId) {
  const definition = CONFIG_DEFINITION_MAP[key];
  const normalizedValue = normalizeConfigValue(value, definition);
  await connection.execute(
    `INSERT INTO system_configs (config_key, config_value, description, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = VALUES(description), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [key, normalizedValue, definition ? definition.description : '', adminId]
  );

  const [[row]] = await connection.execute('SELECT * FROM system_configs WHERE config_key = ?', [key]);
  return mapConfig(row, definition);
}

async function updateConfigs(configs, adminId) {
  if (configs.length === 0) return [];
  const connection = await db.pool.getConnection();
  try {
    await connection.beginTransaction();
    const results = [];
    for (const { key, value } of configs) {
      results.push(await writeConfig(connection, key, value, adminId));
    }
    await connection.commit();
    return results;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

function normalizeImportPayload(payload) {
  const source = payload && typeof payload === 'object' && payload.configs !== undefined
    ? payload.configs
    : payload;

  if (Array.isArray(source)) {
    return source.map((item) => ({
      key: item && item.key,
      value: item && item.value,
    }));
  }

  if (source && typeof source === 'object') {
    return Object.entries(source).map(([key, value]) => ({ key, value }));
  }

  throw new Error('CONFIG_IMPORT_PAYLOAD_INVALID');
}

function prepareImportConfigs(payload) {
  const incoming = normalizeImportPayload(payload);
  const skipped = [];
  const deduped = new Map();

  for (const item of incoming) {
    const key = String(item.key || '').trim();
    if (!key || !CONFIG_DEFINITION_MAP[key]) {
      skipped.push({ key: key || '', reason: 'unknown_config_key' });
      continue;
    }
    deduped.set(key, {
      key,
      value: normalizeConfigValue(item.value, CONFIG_DEFINITION_MAP[key]),
    });
  }

  const configs = Array.from(deduped.values());
  if (configs.length === 0) {
    throw new Error('CONFIG_IMPORT_EMPTY');
  }

  return { configs, skipped };
}

async function exportConfigs() {
  const configs = await getAllConfigs();
  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    app: 'game_codex',
    exportedAt: new Date().toISOString(),
    warning: 'This file may contain sensitive server-only secrets. Keep it private.',
    totalConfigs: configs.length,
    configs: configs.map((item) => ({
      key: item.key,
      value: item.value,
      description: item.description,
      valueType: item.valueType,
      group: item.group,
      isPublic: item.isPublic,
      isSensitive: item.isSensitive,
    })),
  };
}

async function importConfigs(payload, adminId) {
  const { configs, skipped } = prepareImportConfigs(payload);
  const imported = await updateConfigs(configs, adminId);

  return {
    importedCount: imported.length,
    skippedCount: skipped.length,
    skipped,
    configs: imported,
  };
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
      },
      fortune: {
        realityEnabled: normalizeBooleanString(configMap['fortune.reality_enabled'], false),
        signalLimit: Number(configMap['fortune.public_signal_limit'] || 6),
      },
    },
  };
}

async function getWechatLoginSettings(client = 'miniprogram') {
  const mini = client === 'minigame';
  const [enabledValue, appIdValue, secretValue, tokenTtlValue] = await Promise.all([
    getConfig('wechat.login_enabled'),
    getConfig(mini ? 'wechat.minigame_app_id' : 'wechat.login_app_id'),
    getConfig(mini ? 'wechat.minigame_secret' : 'wechat.login_secret'),
    getConfig('wechat.login_token_ttl'),
  ]);

  return {
    enabled: normalizeBooleanString(enabledValue, true),
    appId: String(appIdValue || (!mini && config.wx.appId) || '').trim(),
    secret: String(secretValue || (!mini && config.wx.secret) || '').trim(),
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
      minigameLogin: buildCapabilitySummary(configMap, 'minigameLogin', 'wechat.login_enabled', CAPABILITY_FIELDS.minigameLogin),
      share: buildCapabilitySummary(configMap, 'share', 'wechat.share_enabled', CAPABILITY_FIELDS.share),
      fortune: buildCapabilitySummary(configMap, 'fortune', 'fortune.reality_enabled', CAPABILITY_FIELDS.fortune),
      aiDigest: buildCapabilitySummary(configMap, 'aiDigest', 'fortune.ai_digest_enabled', CAPABILITY_FIELDS.aiDigest),
    },
  };
}

module.exports = {
  getAllConfigs,
  getConfig,
  getConfigMap,
  updateConfig,
  updateConfigs,
  getPublicConfigs,
  getWechatLoginSettings,
  getAdminConfigSummary,
  exportConfigs,
  importConfigs,
  __private: {
    normalizeImportPayload,
    prepareImportConfigs,
  },
};
