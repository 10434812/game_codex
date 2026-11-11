CREATE TABLE IF NOT EXISTS avatar_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  download_token CHAR(64) NOT NULL UNIQUE,
  filename VARCHAR(128) NOT NULL,
  avatar_url VARCHAR(512) NOT NULL,
  trace_id VARCHAR(128) NULL UNIQUE,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX idx_avatar_reviews_user (user_id, id),
  INDEX idx_avatar_reviews_expiry (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
