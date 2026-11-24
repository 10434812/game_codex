CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_key CHAR(64) NOT NULL,
  user_id INT UNSIGNED NULL,
  device_id VARCHAR(64) NOT NULL,
  client ENUM('miniprogram','minigame') NOT NULL,
  name VARCHAR(40) NOT NULL,
  props JSON NULL,
  client_ts BIGINT NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_analytics_event (event_key),
  INDEX idx_analytics_name_time (name, received_at),
  INDEX idx_analytics_user_time (user_id, received_at),
  INDEX idx_analytics_device_time (device_id, received_at),
  INDEX idx_analytics_expiry (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
