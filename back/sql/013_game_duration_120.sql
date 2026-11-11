-- 新对局使用 120 秒，历史对局保留原有时长。
ALTER TABLE game_sessions ALTER COLUMN duration SET DEFAULT 120;
UPDATE system_configs SET config_value = '120' WHERE config_key = 'game.round_duration';
