-- Required before enabling waiting-room expiry. Member polling refreshes at most once/minute.
ALTER TABLE rooms ADD COLUMN last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX idx_room_activity ON rooms (status, last_active_at);
