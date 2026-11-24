ALTER TABLE room_players
  ADD COLUMN challenge_source_session_id BIGINT UNSIGNED NULL,
  ADD COLUMN challenge_source_user_id BIGINT UNSIGNED NULL;

ALTER TABLE game_players
  ADD COLUMN challenge_source_session_id BIGINT UNSIGNED NULL,
  ADD COLUMN challenge_source_user_id BIGINT UNSIGNED NULL;
