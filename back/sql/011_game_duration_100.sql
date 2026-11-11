-- 新对局使用 100 秒，历史对局保留原有时长。
ALTER TABLE game_sessions ALTER COLUMN duration SET DEFAULT 100;
UPDATE system_configs SET config_value = '100' WHERE config_key = 'game.round_duration';
