-- 纯娱乐版本：移除微信支付配置。（旧库若存在 wechat_payment_orders 历史订单表，保留不删以留存审计数据；新库不再创建该表。）
DELETE FROM system_configs
WHERE config_key LIKE 'wechat.pay_%';

-- 纯娱乐版本只允许内部模拟题材，停用历史外部金融数据源。
UPDATE fortune_sources
SET is_active = 0
WHERE provider <> 'simulated';

UPDATE system_configs
SET config_value = 'false'
WHERE config_key = 'fortune.reality_enabled';
