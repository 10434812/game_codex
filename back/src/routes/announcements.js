const express = require('express');
const router = express.Router();
const announcementService = require('../services/admin-announcement-service');
const { success, fail } = require('../utils/response');

// Public endpoint: published announcements for the mini-program.
// No auth required — only status='published' rows are returned.
// GET /api/announcements?limit=10
router.get('/', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const records = await announcementService.listPublishedAnnouncements(limit);
    res.json(success(records));
  } catch (err) {
    console.error('[Public Announcements]', err);
    res.status(500).json(fail('获取公告失败', 500));
  }
});

module.exports = router;
