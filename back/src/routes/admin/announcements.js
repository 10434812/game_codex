const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const announcementService = require('../../services/admin-announcement-service');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try {
    const data = await announcementService.listAnnouncements(
      req.query.status || '',
      req.query.type || '',
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Announcements]', err);
    res.status(500).json(fail('获取公告列表失败', 500));
  }
});

router.get('/:id', adminAuth, async (req, res) => {
  try {
    const data = await announcementService.getAnnouncement(req.params.id);
    if (!data) return res.status(404).json(fail('公告不存在', 404));
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Announcement Detail]', err);
    res.status(500).json(fail('获取公告详情失败', 500));
  }
});

router.post('/', adminAuth, async (req, res) => {
  try {
    const data = await announcementService.createAnnouncement(
      req.body,
      req.admin.adminId
    );
    res.json(success(data, '创建成功'));
  } catch (err) {
    console.error('[Admin Create Announcement]', err);
    res.status(500).json(fail('创建公告失败', 500));
  }
});

router.put('/:id', adminAuth, async (req, res) => {
  try {
    const data = await announcementService.updateAnnouncement(
      req.params.id,
      req.body
    );
    if (!data) return res.status(404).json(fail('公告不存在', 404));
    res.json(success(data, '更新成功'));
  } catch (err) {
    console.error('[Admin Update Announcement]', err);
    res.status(500).json(fail('更新公告失败', 500));
  }
});

router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const deleted = await announcementService.deleteAnnouncement(req.params.id);
    if (!deleted) return res.status(404).json(fail('公告不存在', 404));
    res.json(success(null, '删除成功'));
  } catch (err) {
    console.error('[Admin Delete Announcement]', err);
    res.status(500).json(fail('删除公告失败', 500));
  }
});

router.put('/:id/publish', adminAuth, async (req, res) => {
  try {
    const data = await announcementService.publishAnnouncement(req.params.id);
    if (!data) return res.status(404).json(fail('公告不存在', 404));
    res.json(success(data, '发布成功'));
  } catch (err) {
    console.error('[Admin Publish Announcement]', err);
    res.status(500).json(fail('发布公告失败', 500));
  }
});

router.put('/:id/archive', adminAuth, async (req, res) => {
  try {
    const data = await announcementService.archiveAnnouncement(req.params.id);
    if (!data) return res.status(404).json(fail('公告不存在', 404));
    res.json(success(data, '归档成功'));
  } catch (err) {
    console.error('[Admin Archive Announcement]', err);
    res.status(500).json(fail('归档公告失败', 500));
  }
});

module.exports = router;
