const express = require('express');
const configService = require('../services/admin-config-service');
const { success, fail } = require('../utils/response');

const router = express.Router();

router.get('/public', async (_req, res) => {
  try {
    const data = await configService.getPublicConfigs();
    res.json(success(data));
  } catch (err) {
    console.error('[Public Configs]', err);
    res.status(500).json(fail('获取公共配置失败', 500));
  }
});

module.exports = router;
