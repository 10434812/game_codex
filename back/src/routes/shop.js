const express = require('express');
const auth = require('../middleware/auth');
const shopService = require('../services/shop-service');
const { success, fail } = require('../utils/response');

const router = express.Router();

// All shop routes require authentication
router.use(auth);

// GET /api/shop/items — catalog listing
router.get('/items', async (req, res, next) => {
  try {
    const items = await shopService.getItems();
    res.json(success(items));
  } catch (err) {
    next(err);
  }
});

// POST /api/shop/buy — purchase an item
router.post('/buy', async (req, res, next) => {
  try {
    const { itemId } = req.body;
    if (!itemId) {
      return res.status(400).json(fail('缺少 itemId'));
    }

    const result = await shopService.buyItem(req.user.userId, itemId);
    res.json(success(result));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json(fail(err.message, err.status));
    }
    next(err);
  }
});

// POST /api/shop/equip — equip an owned item
router.post('/equip', async (req, res, next) => {
  try {
    const { itemId, category } = req.body;
    if (!itemId || !category) {
      return res.status(400).json(fail('缺少 itemId 或 category'));
    }
    if (!['skin', 'pet'].includes(category)) {
      return res.status(400).json(fail('category 必须为 skin 或 pet'));
    }

    const result = await shopService.equipItem(req.user.userId, itemId, category);
    res.json(success(result));
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json(fail(err.message, err.status));
    }
    next(err);
  }
});

// GET /api/shop/inventory — user's owned items
router.get('/inventory', async (req, res, next) => {
  try {
    const items = await shopService.getInventory(req.user.userId);
    res.json(success(items));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
