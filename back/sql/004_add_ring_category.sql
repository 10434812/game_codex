-- ============================================================
-- Add avatar ring inventory support
-- ============================================================

ALTER TABLE user_items
  MODIFY category ENUM('skin','pet','ring') NOT NULL COMMENT '物品分类';
