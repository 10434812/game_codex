const express = require('express');
const authMiddleware = require('../middleware/auth');
const { success, fail } = require('../utils/response');
const roomService = require('../services/room-service');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /api/rooms — Create a new room
 */
router.post('/', async (req, res) => {
  try {
    const { stageId } = req.body;

    if (!stageId) {
      return res.status(400).json(fail('请选择景区', 400));
    }

    const result = await roomService.createRoom(req.user.userId, stageId);
    return res.json(success(result, '房间创建成功'));
  } catch (err) {
    console.error('[rooms] createRoom error:', err);
    return res.status(err.statusCode || 500).json(fail(err.message));
  }
});

/**
 * GET /api/rooms — List available rooms
 */
router.get('/', async (req, res) => {
  try {
    const rooms = await roomService.listAvailableRooms();
    return res.json(success(rooms));
  } catch (err) {
    console.error('[rooms] listRooms error:', err);
    return res.status(500).json(fail('获取房间列表失败'));
  }
});

/**
 * GET /api/rooms/:id — Get room details
 */
router.get('/:id', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (isNaN(roomId)) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.getRoom(roomId);
    if (!result) {
      return res.status(404).json(fail('房间不存在', 404));
    }

    return res.json(success(result));
  } catch (err) {
    console.error('[rooms] getRoom error:', err);
    return res.status(500).json(fail('获取房间信息失败'));
  }
});

/**
 * POST /api/rooms/:id/join — Join a room
 */
router.post('/:id/join', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (isNaN(roomId)) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.joinRoom(roomId, req.user.userId);
    return res.json(success(result, '加入房间成功'));
  } catch (err) {
    console.error('[rooms] joinRoom error:', err);
    return res.status(err.statusCode || 500).json(fail(err.message));
  }
});

/**
 * POST /api/rooms/:id/leave — Leave a room
 */
router.post('/:id/leave', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (isNaN(roomId)) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.leaveRoom(roomId, req.user.userId);
    return res.json(success(result, '已离开房间'));
  } catch (err) {
    console.error('[rooms] leaveRoom error:', err);
    return res.status(err.statusCode || 500).json(fail(err.message));
  }
});

/**
 * POST /api/rooms/:id/ready — Toggle ready status
 */
router.post('/:id/ready', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (isNaN(roomId)) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.toggleReady(roomId, req.user.userId);
    return res.json(success(result));
  } catch (err) {
    console.error('[rooms] toggleReady error:', err);
    return res.status(err.statusCode || 500).json(fail(err.message));
  }
});

/**
 * POST /api/rooms/:id/start — Start the game
 */
router.post('/:id/start', async (req, res) => {
  try {
    const roomId = parseInt(req.params.id, 10);
    if (isNaN(roomId)) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.startGame(roomId, req.user.userId);

    const io = req.app.get('io');
    if (io && result && result.sessionId) {
      const gameService = require('../services/game-service');
      gameService.startGameSession(result.roomId, req.user.userId, io).catch(err => {
        console.error('[rooms] startTickLoop error:', err);
      });
    }

    return res.json(success(result, '游戏开始'));
  } catch (err) {
    console.error('[rooms] startGame error:', err);
    return res.status(err.statusCode || 500).json(fail(err.message));
  }
});

module.exports = router;
