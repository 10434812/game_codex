-- Support account-scoped lookup of settled scenic passport visits.
CREATE INDEX idx_game_players_user_session ON game_players (user_id, session_id);
