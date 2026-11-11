const express = require('express');
const router = express.Router();
const adminAuth = require('../../middleware/admin-auth');
const roomService = require('../../services/admin-room-service');
const { logOperation } = require('../../middleware/operation-logger');
const { success, fail } = require('../../utils/response');

router.get('/', adminAuth, async (req, res) => {
  try {
    const data = await roomService.listRooms(req.query.status || '', Number(req.query.page) || 1, Number(req.query.limit) || 20);
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Rooms]', err);
    res.status(500).json(fail('获取房间列表失败', 500));
  }
});

router.get('/stats', adminAuth, async (req, res) => {
  try {
    const data = await roomService.getRoomStats();
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Room Stats]', err);
    res.status(500).json(fail('获取房间统计失败', 500));
  }
});

router.get('/:id', adminAuth, async (req, res) => {
  try {
    const data = await roomService.getRoomDetail(req.params.id);
    if (!data) return res.status(404).json(fail('房间不存在', 404));
    res.json(success(data));
  } catch (err) {
    console.error('[Admin Room Detail]', err);
    res.status(500).json(fail('获取房间详情失败', 500));
  }
});

router.put('/:id/close', adminAuth, async (req, res) => {
  try {
    const settle = String(req.query.settle || 'true') !== 'false';
    const data = await roomService.forceCloseRoom(req.params.id, {
      realtime: req.app.get('arenaRealtime') || null,
      settle,
    });
    await logOperation(req.admin, 'close', 'room', req.params.id, {
      roomId: req.params.id,
      sessionId: data.sessionId,
      settle,
    }, req.ip);
    res.json(success(data, '房间已强制关闭'));
  } catch (err) {
    console.error('[Admin Close Room]', err);
    res.status(500).json(fail('强制关闭房间失败', 500));
  }
});

module.exports = router;
