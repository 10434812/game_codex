-- ============================================================
-- 锦鲤前程 - 福袋题材数据联动
-- MySQL 8.0, InnoDB, utf8mb4
-- ============================================================

-- 1. fortune_sources: 福袋题材数据源配置
CREATE TABLE IF NOT EXISTS fortune_sources (
    id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '数据源ID',
    source_key                VARCHAR(64)  NOT NULL                    COMMENT '数据源唯一标识',
    name                      VARCHAR(128) NOT NULL                    COMMENT '数据源展示名',
    category                  ENUM('stock','crypto','real_estate','macro','news') NOT NULL COMMENT '题材类别',
    provider                  ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual','simulated') NOT NULL DEFAULT 'simulated' COMMENT '抓取/解析方式',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='福袋题材数据源';

ALTER TABLE fortune_sources
    MODIFY COLUMN provider ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual','simulated') NOT NULL DEFAULT 'simulated' COMMENT '抓取/解析方式';

-- 2. fortune_snapshots: 福袋题材数据快照
CREATE TABLE IF NOT EXISTS fortune_snapshots (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '快照ID',
    source_id       INT UNSIGNED NOT NULL                      COMMENT '数据源ID',
    source_key      VARCHAR(64)  NOT NULL                      COMMENT '数据源唯一标识',
    category        ENUM('stock','crypto','real_estate','macro','news') NOT NULL COMMENT '题材类别',
    name            VARCHAR(128) NOT NULL                      COMMENT '数据名称',
    metric_label    VARCHAR(128) DEFAULT ''                    COMMENT '指标名',
    metric_value    DECIMAL(20,6) NULL                         COMMENT '指标数值',
    change_percent  DECIMAL(10,4) NULL                         COMMENT '变化百分比',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='福袋题材数据快照';

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='福袋题材数据摘要';

-- 默认数据源：内部模拟的虚构题材数据（不依赖外部 API）
INSERT INTO fortune_sources
  (source_key, name, category, provider, endpoint_url, parser_config, refresh_interval_seconds, is_active)
VALUES
  (
    'myth_ancient_well',
    '神秘古井',
    'crypto',
    'simulated',
    '',
    JSON_OBJECT('baseValue', 108, 'volatility', 0.05, 'currency', '福缘', 'unit', 'point', 'label', '神秘古井 福缘值'),
    900,
    1
  ),
  (
    'myth_spirit_turtle',
    '灵龟秘境',
    'crypto',
    'simulated',
    '',
    JSON_OBJECT('baseValue', 96, 'volatility', 0.03, 'currency', '福缘', 'unit', 'point', 'label', '灵龟秘境 福缘值'),
    900,
    1
  ),
  (
    'wonder_koi_gate',
    '锦鲤跃龙门',
    'real_estate',
    'simulated',
    '',
    JSON_OBJECT('baseValue', 120, 'volatility', 0.06, 'currency', '福缘', 'unit', 'point', 'label', '锦鲤跃龙门 福缘值'),
    900,
    1
  ),
  (
    'wonder_moon_spring',
    '月下灵泉',
    'real_estate',
    'simulated',
    '',
    JSON_OBJECT('baseValue', 88, 'volatility', 0.04, 'currency', '福缘', 'unit', 'point', 'label', '月下灵泉 福缘值'),
    900,
    1
  ),
  (
    'omen_cloud_land',
    '祥云福地',
    'stock',
    'simulated',
    '',
    JSON_OBJECT('baseValue', 132, 'volatility', 0.07, 'currency', '福缘', 'unit', 'point', 'label', '祥云福地 福缘值'),
    900,
    1
  ),
  (
    'omen_golden_cave',
    '金鳞洞天',
    'stock',
    'simulated',
    '',
    JSON_OBJECT('baseValue', 76, 'volatility', 0.05, 'currency', '福缘', 'unit', 'point', 'label', '金鳞洞天 福缘值'),
    900,
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
('fortune.reality_enabled', 'false', '是否启用福袋题材数据联动'),
('fortune.refresh_interval_seconds', '900', '福袋题材数据默认刷新间隔(秒)'),
('fortune.public_signal_limit', '6', '小程序可读取的福袋题材机会数量'),
('fortune.ai_digest_enabled', 'false', '是否启用大模型生成福袋事件摘要'),
('ai.provider', 'opencodego', '大模型服务商标识'),
('ai.base_url', '', 'OpenAI 兼容接口 Base URL（例如 https://example.com/v1）'),
('ai.api_key', '', '大模型 API Key（仅服务端保存，不对前端公开）'),
('ai.model', '', '福袋摘要默认模型名称'),
('ai.timeout_ms', '15000', '大模型请求超时时间(毫秒)')
ON DUPLICATE KEY UPDATE description = VALUES(description);
