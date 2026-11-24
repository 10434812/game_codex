const router = require('express').Router();
const auth = require('../middleware/auth');
const service = require('../services/retention-service');
const {success} = require('../utils/response');
router.use(auth);
router.get('/', (req, res, next) => {
  const rawSessionId = req.query.sessionId;
  const sessionId = typeof rawSessionId === 'string' && /^[1-9]\d{0,9}$/.test(rawSessionId) ? Number(rawSessionId) : undefined;
  service.getSummary(req.user.userId, {sessionId}).then((data) => res.json(success(data))).catch(next);
});
router.post('/checkin', (req, res, next) => service.claimCheckin(req.user.userId).then((data) => res.json(success(data))).catch(next));
router.post('/milestones/:id/claim', (req, res, next) => service.claimMilestone(req.user.userId, req.params.id).then((data) => res.json(success(data))).catch(next));
module.exports = router;
