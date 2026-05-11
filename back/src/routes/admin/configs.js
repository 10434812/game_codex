const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const configService = require('../../services/admin-config-service');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try {
    const data = await configService.getAllConfigs();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Configs]', err);
    res.status(500).json(fail('获取配置列表失败', 500));
  }
});

router.put('/', adminAuth, async (req, res) => {
  try {
    const configs = req.body.configs;
    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json(fail('参数 configs 数组不能为空', 400));
    }
    const data = await configService.updateConfigs(configs, req.admin.adminId);
    res.json(success(data, '批量更新成功'));
  } catch (err) {
    console.error('[Admin Batch Configs]', err);
    res.status(500).json(fail('批量更新配置失败', 500));
  }
});

router.get('/:key', adminAuth, async (req, res) => {
  try {
    const value = await configService.getConfig(req.params.key);
    if (value === null) return res.status(404).json(fail('配置项不存在', 404));
    res.json(success({ key: req.params.key, value }));
  } catch (err) {
    console.error('[Admin Get Config]', err);
    res.status(500).json(fail('获取配置失败', 500));
  }
});

router.put('/:key', adminAuth, async (req, res) => {
  try {
    if (req.body.value === undefined) {
      return res.status(400).json(fail('参数 value 不能为空', 400));
    }
    const data = await configService.updateConfig(
      req.params.key,
      String(req.body.value),
      req.admin.adminId
    );
    res.json(success(data, '更新成功'));
  } catch (err) {
    console.error('[Admin Update Config]', err);
    res.status(500).json(fail('更新配置失败', 500));
  }
});

module.exports = router;
