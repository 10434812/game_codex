const express = require('express');
const auth = require('../middleware/auth');
const service = require('../services/daily-task-service');
const {success} = require('../utils/response');
const router = express.Router();
router.use(auth);
router.get('/', (req, res, next) => service.getTasks(req.user.userId).then((data) => res.json(success(data))).catch(next));
router.post('/:id/claim', (req, res, next) => service.claim(req.user.userId, req.params.id).then((data) => res.json(success(data))).catch(next));
module.exports = router;
