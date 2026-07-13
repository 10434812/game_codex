-- ============================================================
-- 锦鲤前程 - 福袋现实数据联动
-- MySQL 8.0, InnoDB, utf8mb4
-- ============================================================

-- 1. fortune_sources: 福袋现实数据源配置
CREATE TABLE IF NOT EXISTS fortune_sources (
    id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '数据源ID',
    source_key                VARCHAR(64)  NOT NULL                    COMMENT '数据源唯一标识',
    name                      VARCHAR(128) NOT NULL                    COMMENT '数据源展示名',
    category                  ENUM('stock','crypto','real_estate','macro','news') NOT NULL COMMENT '现实类别',
    provider                  ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual') NOT NULL DEFAULT 'json' COMMENT '抓取/解析方式',
    endpoint_url              VARCHAR(1024) NOT NULL                   COMMENT '抓取地址',
    parser_config             JSON NULL                                COMMENT '解析配置JSON',
    refresh_interval_seconds  INT UNSIGNED NOT NULL DEFAULT 900        COMMENT '刷新间隔(秒)',
    is_active                 TINYINT(1)   NOT NULL DEFAULT 1          COMMENT '是否启用',
    last_fetched_at           DATETIME NULL                            COMMENT '最后抓取时间',
    last_status               ENUM('idle','success','failed') NOT NULL DEFAULT 'idle' COMMENT '最后抓取状态',
    last_error                VARCHAR(512) DEFAULT ''                  COMMENT '最后错误',
    created_at                DATETIME DEFAULT CURRENT_TIMESTAMP       COMMENT '创建时间',
    updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    UNIQUE KEY uk_source_key (source_key),
    INDEX idx_category_active (category, is_active),
    INDEX idx_last_fetched_at (last_fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='福袋现实数据源';

ALTER TABLE fortune_sources
    MODIFY COLUMN provider ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual') NOT NULL DEFAULT 'json' COMMENT '抓取/解析方式';

-- 2. fortune_snapshots: 福袋现实数据快照
CREATE TABLE IF NOT EXISTS fortune_snapshots (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '快照ID',
    source_id       INT UNSIGNED NOT NULL                      COMMENT '数据源ID',
    source_key      VARCHAR(64)  NOT NULL                      COMMENT '数据源唯一标识',
    category        ENUM('stock','crypto','real_estate','macro','news') NOT NULL COMMENT '现实类别',
    name            VARCHAR(128) NOT NULL                      COMMENT '数据名称',
    metric_label    VARCHAR(128) DEFAULT ''                    COMMENT '指标名',
    metric_value    DECIMAL(20,6) NULL                         COMMENT '指标数值',
    change_percent  DECIMAL(10,4) NULL                         COMMENT '涨跌幅百分比',
    currency        VARCHAR(16) DEFAULT ''                     COMMENT '币种',
    unit            VARCHAR(32) DEFAULT ''                     COMMENT '单位',
    trend           ENUM('up','down','flat','unknown') NOT NULL DEFAULT 'unknown' COMMENT '趋势',
    summary         TEXT                                       COMMENT '摘要',
    raw_json        JSON NULL                                  COMMENT '原始数据',
    observed_at     DATETIME NOT NULL                          COMMENT '数据观察时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP         COMMENT '入库时间',
    INDEX idx_source_observed (source_id, observed_at DESC),
    INDEX idx_category_observed (category, observed_at DESC),
    INDEX idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='福袋现实数据快照';

-- 3. fortune_ai_reports: 大模型/规则生成的福袋摘要
CREATE TABLE IF NOT EXISTS fortune_ai_reports (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '摘要ID',
    report_type     VARCHAR(64)  NOT NULL DEFAULT 'market_digest' COMMENT '摘要类型',
    title           VARCHAR(128) NOT NULL                       COMMENT '标题',
    summary         TEXT NOT NULL                               COMMENT '摘要内容',
    sentiment       ENUM('positive','neutral','negative','mixed') NOT NULL DEFAULT 'neutral' COMMENT '情绪倾向',
    model_provider  VARCHAR(64) DEFAULT ''                      COMMENT '模型服务商',
    model_name      VARCHAR(128) DEFAULT ''                     COMMENT '模型名称',
    source_count    INT UNSIGNED DEFAULT 0                      COMMENT '参与摘要的数据源数量',
    raw_json        JSON NULL                                   COMMENT '结构化摘要/请求结果',
    generated_at    DATETIME NOT NULL                           COMMENT '生成时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP          COMMENT '入库时间',
    INDEX idx_report_type_generated (report_type, generated_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='福袋现实数据摘要';

-- 默认现实数据源：股票、比特币、房产代理指数
INSERT INTO fortune_sources
  (source_key, name, category, provider, endpoint_url, parser_config, refresh_interval_seconds, is_active)
VALUES
  (
    'cn_stock_hs300',
    '沪深300 ETF 510300',
    'stock',
    'sina_quote',
    'https://hq.sinajs.cn/list=sh510300',
    JSON_OBJECT('symbol', 'sh510300', 'currency', 'CNY', 'unit', 'price', 'label', '沪深300 ETF 最新价'),
    900,
    1
  ),
  (
    'cn_stock_star50',
    '科创50 ETF 588000',
    'stock',
    'sina_quote',
    'https://hq.sinajs.cn/list=sh588000',
    JSON_OBJECT('symbol', 'sh588000', 'currency', 'CNY', 'unit', 'price', 'label', '科创50 ETF 最新价'),
    900,
    1
  ),
  (
    'stock_spy',
    '标普500 ETF SPY',
    'stock',
    'stooq',
    'https://stooq.com/q/l/?s=spy.us&f=sd2t2ohlcv&h&e=csv',
    JSON_OBJECT('symbol', 'SPY.US', 'currency', 'USD', 'unit', 'price', 'label', 'SPY 最新价'),
    900,
    1
  ),
  (
    'stock_qqq',
    '纳斯达克100 ETF QQQ',
    'stock',
    'stooq',
    'https://stooq.com/q/l/?s=qqq.us&f=sd2t2ohlcv&h&e=csv',
    JSON_OBJECT('symbol', 'QQQ.US', 'currency', 'USD', 'unit', 'price', 'label', 'QQQ 最新价'),
    900,
    1
  ),
  (
    'crypto_btc',
    'Bitcoin BTC',
    'crypto',
    'coingecko',
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
    JSON_OBJECT('coinId', 'bitcoin', 'vsCurrency', 'usd', 'currency', 'USD', 'unit', 'price', 'label', 'BTC 最新价'),
    300,
    1
  ),
  (
    'crypto_eth',
    'Ethereum ETH',
    'crypto',
    'coingecko',
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
    JSON_OBJECT('coinId', 'ethereum', 'vsCurrency', 'usd', 'currency', 'USD', 'unit', 'price', 'label', 'ETH 最新价'),
    300,
    1
  ),
  (
    'cn_real_estate_vanke',
    '万科A 000002',
    'real_estate',
    'sina_quote',
    'https://hq.sinajs.cn/list=sz000002',
    JSON_OBJECT('symbol', 'sz000002', 'currency', 'CNY', 'unit', 'price', 'label', '万科A 最新价'),
    1800,
    1
  ),
  (
    'cn_real_estate_poly',
    '保利发展 600048',
    'real_estate',
    'sina_quote',
    'https://hq.sinajs.cn/list=sh600048',
    JSON_OBJECT('symbol', 'sh600048', 'currency', 'CNY', 'unit', 'price', 'label', '保利发展 最新价'),
    1800,
    1
  ),
  (
    'real_estate_vnq',
    '美国房地产 ETF VNQ',
    'real_estate',
    'stooq',
    'https://stooq.com/q/l/?s=vnq.us&f=sd2t2ohlcv&h&e=csv',
    JSON_OBJECT('symbol', 'VNQ.US', 'currency', 'USD', 'unit', 'price', 'label', 'VNQ 最新价'),
    1800,
    1
  ),
  (
    'real_estate_itb',
    '美国住宅建设 ETF ITB',
    'real_estate',
    'stooq',
    'https://stooq.com/q/l/?s=itb.us&f=sd2t2ohlcv&h&e=csv',
    JSON_OBJECT('symbol', 'ITB.US', 'currency', 'USD', 'unit', 'price', 'label', 'ITB 最新价'),
    1800,
    1
  )
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  category = VALUES(category),
  provider = VALUES(provider),
  endpoint_url = VALUES(endpoint_url),
  parser_config = VALUES(parser_config),
  refresh_interval_seconds = VALUES(refresh_interval_seconds);

INSERT INTO system_configs (config_key, config_value, description) VALUES
('fortune.reality_enabled', 'true', '是否启用福袋现实数据联动'),
('fortune.refresh_interval_seconds', '900', '福袋现实数据默认刷新间隔(秒)'),
('fortune.public_signal_limit', '6', '小程序可读取的福袋现实机会数量'),
('fortune.ai_digest_enabled', 'false', '是否启用大模型生成福袋行情摘要'),
('ai.provider', 'opencodego', '大模型服务商标识'),
('ai.base_url', '', 'OpenAI 兼容接口 Base URL（例如 https://example.com/v1）'),
('ai.api_key', '', '大模型 API Key（仅服务端保存，不对前端公开）'),
('ai.model', '', '福袋摘要默认模型名称'),
('ai.timeout_ms', '15000', '大模型请求超时时间(毫秒)')
ON DUPLICATE KEY UPDATE description = VALUES(description);
