const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const itemService = require('../../services/admin-item-service');
const { logOperation } = require('../../middleware/operation-logger');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try {
    const data = await itemService.listItems();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Items]', err);
    res.status(500).json(fail('获取道具列表失败', 500));
  }
});

// NOTE(items/:id, task 8): kept for API completeness; ItemList.vue renders
// the full list (including inactive items) and does not call this endpoint.
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const data = await itemService.getItem(req.params.id);
    if (!data) return res.status(404).json(fail('道具不存在', 404));
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Item Detail]', err);
    res.status(500).json(fail('获取道具详情失败', 500));
  }
});

router.post('/', adminAuth, async (req, res) => {
  try {
    const data = await itemService.createItem(req.body);
    await logOperation(req.admin, 'create', 'item', data.id, {
      itemId: data.id,
      name: data.name,
      category: data.category,
      price: data.price,
    }, req.ip);
    res.json(success(data, '道具创建成功'));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json(fail('道具ID已存在', 409));
    console.error('[Admin Create Item]', err);
    res.status(500).json(fail('创建道具失败', 500));
  }
});

router.put('/:id', adminAuth, async (req, res) => {
  try {
    const data = await itemService.updateItem(req.params.id, req.body);
    if (!data) return res.status(404).json(fail('道具不存在', 404));
    await logOperation(req.admin, 'update', 'item', req.params.id, {
      itemId: req.params.id,
      name: data.name,
      category: data.category,
      price: data.price,
    }, req.ip);
    res.json(success(data, '道具更新成功'));
  } catch (err) {
    console.error('[Admin Update Item]', err);
    res.status(500).json(fail('更新道具失败', 500));
  }
});

router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await itemService.deleteItem(req.params.id);
    await logOperation(req.admin, 'delete', 'item', req.params.id, { itemId: req.params.id }, req.ip);
    res.json(success(null, '道具已删除'));
  } catch (err) {
    console.error('[Admin Delete Item]', err);
    res.status(500).json(fail('删除道具失败', 500));
  }
});

router.put('/:id/toggle', adminAuth, async (req, res) => {
  try {
    const data = await itemService.toggleActive(req.params.id);
    await logOperation(req.admin, 'toggle', 'item', req.params.id, {
      itemId: req.params.id,
      isActive: data && data.is_active,
    }, req.ip);
    res.json(success(data, '状态已更新'));
  } catch (err) {
    console.error('[Admin Toggle Item]', err);
    res.status(500).json(fail('更新道具状态失败', 500));
  }
});

module.exports = router;
