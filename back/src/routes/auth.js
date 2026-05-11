const express = require('express');
const authService = require('../services/auth-service');
const { success, fail } = require('../utils/response');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json(fail('缺少登录凭证 code', 400));
    }

    const result = await authService.login(code);
    res.json(success(result, '登录成功'));
  } catch (err) {
    // Handle WeChat API errors specifically
    if (err.message && err.message.startsWith('WeChat API error')) {
      return res.status(502).json(fail('微信服务暂不可用，请稍后重试', 502));
    }

    console.error('Login error:', err);
    res.status(500).json(fail('登录失败，请稍后重试', 500));
  }
});

module.exports = router;
