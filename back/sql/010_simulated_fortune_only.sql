-- 纯娱乐数据源切换：历史记录保留审计，不再抓取或展示外部金融数据。
UPDATE fortune_sources
SET is_active = 0,
    endpoint_url = '',
    last_status = 'idle',
    last_error = '纯娱乐版本已停用历史外部数据源'
WHERE provider <> 'simulated';

-- 保留历史 provider 枚举值用于识别旧记录，新建源默认内部模拟。
ALTER TABLE fortune_sources
MODIFY COLUMN provider ENUM('coingecko','stooq','sina_quote','json','csv','rss','manual','simulated') NOT NULL DEFAULT 'simulated';

UPDATE system_configs
SET config_value = 'false'
WHERE config_key = 'fortune.reality_enabled';

-- 旧 market_digest 留存但不再公开读取；新摘要使用 entertainment_digest。
ALTER TABLE fortune_ai_reports
MODIFY COLUMN report_type VARCHAR(64) NOT NULL DEFAULT 'entertainment_digest';
