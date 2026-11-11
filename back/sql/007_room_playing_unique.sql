-- ============================================================
-- 007 - 每个房间同一时刻最多一个进行中对局
-- ============================================================
-- 背景: 开局"双启动"竞态——并发 POST /rooms/:id/start 可创建多个
--       status='playing' 的 game_sessions，导致双 tick 循环、双倍结算。
--       应用层已在 room-service.startGame 加条件 UPDATE 守卫，
--       这里再从数据库层面兜底。
--
-- 实现: 生成列 playing_room_id 仅在 status='playing' 时等于 room_id，
--       其余为 NULL。MySQL 唯一索引允许多个 NULL，因此该唯一键
--       恰好约束"同一房间最多一个进行中会话"，同时不限制历史 finished 会话。
--
-- ⚠️ 执行前请先人工清理历史脏数据（同一 room_id 存在多条 playing）：
--      UPDATE game_sessions SET status='finished', finished_at=NOW()
--      WHERE status='playing' AND id NOT IN (
--        SELECT ... 每房间保留最新一条 playing
--      );
-- ============================================================

-- MySQL 8 不支持 ADD COLUMN IF NOT EXISTS；显式查元数据保证重复执行安全。
SET @add_playing_room_id = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE game_sessions ADD COLUMN playing_room_id INT UNSIGNED GENERATED ALWAYS AS (IF(status = ''playing'', room_id, NULL)) STORED COMMENT ''进行中对局所属房间(唯一索引用)''',
    'SELECT 1')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_sessions' AND COLUMN_NAME = 'playing_room_id'
);
PREPARE add_playing_room_id_stmt FROM @add_playing_room_id;
EXECUTE add_playing_room_id_stmt;
DEALLOCATE PREPARE add_playing_room_id_stmt;

SET @add_uk_room_playing = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE game_sessions ADD UNIQUE KEY uk_room_playing (playing_room_id)',
    'SELECT 1')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_sessions' AND INDEX_NAME = 'uk_room_playing'
);
PREPARE add_uk_room_playing_stmt FROM @add_uk_room_playing;
EXECUTE add_uk_room_playing_stmt;
DEALLOCATE PREPARE add_uk_room_playing_stmt;
