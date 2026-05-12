const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const userService = require('../../services/admin-user-service');
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
  try { const data = await userService.toggleBan(req.params.id, req.body.isBanned, req.body.reason || ''); res.json(success(data)); }
  catch (err) { console.error('[Admin Ban]', err); res.status(500).json(fail('操作失败', 500)); }
});

router.put('/:id/coins', adminAuth, async (req, res) => {
  try { const data = await userService.adjustCoins(req.params.id, Number(req.body.amount) || 0, req.body.reason || ''); res.json(success(data)); }
  catch (err) { console.error('[Admin Coins]', err); res.status(500).json(fail('调整金币失败', 500)); }
});

module.exports = router;
