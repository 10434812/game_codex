const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const adminService = require('../../services/admin-admin-service');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try { const data = await adminService.listAdmins(Number(req.query.page) || 1, Number(req.query.limit) || 20, req.query.keyword || ''); res.json(success(data)); }
  catch (err) { console.error('[Admin Admins]', err); res.status(500).json(fail('获取管理员列表失败', 500)); }
});

router.get('/:id', adminAuth, async (req, res) => {
  try { const data = await adminService.getAdmin(req.params.id); res.json(success(data)); }
  catch (err) { console.error('[Admin Admin Detail]', err); res.status(500).json(fail('获取管理员详情失败', 500)); }
});

router.post('/', adminAuth, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json(fail('用户名和密码不能为空', 400));
    const data = await adminService.createAdmin(username, password, role);
    res.json(success(data, '创建成功'));
  } catch (err) {
    console.error('[Admin Admin Create]', err);
    if (err.message === '用户名已存在') return res.status(409).json(fail('用户名已存在', 409));
    res.status(500).json(fail('创建管理员失败', 500));
  }
});

router.put('/:id', adminAuth, async (req, res) => {
  try { const data = await adminService.updateAdmin(req.params.id, req.body); res.json(success(data, '更新成功')); }
  catch (err) {
    if (err.message === '用户名已存在') return res.status(409).json(fail('用户名已存在', 409));
    if (err.message === '用户名不能为空') return res.status(400).json(fail('用户名不能为空', 400));
    console.error('[Admin Admin Update]', err);
    res.status(500).json(fail('更新管理员失败', 500));
  }
});

router.delete('/:id', adminAuth, async (req, res) => {
  try { const data = await adminService.deleteAdmin(req.params.id); res.json(success(data, '删除成功')); }
  catch (err) { console.error('[Admin Admin Delete]', err); res.status(500).json(fail('删除管理员失败', 500)); }
});

router.put('/:id/password', adminAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json(fail('新密码不能为空', 400));
    const data = await adminService.resetPassword(req.params.id, password);
    res.json(success(data, '密码重置成功'));
  } catch (err) {
    console.error('[Admin Admin Password]', err);
    res.status(500).json(fail('密码重置失败', 500));
  }
});

module.exports = router;
