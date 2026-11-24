const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../models/db');
const {STAGES} = require('../game-engine/constants');
const {success} = require('../utils/response');

const DAY = 86400000;
const SATURDAY = Date.UTC(2026, 0, 3);

router.get('/', auth, async (req, res, next) => {
  try {
    const now = Date.now() + 8 * 3600000;
    const week = Math.floor((now - SATURDAY) / (7 * DAY));
    const start = SATURDAY + week * 7 * DAY;
    const end = start + 2 * DAY;
    const stage = STAGES[((week % STAGES.length) + STAGES.length) % STAGES.length];
    const completed = await db.queryOne(`
      SELECT s.id FROM game_players p
      JOIN game_sessions s ON s.id = p.session_id
      JOIN game_results r ON r.session_id = s.id
      WHERE p.user_id = ? AND p.rank IS NOT NULL AND s.stage_id = ? AND s.status = 'finished'
        AND s.finished_at >= TIMESTAMPADD(MICROSECOND, ?, NOW(3))
        AND s.finished_at < TIMESTAMPADD(MICROSECOND, ?, NOW(3))
      LIMIT 1`, [req.user.userId, stage.id, (start - now) * 1000, (end - now) * 1000]);
    res.json(success({stage: stage.name, image: stage.image, active: now < end,
      period: new Date(start).toISOString().slice(0, 10), souvenir: stage.name + '纪念邮戳', completed: Boolean(completed)}));
  } catch (error) { next(error); }
});
module.exports = router;
