-- 用户注销：保留匿名化后的对局统计，删除资料、库存和金币流水。
-- MySQL 8 不支持 ADD COLUMN IF NOT EXISTS；显式查元数据保证重复执行安全。
SET @add_deleted_at = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL COMMENT ''账号注销时间''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'deleted_at'
);
PREPARE add_deleted_at_stmt FROM @add_deleted_at;
EXECUTE add_deleted_at_stmt;
DEALLOCATE PREPARE add_deleted_at_stmt;

UPDATE system_configs
SET config_value = CASE config_key
  WHEN 'wechat.login_agreement_url' THEN '/pages/legal/agreement/index'
  WHEN 'wechat.login_privacy_url' THEN '/pages/legal/privacy/index'
END
WHERE config_key IN ('wechat.login_agreement_url', 'wechat.login_privacy_url')
  AND TRIM(config_value) = '';
