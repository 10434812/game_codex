const express = require('express');
const authService = require('../services/auth-service');
const db = require('../models/db');
const { success, fail } = require('../utils/response');

const router = express.Router();

async function handleLogin(req, res, refresh) {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json(fail('缺少登录凭证 code', 400));
    }

    const authorization = req.headers.authorization || '';
    if (refresh && !authorization.startsWith('Bearer ')) {
      return res.status(401).json(fail('缺少登录凭证', 401));
    }
    const result = await authService.login(code, refresh ? {previousToken: authorization.slice(7)} : undefined);

    // 封禁校验：被封禁用户不发放新 token（旧 token 由 auth 中间件拦截）
    const userRow = await db.queryOne('SELECT is_banned FROM users WHERE id = ?', [result.user.id]);
    if (userRow && (userRow.is_banned === 1 || userRow.is_banned === true)) {
      return res.status(403).json(fail('账号已被封禁，请联系客服', 403));
    }

    res.json(success(result, '登录成功'));
  } catch (err) {
    if (err.statusCode === 401 || err.statusCode === 403) {
      return res.status(err.statusCode).json(fail(err.message, err.statusCode));
    }
    if (err.message === 'WeChat login disabled') {
      return res.status(403).json(fail('微信登录已关闭', 403));
    }
    if (err.message === 'WeChat login config missing') {
      return res.status(500).json(fail('微信登录配置缺失，请先在后台完成配置', 500));
    }
    // Handle WeChat API errors specifically
    if (err.message && err.message.startsWith('WeChat API error')) {
      return res.status(502).json(fail('微信服务暂不可用，请稍后重试', 502));
    }

    console.error('Login error:', err);
    res.status(500).json(fail('登录失败，请稍后重试', 500));
  }
}

router.post('/login', (req, res) => handleLogin(req, res, false));
router.post('/refresh', (req, res) => handleLogin(req, res, true));

module.exports = router;
