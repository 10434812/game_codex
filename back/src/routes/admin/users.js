const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const userService = require('../../services/admin-user-service');
const { logOperation } = require('../../middleware/operation-logger');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try { const data = await userService.listUsers(Number(req.query.page) || 1, Number(req.query.limit) || 20, req.query.keyword || ''); res.json(success(data)); }
  catch (err) { console.error('[Admin Users]', err); res.status(500).json(fail('获取用户列表失败', 500)); }
});

router.get('/:id', adminAuth, async (req, res) => {
  try {
    const data = await userService.getUserDetail(req.params.id);
    if (!data) return res.status(404).json(fail('用户不存在', 404));
    res.json(success(data));
  }
  catch (err) { console.error('[Admin User Detail]', err); res.status(500).json(fail('获取用户详情失败', 500)); }
});

router.put('/:id/ban', adminAuth, async (req, res) => {
  try {
    const isBanned = !!req.body.isBanned;
    const data = await userService.toggleBan(req.params.id, isBanned, req.body.reason || '');
    await logOperation(req.admin, isBanned ? 'ban' : 'unban', 'user', req.params.id, {
      userId: req.params.id,
      isBanned,
      reason: req.body.reason || '',
    }, req.ip);
    res.json(success(data));
  }
  catch (err) { console.error('[Admin Ban]', err); res.status(500).json(fail('操作失败', 500)); }
});

router.put('/:id/coins', adminAuth, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const data = await userService.adjustCoins(req.params.id, amount, req.body.reason || '');
    await logOperation(req.admin, 'adjust_coins', 'user', req.params.id, {
      userId: req.params.id,
      amount: data.amount,
      requestedAmount: amount,
      reason: req.body.reason || '',
      coinsAfter: data.coins,
    }, req.ip);
    res.json(success(data));
  }
  catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('[Admin Coins]', err);
    res.status(status).json(fail(status < 500 ? err.message : '调整金币失败', status));
  }
});

module.exports = router;
