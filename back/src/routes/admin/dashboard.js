const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const dashboardService = require('../../services/dashboard-service');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try {
    const data = await dashboardService.getDashboard();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Dashboard]', err);
    res.status(500).json(fail('获取仪表盘数据失败', 500));
  }
});

module.exports = router;
