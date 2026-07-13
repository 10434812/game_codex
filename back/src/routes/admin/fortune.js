const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const fortuneService = require('../../services/fortune-reality-service');
const { logOperation } = require('../../middleware/operation-logger');
const { success, fail } = require('../../utils/response');

router.get('/summary', adminAuth, async (_req, res) => {
  try {
    const data = await fortuneService.getSummary();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Fortune Summary]', err);
    res.status(500).json(fail('获取福袋现实数据摘要失败', 500));
  }
});

router.get('/sources', adminAuth, async (_req, res) => {
  try {
    const data = await fortuneService.listSources();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Fortune Sources]', err);
    res.status(500).json(fail('获取福袋数据源失败', 500));
  }
});

router.put('/sources/:id', adminAuth, async (req, res) => {
  try {
    const data = await fortuneService.updateSource(req.params.id, req.body || {});
    if (!data) return res.status(404).json(fail('数据源不存在', 404));
    await logOperation(req.admin, 'update', 'fortune_source', req.params.id, req.body, req.ip);
    res.json(success(data, '数据源已更新'));
  } catch (err) {
    console.error('[Admin Update Fortune Source]', err);
    res.status(500).json(fail('更新福袋数据源失败', 500));
  }
});

router.get('/snapshots', adminAuth, async (req, res) => {
  try {
    const data = await fortuneService.listSnapshots({
      category: req.query.category,
      limit: req.query.limit,
    });
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Fortune Snapshots]', err);
    res.status(500).json(fail('获取福袋现实快照失败', 500));
  }
});

router.get('/report/latest', adminAuth, async (_req, res) => {
  try {
    const data = await fortuneService.getLatestReport();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Fortune Report]', err);
    res.status(500).json(fail('获取福袋摘要失败', 500));
  }
});

router.post('/report/generate', adminAuth, async (req, res) => {
  try {
    const data = await fortuneService.generateDigestReport();
    await logOperation(req.admin, 'generate', 'fortune_report', data && data.id, {}, req.ip);
    res.json(success(data, '福袋摘要已生成'));
  } catch (err) {
    console.error('[Admin Generate Fortune Report]', err);
    res.status(500).json(fail('生成福袋摘要失败', 500));
  }
});

router.post('/refresh', adminAuth, async (req, res) => {
  try {
    const data = await fortuneService.refreshSources({
      sourceKey: req.body && req.body.sourceKey,
      force: req.body && req.body.force !== false,
      generateReport: req.body && req.body.generateReport !== false,
    });
    await logOperation(req.admin, 'refresh', 'fortune_source', req.body && req.body.sourceKey, data, req.ip);
    res.json(success(data, '福袋现实数据刷新完成'));
  } catch (err) {
    console.error('[Admin Refresh Fortune]', err);
    res.status(500).json(fail('刷新福袋现实数据失败', 500));
  }
});

module.exports = router;
