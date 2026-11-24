ALTER TABLE rooms ADD COLUMN match_due_at DATETIME NULL;
CREATE INDEX idx_rooms_matching ON rooms (status, stage_id, match_due_at);
