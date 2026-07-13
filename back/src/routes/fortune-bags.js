const express = require('express');
const fortuneService = require('../services/fortune-reality-service');
const { success, fail } = require('../utils/response');

const router = express.Router();

router.get('/public', async (_req, res) => {
  try {
    const data = await fortuneService.getLatestPublicFeed();
    res.json(success(data));
  } catch (err) {
    console.error('[Public Fortune Bags]', err);
    res.status(500).json(fail('获取福袋现实数据失败', 500));
  }
});

module.exports = router;
