const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const logService = require('../../services/admin-log-service');
const { success, fail } = require('../../utils/response');

router.get('/stats', adminAuth, async (req, res) => {
  try {
    const data = await logService.getLogStats();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Log Stats]', err);
    res.status(500).json(fail('获取日志统计失败', 500));
  }
});

router.get('/', adminAuth, async (req, res) => {
  try {
    const filters = {};
    if (req.query.action) filters.action = req.query.action;
    if (req.query.targetType) filters.targetType = req.query.targetType;
    if (req.query.adminId) filters.adminId = Number(req.query.adminId);
    if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom;
    if (req.query.dateTo) filters.dateTo = req.query.dateTo;

    const data = await logService.listLogs(
      filters,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Logs]', err);
    res.status(500).json(fail('获取操作日志失败', 500));
  }
});

router.get('/:id', adminAuth, async (req, res) => {
  try {
    const data = await logService.getLog(req.params.id);
    if (!data) return res.status(404).json(fail('日志不存在', 404));
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Log Detail]', err);
    res.status(500).json(fail('获取日志详情失败', 500));
  }
});

module.exports = router;
