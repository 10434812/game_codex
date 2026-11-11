const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const configService = require('../../services/admin-config-service');
const { logOperation } = require('../../middleware/operation-logger');
const { success, fail } = require('../../utils/response');

// Sensitive config keys are masked in operation logs (see operation-logger's
// sanitizeDetail; value keys named secret/api_key/private_key etc. are masked
// automatically, plus the ones below).
const SENSITIVE_CONFIG_KEYS = [
  'wechat.login_secret',
  'ai.api_key',
];

router.get('/', adminAuth, async (req, res) => {
  try {
    const data = await configService.getAllConfigs();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Configs]', err);
    res.status(500).json(fail('获取配置列表失败', 500));
  }
});

router.get('/summary', adminAuth, async (_req, res) => {
  try {
    const data = await configService.getAdminConfigSummary();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Config Summary]', err);
    res.status(500).json(fail('获取配置摘要失败', 500));
  }
});

router.put('/', adminAuth, async (req, res) => {
  try {
    const configs = req.body.configs;
    if (!configs || !Array.isArray(configs) || configs.length === 0) {
      return res.status(400).json(fail('参数 configs 数组不能为空', 400));
    }
    const data = await configService.updateConfigs(configs, req.admin.adminId);
    await logOperation(req.admin, 'update', 'config', '', {
      keys: configs.map((item) => item && item.key),
      values: configs.map((item) => (SENSITIVE_CONFIG_KEYS.includes(item && item.key) ? '***' : item && item.value)),
    }, req.ip);
    res.json(success(data, '批量更新成功'));
  } catch (err) {
    console.error('[Admin Batch Configs]', err);
    res.status(500).json(fail('批量更新配置失败', 500));
  }
});

// NOTE(configs/:key, task 8): single-key GET/PUT endpoints are kept for API
// completeness / future use. SystemConfig.vue currently consumes only
// GET /configs, GET /configs/summary and PUT /configs (batch).
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
    await logOperation(req.admin, 'update', 'config', req.params.key, {
      key: req.params.key,
      value: SENSITIVE_CONFIG_KEYS.includes(req.params.key) ? '***' : String(req.body.value),
    }, req.ip);
    res.json(success(data, '更新成功'));
  } catch (err) {
    console.error('[Admin Update Config]', err);
    res.status(500).json(fail('更新配置失败', 500));
  }
});

module.exports = router;
