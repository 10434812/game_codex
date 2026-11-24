const db = require('../models/db');
const configService = require('./admin-config-service');
const {
  mapFortuneAiReport,
  mapFortuneSnapshot,
  mapFortuneSource,
} = require('../utils/admin-presenters');

// 题材数据仅由内部模拟生成，不支持外部金融数据源。
const DEFAULT_SOURCES = [
  {
    source_key: 'myth_ancient_well',
    name: '神秘古井',
    category: 'crypto',
    provider: 'simulated',
    endpoint_url: '',
    parser_config: { baseValue: 108, volatility: 0.05, currency: '福缘', unit: 'point', label: '神秘古井 福缘值' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'myth_spirit_turtle',
    name: '灵龟秘境',
    category: 'crypto',
    provider: 'simulated',
    endpoint_url: '',
    parser_config: { baseValue: 96, volatility: 0.03, currency: '福缘', unit: 'point', label: '灵龟秘境 福缘值' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'wonder_koi_gate',
    name: '锦鲤跃龙门',
    category: 'real_estate',
    provider: 'simulated',
    endpoint_url: '',
    parser_config: { baseValue: 120, volatility: 0.06, currency: '福缘', unit: 'point', label: '锦鲤跃龙门 福缘值' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'wonder_moon_spring',
    name: '月下灵泉',
    category: 'real_estate',
    provider: 'simulated',
    endpoint_url: '',
    parser_config: { baseValue: 88, volatility: 0.04, currency: '福缘', unit: 'point', label: '月下灵泉 福缘值' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'omen_cloud_land',
    name: '祥云福地',
    category: 'stock',
    provider: 'simulated',
    endpoint_url: '',
    parser_config: { baseValue: 132, volatility: 0.07, currency: '福缘', unit: 'point', label: '祥云福地 福缘值' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'omen_golden_cave',
    name: '金鳞洞天',
    category: 'stock',
    provider: 'simulated',
    endpoint_url: '',
    parser_config: { baseValue: 76, volatility: 0.05, currency: '福缘', unit: 'point', label: '金鳞洞天 福缘值' },
    refresh_interval_seconds: 900,
  },
];

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function toSqlJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getSourceSortPriority(source) {
  const categoryPriority = {
    stock: 0,
    crypto: 1,
    real_estate: 2,
    macro: 3,
    news: 4,
  };
  const sourceKey = String(source && (source.source_key || source.sourceKey) || '');
  return [
    categoryPriority[String(source && source.category || '')] ?? 99,
    sourceKey.startsWith('cn_') ? 0 : 1,
    Number(source && source.id || 0),
  ];
}

function compareSourcePriority(left, right) {
  const leftPriority = getSourceSortPriority(left);
  const rightPriority = getSourceSortPriority(right);
  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) {
      return leftPriority[index] - rightPriority[index];
    }
  }
  return 0;
}

function detectTrend(changePercent) {
  const change = Number(changePercent);
  if (!Number.isFinite(change)) return 'unknown';
  if (change > 0.05) return 'up';
  if (change < -0.05) return 'down';
  return 'flat';
}

function formatChange(changePercent) {
  const change = Number(changePercent);
  if (!Number.isFinite(change)) return '暂无变化';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

function normalizeDateTime(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function toMysqlDateTime(value) {
  const date = normalizeDateTime(value);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function ensureFortuneTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fortune_sources (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      category ENUM('stock','crypto','real_estate','macro','news') NOT NULL,
      provider ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual','simulated') NOT NULL DEFAULT 'simulated',
      endpoint_url VARCHAR(1024) NOT NULL,
      parser_config JSON NULL,
      refresh_interval_seconds INT UNSIGNED NOT NULL DEFAULT 900,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_fetched_at DATETIME NULL,
      last_status ENUM('idle','success','failed') NOT NULL DEFAULT 'idle',
      last_error VARCHAR(512) DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_source_key (source_key),
      INDEX idx_category_active (category, is_active),
      INDEX idx_last_fetched_at (last_fetched_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS fortune_snapshots (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_id INT UNSIGNED NOT NULL,
      source_key VARCHAR(64) NOT NULL,
      category ENUM('stock','crypto','real_estate','macro','news') NOT NULL,
      name VARCHAR(128) NOT NULL,
      metric_label VARCHAR(128) DEFAULT '',
      metric_value DECIMAL(20,6) NULL,
      change_percent DECIMAL(10,4) NULL,
      currency VARCHAR(16) DEFAULT '',
      unit VARCHAR(32) DEFAULT '',
      trend ENUM('up','down','flat','unknown') NOT NULL DEFAULT 'unknown',
      summary TEXT,
      raw_json JSON NULL,
      observed_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_source_observed (source_id, observed_at DESC),
      INDEX idx_category_observed (category, observed_at DESC),
      INDEX idx_created_at (created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS fortune_ai_reports (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      report_type VARCHAR(64) NOT NULL DEFAULT 'entertainment_digest',
      title VARCHAR(128) NOT NULL,
      summary TEXT NOT NULL,
      sentiment ENUM('positive','neutral','negative','mixed') NOT NULL DEFAULT 'neutral',
      model_provider VARCHAR(64) DEFAULT '',
      model_name VARCHAR(128) DEFAULT '',
      source_count INT UNSIGNED DEFAULT 0,
      raw_json JSON NULL,
      generated_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_report_type_generated (report_type, generated_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureDefaultSources() {
  await ensureFortuneTables();
  for (const source of DEFAULT_SOURCES) {
    await db.execute(
      `INSERT IGNORE INTO fortune_sources
       (source_key, name, category, provider, endpoint_url, parser_config, refresh_interval_seconds, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        source.source_key,
        source.name,
        source.category,
        source.provider,
        source.endpoint_url,
        toSqlJson(source.parser_config),
        source.refresh_interval_seconds,
      ]
    );
  }
}

async function listSources() {
  await ensureDefaultSources();
  const rows = await db.queryAll("SELECT * FROM fortune_sources WHERE provider = 'simulated'");
  return rows
    .map(mapFortuneSource)
    .sort(compareSourcePriority);
}

async function updateSource(id, data = {}) {
  await ensureDefaultSources();
  const allowedFields = [
    'name',
    'category',
    'provider',
    'endpoint_url',
    'parser_config',
    'refresh_interval_seconds',
    'is_active',
  ];
  const normalized = {
    name: data.name,
    category: data.category,
    provider: data.provider,
    endpoint_url: data.endpointUrl ?? data.endpoint_url,
    parser_config: data.parserConfig !== undefined ? toSqlJson(data.parserConfig) : undefined,
    refresh_interval_seconds: data.refreshIntervalSeconds ?? data.refresh_interval_seconds,
    is_active: data.isActive ?? data.is_active,
  };
  if (normalized.provider !== undefined && normalized.provider !== 'simulated') {
    throw new Error('纯娱乐版本仅允许 simulated 数据源');
  }
  if (normalized.endpoint_url !== undefined && String(normalized.endpoint_url || '').trim()) {
    throw new Error('纯娱乐版本不允许外部数据源地址');
  }
  const setClauses = [];
  const params = [];
  for (const field of allowedFields) {
    if (normalized[field] !== undefined) {
      setClauses.push(`${field} = ?`);
      params.push(field === 'is_active' ? (normalizeBoolean(normalized[field]) ? 1 : 0) : normalized[field]);
    }
  }
  if (setClauses.length > 0) {
    params.push(id);
    await db.execute(`UPDATE fortune_sources SET ${setClauses.join(', ')} WHERE id = ? AND provider = 'simulated'`, params);
  }
  const row = await db.queryOne("SELECT * FROM fortune_sources WHERE id = ? AND provider = 'simulated'", [id]);
  return mapFortuneSource(row);
}

function shouldRefreshSource(source, force = false) {
  if (force) return true;
  if (!source.last_fetched_at) return true;
  const intervalMs = Math.max(60, Number(source.refresh_interval_seconds || 900)) * 1000;
  return Date.now() - new Date(source.last_fetched_at).getTime() >= intervalMs;
}

async function fetchWithTimeout(url, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('当前 Node.js 版本不支持 fetch，请升级到 Node 18+');
  }
  const timeoutMs = Number(options.timeoutMs || 12000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || { accept: '*/*' },
      signal: controller.signal,
      body: options.body !== undefined
        ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
        : undefined,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// 确定性伪随机（同一种子结果稳定，避免每次请求跳动）
function seededRandom(seed) {
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * 内部模拟数据源：不访问任何外部 API，按时间分片生成虚构题材的福缘值。
 * 同分钟内的结果稳定，随时间自然波动，用于驱动福袋机会的涨跌与波段。
 */
function generateSimulatedSnapshot(source) {
  const parserConfig = safeJsonParse(source.parser_config);
  const baseValue = toNumber(parserConfig.baseValue) || 100;
  const volatility = Math.min(Math.max(toNumber(parserConfig.volatility) || 0.05, 0.01), 0.2);
  const seed = Math.floor(Date.now() / 60000) + Number(source.id || 0) + (source.source_key ? source.source_key.length : 0);
  const rand = seededRandom(seed);
  const drift = (rand() - 0.5) * 2 * volatility;
  const changePercent = Number((drift * 100).toFixed(2));
  const metricValue = Number((baseValue * (1 + drift)).toFixed(2));
  const currency = parserConfig.currency || '福缘';
  const observedAt = new Date();
  return {
    sourceId: source.id,
    sourceKey: source.source_key,
    category: source.category,
    name: source.name,
    metricLabel: parserConfig.label || source.name,
    metricValue,
    changePercent,
    currency,
    unit: parserConfig.unit || 'point',
    trend: detectTrend(changePercent),
    summary: `${source.name} 模拟福缘值 ${metricValue} ${currency}，本轮模拟变化 ${formatChange(changePercent)}（纯娱乐）`,
    rawJson: { seed, simulated: true },
    observedAt,
  };
}

async function fetchSourceSnapshot(source) {
  if (source.provider !== 'simulated') {
    throw new Error('纯娱乐版本仅允许 simulated 数据源，历史外部数据源已停用');
  }
  return generateSimulatedSnapshot(source);
}

async function insertSnapshot(snapshot) {
  const [result] = await db.execute(
    `INSERT INTO fortune_snapshots
      (source_id, source_key, category, name, metric_label, metric_value, change_percent, currency, unit, trend, summary, raw_json, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.sourceId,
      snapshot.sourceKey,
      snapshot.category,
      snapshot.name,
      snapshot.metricLabel || '',
      snapshot.metricValue,
      snapshot.changePercent,
      snapshot.currency || '',
      snapshot.unit || '',
      snapshot.trend || 'unknown',
      snapshot.summary || '',
      toSqlJson(snapshot.rawJson || {}),
      toMysqlDateTime(snapshot.observedAt || new Date()),
    ]
  );
  const row = await db.queryOne('SELECT * FROM fortune_snapshots WHERE id = ?', [result.insertId]);
  return mapFortuneSnapshot(row);
}

async function markSourceResult(sourceId, status, error = '') {
  await db.execute(
    `UPDATE fortune_sources
     SET last_fetched_at = NOW(), last_status = ?, last_error = ?
     WHERE id = ?`,
    [status, String(error || '').slice(0, 512), sourceId]
  );
}

async function refreshSources(options = {}) {
  await ensureDefaultSources();
  const sourceKey = options.sourceKey || '';
  const force = !!options.force;
  const rows = await db.queryAll(
    `SELECT * FROM fortune_sources
     WHERE is_active = 1 AND provider = 'simulated' ${sourceKey ? 'AND source_key = ?' : ''}
     ORDER BY category ASC, id ASC`,
    sourceKey ? [sourceKey] : []
  );

  const refreshed = [];
  const skipped = [];
  const failed = [];

  for (const source of rows) {
    if (!shouldRefreshSource(source, force)) {
      skipped.push(mapFortuneSource(source));
      continue;
    }

    try {
      const snapshot = await fetchSourceSnapshot(source);
      const saved = await insertSnapshot(snapshot);
      await markSourceResult(source.id, 'success');
      refreshed.push(saved);
    } catch (error) {
      await markSourceResult(source.id, 'failed', error.message);
      failed.push({
        sourceKey: source.source_key,
        name: source.name,
        error: error.message,
      });
    }
  }

  const report = options.generateReport === false || refreshed.length === 0
    ? null
    : await generateDigestReport();

  return {
    refreshed,
    skipped,
    failed,
    report,
  };
}

async function listSnapshots(query = {}) {
  await ensureDefaultSources();
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const category = query.category || '';
  const rows = await db.queryAll(
    `SELECT s.* FROM fortune_snapshots s
     INNER JOIN fortune_sources source ON source.id = s.source_id AND source.provider = 'simulated'
     WHERE JSON_EXTRACT(s.raw_json, '$.simulated') = true ${category ? 'AND s.category = ?' : ''}
     ORDER BY s.observed_at DESC, s.id DESC
     LIMIT ${limit}`,
    category ? [category] : []
  );
  return rows.map(mapFortuneSnapshot);
}

async function getLatestSnapshots(limit = 20) {
  await ensureDefaultSources();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const rows = await db.queryAll(
    `SELECT s.*
     FROM fortune_snapshots s
     INNER JOIN (
       SELECT snapshots.source_key, MAX(snapshots.id) AS latest_id
       FROM fortune_snapshots snapshots
       INNER JOIN fortune_sources source ON source.id = snapshots.source_id AND source.provider = 'simulated'
       WHERE JSON_EXTRACT(snapshots.raw_json, '$.simulated') = true
       GROUP BY snapshots.source_key
     ) latest ON latest.latest_id = s.id
     ORDER BY s.observed_at DESC
     LIMIT ${safeLimit}`
  );
  return rows.map(mapFortuneSnapshot);
}

function mapCategoryToGame(category, name = '') {
  if (category === 'crypto') return '秘境';
  if (category === 'real_estate') return '奇遇';
  if (category === 'stock') return '祥瑞';
  return '秘境';
}

function estimateRiskLevel(snapshot) {
  const change = Math.abs(Number(snapshot.changePercent));
  if (!Number.isFinite(change)) return 'mid';
  if (change >= 3) return 'high';
  if (change >= 1) return 'mid';
  return 'low';
}

function buildPublicOpportunities(snapshots) {
  return (snapshots || []).map((snapshot) => {
    const gameCategory = mapCategoryToGame(snapshot.category, snapshot.name);
    const riskLevel = estimateRiskLevel(snapshot);
    const trendText = snapshot.trend === 'up' ? '上行' : snapshot.trend === 'down' ? '回落' : snapshot.trend === 'flat' ? '平稳' : '待观察';
    return {
      sourceKey: snapshot.sourceKey,
      category: gameCategory,
      realityCategory: snapshot.category,
      name: snapshot.name,
      metricLabel: snapshot.metricLabel,
      metricValue: snapshot.metricValue,
      changePercent: snapshot.changePercent,
      currency: snapshot.currency,
      unit: snapshot.unit,
      trend: snapshot.trend,
      riskLevel,
      riskText: riskLevel === 'high' ? '高波动' : riskLevel === 'mid' ? '中波动' : '稳健',
      summary: snapshot.summary || `${snapshot.name} ${trendText}`,
      observedAt: snapshot.observedAt,
    };
  });
}

async function getLatestPublicFeed() {
  const enabled = normalizeBoolean(await configService.getConfig('fortune.reality_enabled'), false);
  const limit = Number(await configService.getConfig('fortune.public_signal_limit')) || 6;
  if (!enabled) {
    return {
      enabled: false,
      opportunities: [],
      report: null,
    };
  }
  // 取全部数据源的最新快照（getLatestSnapshots 上限 100 条），按优先级排序后再截断到
  // 配置的 public_signal_limit，避免先 LIMIT 后排序把高优先级源挤出公共订阅源。
  const [snapshots, report] = await Promise.all([
    getLatestSnapshots(100),
    getLatestReport(),
  ]);
  return {
    enabled: true,
    opportunities: buildPublicOpportunities(snapshots)
      .sort(compareSourcePriority)
      .slice(0, limit),
    report,
  };
}

function buildHeuristicDigest(snapshots, meta = {}) {
  const list = snapshots || [];
  const upCount = list.filter((item) => item.trend === 'up').length;
  const downCount = list.filter((item) => item.trend === 'down').length;
  const netChange = list.reduce((total, item) => {
    const change = Number(item.changePercent);
    return Number.isFinite(change) ? total + change : total;
  }, 0);
  const sentiment = netChange > 0.2
    ? 'positive'
    : netChange < -0.2
      ? 'negative'
      : upCount > downCount
        ? 'positive'
        : downCount > upCount
          ? 'negative'
          : 'neutral';
  const strongest = list
    .filter((item) => Number.isFinite(Number(item.changePercent)))
    .sort((a, b) => Math.abs(Number(b.changePercent)) - Math.abs(Number(a.changePercent)))[0];
  const title = '福袋题材事件摘要';
  const summary = [
    `已同步 ${list.length} 条题材数据源。`,
    strongest
      ? `当前波动最大的是 ${strongest.name}，变化 ${formatChange(strongest.changePercent)}。`
      : '当前数据源缺少变化数据，建议先观察数值变化。',
    upCount >= downCount
      ? '规则判断偏进攻，可给高波动题材福袋更高曝光。'
      : '规则判断偏防守，可降低高波动福袋权重。',
  ].join('');

  return {
    title,
    summary,
    sentiment,
    modelProvider: meta.modelProvider || 'local-rule',
    modelName: meta.modelName || 'heuristic',
    sourceCount: list.length,
    rawJson: { upCount, downCount, netChange, strongest: strongest || null },
    generatedAt: new Date(),
  };
}

async function getAiSettings() {
  const [enabled, provider, baseUrl, apiKey, model, timeoutMs] = await Promise.all([
    configService.getConfig('fortune.ai_digest_enabled'),
    configService.getConfig('ai.provider'),
    configService.getConfig('ai.base_url'),
    configService.getConfig('ai.api_key'),
    configService.getConfig('ai.model'),
    configService.getConfig('ai.timeout_ms'),
  ]);

  return {
    enabled: normalizeBoolean(enabled, false),
    provider: String(provider || process.env.OPENCODEGO_PROVIDER || 'opencodego').trim(),
    baseUrl: String(baseUrl || process.env.OPENCODEGO_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: String(apiKey || process.env.OPENCODEGO_API_KEY || '').trim(),
    model: String(model || process.env.OPENCODEGO_MODEL || '').trim(),
    timeoutMs: Number(timeoutMs || process.env.OPENCODEGO_TIMEOUT_MS || 15000) || 15000,
  };
}

async function callOpenAiCompatibleDigest(snapshots, settings) {
  const payload = {
    model: settings.model,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: '你是锦鲤前程小游戏的福袋题材运营助手。只输出 JSON，字段为 title、summary、sentiment，sentiment 只能是 positive、neutral、negative、mixed。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '基于虚构题材数据生成一段给后台运营看的福袋摘要，说明波动风险和可用玩法方向。',
          snapshots: snapshots.map((item) => ({
            name: item.name,
            category: item.category,
            metricValue: item.metricValue,
            changePercent: item.changePercent,
            trend: item.trend,
            summary: item.summary,
            observedAt: item.observedAt,
          })),
        }),
      },
    ],
  };

  const response = await fetchWithTimeout(`${settings.baseUrl}/chat/completions`, {
    timeoutMs: settings.timeoutMs,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI 摘要失败 HTTP ${response.status}: ${text.slice(0, 160)}`);
  }
  const json = await response.json();
  const content = json && json.choices && json.choices[0] && json.choices[0].message
    ? json.choices[0].message.content
    : '';
  let parsed = null;
  try {
    parsed = JSON.parse(String(content).trim());
  } catch (_error) {
    parsed = { title: '福袋题材事件摘要', summary: String(content || '').trim(), sentiment: 'neutral' };
  }
  return {
    title: String(parsed.title || '福袋题材事件摘要').slice(0, 128),
    summary: String(parsed.summary || '').trim() || '大模型已返回，但摘要为空。',
    sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
    modelProvider: settings.provider,
    modelName: settings.model,
    sourceCount: snapshots.length,
    rawJson: { aiResponse: json },
    generatedAt: new Date(),
  };
}

async function saveDigestReport(report) {
  const [result] = await db.execute(
    `INSERT INTO fortune_ai_reports
      (report_type, title, summary, sentiment, model_provider, model_name, source_count, raw_json, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'entertainment_digest',
      report.title,
      report.summary,
      report.sentiment,
      report.modelProvider,
      report.modelName,
      report.sourceCount,
      toSqlJson(report.rawJson || {}),
      toMysqlDateTime(report.generatedAt || new Date()),
    ]
  );
  const row = await db.queryOne('SELECT * FROM fortune_ai_reports WHERE id = ?', [result.insertId]);
  return mapFortuneAiReport(row);
}

async function generateDigestReport() {
  await ensureDefaultSources();
  const snapshots = await getLatestSnapshots(20);
  const settings = await getAiSettings();
  let report;
  if (settings.enabled && settings.baseUrl && settings.apiKey && settings.model) {
    try {
      report = await callOpenAiCompatibleDigest(snapshots, settings);
    } catch (error) {
      report = buildHeuristicDigest(snapshots, {
        modelProvider: `${settings.provider}:fallback`,
        modelName: settings.model || 'unknown',
      });
      report.rawJson.aiError = error.message;
    }
  } else {
    report = buildHeuristicDigest(snapshots);
  }
  return saveDigestReport(report);
}

async function getLatestReport() {
  await ensureDefaultSources();
  const row = await db.queryOne(
    "SELECT * FROM fortune_ai_reports WHERE report_type = 'entertainment_digest' ORDER BY generated_at DESC, id DESC LIMIT 1"
  );
  return mapFortuneAiReport(row);
}

async function getSummary() {
  await ensureDefaultSources();
  const [sourceCount, snapshotCount, latestSnapshot, latestReport] = await Promise.all([
    db.queryOne("SELECT COUNT(*) AS total, SUM(is_active = 1) AS activeTotal FROM fortune_sources WHERE provider = 'simulated'"),
    db.queryOne(`SELECT COUNT(*) AS total FROM fortune_snapshots s
      INNER JOIN fortune_sources source ON source.id = s.source_id AND source.provider = 'simulated'
      WHERE JSON_EXTRACT(s.raw_json, '$.simulated') = true`),
    db.queryOne(`SELECT s.observed_at FROM fortune_snapshots s
      INNER JOIN fortune_sources source ON source.id = s.source_id AND source.provider = 'simulated'
      WHERE JSON_EXTRACT(s.raw_json, '$.simulated') = true
      ORDER BY s.observed_at DESC, s.id DESC LIMIT 1`),
    getLatestReport(),
  ]);
  return {
    totalSources: Number(sourceCount && sourceCount.total || 0),
    activeSources: Number(sourceCount && sourceCount.activeTotal || 0),
    totalSnapshots: Number(snapshotCount && snapshotCount.total || 0),
    latestObservedAt: latestSnapshot ? toMysqlDateTime(latestSnapshot.observed_at) : '',
    latestReport,
  };
}

module.exports = {
  ensureFortuneTables,
  ensureDefaultSources,
  listSources,
  updateSource,
  refreshSources,
  listSnapshots,
  getLatestSnapshots,
  getLatestPublicFeed,
  generateDigestReport,
  getLatestReport,
  getSummary,
  __private: {
    generateSimulatedSnapshot,
    fetchSourceSnapshot,
    buildHeuristicDigest,
    buildPublicOpportunities,
    detectTrend,
  },
};
