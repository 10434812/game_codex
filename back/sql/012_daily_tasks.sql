-- Apply before deploying the daily-task service. No existing data is modified.
CREATE TABLE IF NOT EXISTS daily_tasks (
  user_id INT UNSIGNED NOT NULL,
  task_date DATE NOT NULL,
  games INT UNSIGNED NOT NULL DEFAULT 0,
  teamed INT UNSIGNED NOT NULL DEFAULT 0,
  claimed INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, task_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
