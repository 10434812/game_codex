const express = require('express');
const auth = require('../middleware/auth');
const wechatPayService = require('../services/wechat-pay-service');
const { success, fail } = require('../utils/response');

const router = express.Router();

router.post('/wechat/jsapi', auth, async (req, res, next) => {
  try {
    const { itemId } = req.body || {};
    if (!itemId) {
      return res.status(400).json(fail('缺少 itemId', 400));
    }
    const result = await wechatPayService.createJsapiOrder(req.user, itemId);
    res.json(success(result));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json(fail(err.message, err.status));
    }
    next(err);
  }
});

router.post('/wechat/orders/:orderNo/sync', auth, async (req, res, next) => {
  try {
    const result = await wechatPayService.syncPaidOrder(req.params.orderNo, req.user.userId);
    res.json(success(result));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json(fail(err.message, err.status));
    }
    next(err);
  }
});

router.post('/wechat/notify', async (req, res, next) => {
  try {
    const result = await wechatPayService.handlePaymentNotify(req.body, req.headers, req.rawBody);
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ code: 'FAIL', message: err.message });
    }
    next(err);
  }
});

module.exports = router;
