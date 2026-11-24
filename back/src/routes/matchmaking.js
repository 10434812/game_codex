const router = require('express').Router();
const auth = require('../middleware/auth');
const matchmaking = require('../services/matchmaking-service');
const challenges = require('../services/friend-challenge-service');
const {success} = require('../utils/response');
router.use(auth);
router.get('/challenge/:code', async (req, res, next) => {
  try {
    const {stageId} = await challenges.resolve(req.params.code, req.user.userId);
    res.json(success({stageId}));
  } catch (error) {next(error);}
});
router.post('/', async (req, res, next) => {
  try {
    const {stageId, createFriendRoomIfEmpty, challengeCode} = req.body || {};
    const normalizedChallenge = typeof challengeCode === 'string' ? challengeCode.trim() : '';
    const challenge = normalizedChallenge ? await challenges.resolve(normalizedChallenge, req.user.userId) : undefined;
    res.json(success(await matchmaking.join(req.user.userId, challenge?.stageId ?? Number(stageId), {
      createFriendRoomIfEmpty: !challenge && createFriendRoomIfEmpty === true,
      challenge,
    })));
  }
  catch (error) {next(error);}
});
module.exports = router;
