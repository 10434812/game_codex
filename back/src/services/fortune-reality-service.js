const db = require('../models/db');
const configService = require('./admin-config-service');
const {
  mapFortuneAiReport,
  mapFortuneSnapshot,
  mapFortuneSource,
} = require('../utils/admin-presenters');

const DEFAULT_SOURCES = [
  {
    source_key: 'cn_stock_hs300',
    name: '沪深300 ETF 510300',
    category: 'stock',
    provider: 'sina_quote',
    endpoint_url: 'https://hq.sinajs.cn/list=sh510300',
    parser_config: { symbol: 'sh510300', currency: 'CNY', unit: 'price', label: '沪深300 ETF 最新价' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'cn_stock_star50',
    name: '科创50 ETF 588000',
    category: 'stock',
    provider: 'sina_quote',
    endpoint_url: 'https://hq.sinajs.cn/list=sh588000',
    parser_config: { symbol: 'sh588000', currency: 'CNY', unit: 'price', label: '科创50 ETF 最新价' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'stock_spy',
    name: '标普500 ETF SPY',
    category: 'stock',
    provider: 'stooq',
    endpoint_url: 'https://stooq.com/q/l/?s=spy.us&f=sd2t2ohlcv&h&e=csv',
    parser_config: { symbol: 'SPY.US', currency: 'USD', unit: 'price', label: 'SPY 最新价' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'stock_qqq',
    name: '纳斯达克100 ETF QQQ',
    category: 'stock',
    provider: 'stooq',
    endpoint_url: 'https://stooq.com/q/l/?s=qqq.us&f=sd2t2ohlcv&h&e=csv',
    parser_config: { symbol: 'QQQ.US', currency: 'USD', unit: 'price', label: 'QQQ 最新价' },
    refresh_interval_seconds: 900,
  },
  {
    source_key: 'crypto_btc',
    name: 'Bitcoin BTC',
    category: 'crypto',
    provider: 'coingecko',
    endpoint_url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
    parser_config: { coinId: 'bitcoin', vsCurrency: 'usd', currency: 'USD', unit: 'price', label: 'BTC 最新价' },
    refresh_interval_seconds: 300,
  },
  {
    source_key: 'crypto_eth',
    name: 'Ethereum ETH',
    category: 'crypto',
    provider: 'coingecko',
    endpoint_url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
    parser_config: { coinId: 'ethereum', vsCurrency: 'usd', currency: 'USD', unit: 'price', label: 'ETH 最新价' },
    refresh_interval_seconds: 300,
  },
  {
    source_key: 'cn_real_estate_vanke',
    name: '万科A 000002',
    category: 'real_estate',
    provider: 'sina_quote',
    endpoint_url: 'https://hq.sinajs.cn/list=sz000002',
    parser_config: { symbol: 'sz000002', currency: 'CNY', unit: 'price', label: '万科A 最新价' },
    refresh_interval_seconds: 1800,
  },
  {
    source_key: 'cn_real_estate_poly',
    name: '保利发展 600048',
    category: 'real_estate',
    provider: 'sina_quote',
    endpoint_url: 'https://hq.sinajs.cn/list=sh600048',
    parser_config: { symbol: 'sh600048', currency: 'CNY', unit: 'price', label: '保利发展 最新价' },
    refresh_interval_seconds: 1800,
  },
  {
    source_key: 'real_estate_vnq',
    name: '美国房地产 ETF VNQ',
    category: 'real_estate',
    provider: 'stooq',
    endpoint_url: 'https://stooq.com/q/l/?s=vnq.us&f=sd2t2ohlcv&h&e=csv',
    parser_config: { symbol: 'VNQ.US', currency: 'USD', unit: 'price', label: 'VNQ 最新价' },
    refresh_interval_seconds: 1800,
  },
  {
    source_key: 'real_estate_itb',
    name: '美国住宅建设 ETF ITB',
    category: 'real_estate',
    provider: 'stooq',
    endpoint_url: 'https://stooq.com/q/l/?s=itb.us&f=sd2t2ohlcv&h&e=csv',
    parser_config: { symbol: 'ITB.US', currency: 'USD', unit: 'price', label: 'ITB 最新价' },
    refresh_interval_seconds: 1800,
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
  if (!Number.isFinite(change)) return '暂无涨跌幅';
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

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (const char of String(line || '')) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((item) => item.trim());
}

function parseStooqCsv(text, source) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('Stooq 响应为空');
  }
  const headers = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines[1]);
  const row = headers.reduce((acc, key, index) => {
    acc[key] = values[index];
    return acc;
  }, {});

  const close = toNumber(row.Close);
  const open = toNumber(row.Open);
  if (close === null) {
    throw new Error('Stooq 响应缺少 Close');
  }

  const changePercent = open && open > 0 ? ((close - open) / open) * 100 : null;
  const parserConfig = safeJsonParse(source.parser_config);
  const observedAt = normalizeDateTime(`${row.Date || ''}T${row.Time || '00:00:00'}Z`);

  return {
    sourceId: source.id,
    sourceKey: source.source_key,
    category: source.category,
    name: source.name,
    metricLabel: parserConfig.label || row.Symbol || source.name,
    metricValue: close,
    changePercent,
    currency: parserConfig.currency || '',
    unit: parserConfig.unit || 'price',
    trend: detectTrend(changePercent),
    summary: `${source.name} 当前值 ${close}${parserConfig.currency ? ` ${parserConfig.currency}` : ''}，日内变化 ${formatChange(changePercent)}`,
    rawJson: row,
    observedAt,
  };
}

function parseSinaQuoteText(text, source) {
  const parserConfig = safeJsonParse(source.parser_config);
  const match = String(text || '').match(/="([\s\S]*?)";?\s*$/);
  if (!match) {
    throw new Error('新浪行情响应为空');
  }
  const values = match[1].split(',');
  if (values.length < 32) {
    throw new Error('新浪行情响应字段不足');
  }

  const previousClose = toNumber(values[2]);
  const currentPrice = toNumber(values[3]);
  if (currentPrice === null) {
    throw new Error('新浪行情响应缺少当前价');
  }

  const changePercent = previousClose && previousClose > 0
    ? ((currentPrice - previousClose) / previousClose) * 100
    : null;
  const observedAt = normalizeDateTime(`${values[30]}T${values[31] || '00:00:00'}+08:00`);

  return {
    sourceId: source.id,
    sourceKey: source.source_key,
    category: source.category,
    name: source.name,
    metricLabel: parserConfig.label || source.name,
    metricValue: currentPrice,
    changePercent,
    currency: parserConfig.currency || 'CNY',
    unit: parserConfig.unit || 'price',
    trend: detectTrend(changePercent),
    summary: `${source.name} 当前值 ${currentPrice}${parserConfig.currency ? ` ${parserConfig.currency}` : ''}，日内变化 ${formatChange(changePercent)}`,
    rawJson: {
      quoteName: values[0],
      open: toNumber(values[1]),
      previousClose,
      currentPrice,
      high: toNumber(values[4]),
      low: toNumber(values[5]),
      volume: toNumber(values[8]),
      turnover: toNumber(values[9]),
      date: values[30],
      time: values[31],
    },
    observedAt,
  };
}

function parseCoinGeckoJson(json, source) {
  const parserConfig = safeJsonParse(source.parser_config);
  const coinId = parserConfig.coinId || 'bitcoin';
  const vsCurrency = parserConfig.vsCurrency || 'usd';
  const coin = json && json[coinId];
  if (!coin || coin[vsCurrency] === undefined) {
    throw new Error(`CoinGecko 响应缺少 ${coinId}.${vsCurrency}`);
  }

  const price = toNumber(coin[vsCurrency]);
  const changePercent = toNumber(coin[`${vsCurrency}_24h_change`]);
  const observedAt = coin.last_updated_at
    ? new Date(Number(coin.last_updated_at) * 1000)
    : new Date();

  return {
    sourceId: source.id,
    sourceKey: source.source_key,
    category: source.category,
    name: source.name,
    metricLabel: parserConfig.label || `${coinId.toUpperCase()} 最新价`,
    metricValue: price,
    changePercent,
    currency: parserConfig.currency || vsCurrency.toUpperCase(),
    unit: parserConfig.unit || 'price',
    trend: detectTrend(changePercent),
    summary: `${source.name} 当前价格 ${price} ${parserConfig.currency || vsCurrency.toUpperCase()}，24小时变化 ${formatChange(changePercent)}`,
    rawJson: coin,
    observedAt,
  };
}

function getByPath(object, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, object);
}

function parseGenericJson(json, source) {
  const parserConfig = safeJsonParse(source.parser_config);
  const value = toNumber(getByPath(json, parserConfig.valuePath));
  if (value === null) {
    throw new Error('JSON 响应缺少数值字段');
  }
  const changePercent = toNumber(getByPath(json, parserConfig.changePercentPath));
  const observedAtValue = getByPath(json, parserConfig.observedAtPath);
  return {
    sourceId: source.id,
    sourceKey: source.source_key,
    category: source.category,
    name: source.name,
    metricLabel: parserConfig.label || source.name,
    metricValue: value,
    changePercent,
    currency: parserConfig.currency || '',
    unit: parserConfig.unit || '',
    trend: detectTrend(changePercent),
    summary: `${source.name} 当前值 ${value}，变化 ${formatChange(changePercent)}`,
    rawJson: json,
    observedAt: normalizeDateTime(observedAtValue, new Date()),
  };
}

function parseRssText(text, source) {
  const itemBlocks = String(text || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  const titles = itemBlocks.slice(0, 5).map((item) => {
    const match = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i);
    return (match && (match[1] || match[2]) || '').replace(/<[^>]+>/g, '').trim();
  }).filter(Boolean);
  return {
    sourceId: source.id,
    sourceKey: source.source_key,
    category: source.category,
    name: source.name,
    metricLabel: '最新资讯',
    metricValue: null,
    changePercent: null,
    currency: '',
    unit: 'news',
    trend: 'unknown',
    summary: titles.length ? titles.join(' / ') : `${source.name} 已抓取，但没有解析到标题`,
    rawJson: { titles },
    observedAt: new Date(),
  };
}

async function ensureFortuneTables() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fortune_sources (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_key VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      category ENUM('stock','crypto','real_estate','macro','news') NOT NULL,
      provider ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual') NOT NULL DEFAULT 'json',
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
    ALTER TABLE fortune_sources
    MODIFY COLUMN provider ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual') NOT NULL DEFAULT 'json'
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
      report_type VARCHAR(64) NOT NULL DEFAULT 'market_digest',
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
      `INSERT INTO fortune_sources
       (source_key, name, category, provider, endpoint_url, parser_config, refresh_interval_seconds, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         category = VALUES(category),
         provider = VALUES(provider),
         endpoint_url = VALUES(endpoint_url),
         parser_config = VALUES(parser_config),
         refresh_interval_seconds = VALUES(refresh_interval_seconds)`,
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
  const rows = await db.queryAll('SELECT * FROM fortune_sources');
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
    await db.execute(`UPDATE fortune_sources SET ${setClauses.join(', ')} WHERE id = ?`, params);
  }
  const row = await db.queryOne('SELECT * FROM fortune_sources WHERE id = ?', [id]);
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
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceSnapshot(source) {
  const provider = source.provider || 'json';
  if (provider === 'manual') {
    throw new Error('手动数据源不能自动抓取');
  }

  const response = await fetchWithTimeout(source.endpoint_url, {
    timeoutMs: 12000,
    headers: provider === 'sina_quote'
      ? {
          accept: '*/*',
          referer: 'https://finance.sina.com.cn',
          'user-agent': 'Mozilla/5.0 Codex Fortune Reality Feed',
        }
      : { accept: '*/*' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  if (provider === 'coingecko' || provider === 'json') {
    const json = await response.json();
    return provider === 'coingecko'
      ? parseCoinGeckoJson(json, source)
      : parseGenericJson(json, source);
  }

  const text = await response.text();
  if (provider === 'sina_quote') {
    return parseSinaQuoteText(text, source);
  }
  if (provider === 'stooq' || provider === 'csv') {
    return parseStooqCsv(text, source);
  }
  if (provider === 'rss') {
    return parseRssText(text, source);
  }
  throw new Error(`不支持的数据源类型: ${provider}`);
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
     WHERE is_active = 1 ${sourceKey ? 'AND source_key = ?' : ''}
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
    `SELECT * FROM fortune_snapshots
     ${category ? 'WHERE category = ?' : ''}
     ORDER BY observed_at DESC, id DESC
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
       SELECT source_key, MAX(id) AS latest_id
       FROM fortune_snapshots
       GROUP BY source_key
     ) latest ON latest.latest_id = s.id
     ORDER BY s.observed_at DESC
     LIMIT ${safeLimit}`
  );
  return rows.map(mapFortuneSnapshot);
}

function mapCategoryToGame(category, name = '') {
  if (category === 'crypto') return '比特币';
  if (category === 'real_estate') return '房产';
  if (category === 'stock') return '股票';
  if (/房|地产|REIT|VNQ|ITB/i.test(name)) return '房产';
  if (/BTC|ETH|Bitcoin|Ethereum|币/i.test(name)) return '比特币';
  return '股票';
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
  const enabled = normalizeBoolean(await configService.getConfig('fortune.reality_enabled'), true);
  const limit = Number(await configService.getConfig('fortune.public_signal_limit')) || 6;
  if (!enabled) {
    return {
      enabled: false,
      opportunities: [],
      report: null,
    };
  }
  const [snapshots, report] = await Promise.all([
    getLatestSnapshots(limit),
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
  const title = '福袋现实行情摘要';
  const summary = [
    `已同步 ${list.length} 条现实数据源。`,
    strongest
      ? `当前波动最大的是 ${strongest.name}，变化 ${formatChange(strongest.changePercent)}。`
      : '当前数据源缺少涨跌幅，建议先观察数值变化。',
    upCount >= downCount
      ? '规则判断偏进攻，可给股票/比特币类福袋更高曝光。'
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
        content: '你是锦鲤前程小游戏的福袋行情运营助手。只输出 JSON，字段为 title、summary、sentiment，sentiment 只能是 positive、neutral、negative、mixed。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: '基于现实数据生成一段给后台运营看的福袋摘要，说明风险和可用玩法方向。',
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
    parsed = { title: '福袋现实行情摘要', summary: String(content || '').trim(), sentiment: 'neutral' };
  }
  return {
    title: String(parsed.title || '福袋现实行情摘要').slice(0, 128),
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
    "SELECT * FROM fortune_ai_reports WHERE report_type = 'market_digest' ORDER BY generated_at DESC, id DESC LIMIT 1"
  );
  return mapFortuneAiReport(row);
}

async function getSummary() {
  await ensureDefaultSources();
  const [sourceCount, snapshotCount, latestSnapshot, latestReport] = await Promise.all([
    db.queryOne('SELECT COUNT(*) AS total, SUM(is_active = 1) AS activeTotal FROM fortune_sources'),
    db.queryOne('SELECT COUNT(*) AS total FROM fortune_snapshots'),
    db.queryOne('SELECT observed_at FROM fortune_snapshots ORDER BY observed_at DESC, id DESC LIMIT 1'),
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
    buildHeuristicDigest,
    buildPublicOpportunities,
    detectTrend,
    parseCoinGeckoJson,
    parseCsvLine,
    parseGenericJson,
    parseRssText,
    parseSinaQuoteText,
    parseStooqCsv,
  },
};
