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
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, status));
  }
});

/**
 * GET /api/rooms — List waiting rooms the current user belongs to
 */
router.get('/', async (req, res) => {
  try {
    const rooms = await roomService.listAvailableRooms(req.user.userId);
    return res.json(success(rooms));
  } catch (err) {
    console.error('[rooms] listRooms error:', err);
    return res.status(500).json(fail('获取房间列表失败'));
  }
});

/**
 * GET /api/rooms/:id — Get room details (members only to prevent ID enumeration)
 */
router.get('/:id', async (req, res) => {
  try {
    const roomId = String(req.params.id || '').trim();
    if (!roomId) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.getRoom(roomId, req.user.userId);
    if (!result || !Array.isArray(result.players) || !result.players.some((p) => Number(p.user_id) === Number(req.user.userId))) {
      return res.status(404).json(fail('房间不存在', 404));
    }

    return res.json(success(result));
  } catch (err) {
    console.error('[rooms] getRoom error:', err);
    return res.status(500).json(fail('获取房间信息失败'));
  }
});

/**
 * GET /api/rooms/code/:code — Get room details by room code
 */
router.get('/code/:code', async (req, res) => {
  try {
    const result = await roomService.getRoomByCode(req.params.code, req.user.userId);
    if (!result) {
      return res.status(404).json(fail('房间不存在', 404));
    }
    return res.json(success(result));
  } catch (err) {
    console.error('[rooms] getRoomByCode error:', err);
    return res.status(500).json(fail('获取房间信息失败'));
  }
});

/**
 * POST /api/rooms/:id/join — Join a room
 */
router.post('/:id/join', async (req, res) => {
  try {
    const roomId = String(req.params.id || '').trim();
    if (!roomId) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.joinRoom(roomId, req.user.userId);
    return res.json(success(result, '加入房间成功'));
  } catch (err) {
    console.error('[rooms] joinRoom error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, status));
  }
});

/**
 * POST /api/rooms/code/:code/join — Join a room by room code
 */
router.post('/code/:code/join', async (req, res) => {
  try {
    const result = await roomService.joinRoomByCode(req.params.code, req.user.userId);
    return res.json(success(result, '加入房间成功'));
  } catch (err) {
    console.error('[rooms] joinRoomByCode error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, status));
  }
});

/**
 * POST /api/rooms/:id/leave — Leave a room
 */
router.post('/:id/leave', async (req, res) => {
  try {
    const roomId = String(req.params.id || '').trim();
    if (!roomId) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.leaveRoom(roomId, req.user.userId);
    return res.json(success(result, '已离开房间'));
  } catch (err) {
    console.error('[rooms] leaveRoom error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, status));
  }
});

/**
 * POST /api/rooms/:id/ready — Toggle ready status
 */
router.post('/:id/ready', async (req, res) => {
  try {
    const roomId = String(req.params.id || '').trim();
    if (!roomId) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.toggleReady(roomId, req.user.userId);
    return res.json(success(result));
  } catch (err) {
    console.error('[rooms] toggleReady error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, status));
  }
});

/**
 * POST /api/rooms/:id/start — Start the game
 */
router.post('/:id/start', async (req, res) => {
  try {
    const roomId = String(req.params.id || '').trim();
    if (!roomId) {
      return res.status(400).json(fail('无效的房间ID'));
    }

    const result = await roomService.startGame(roomId, req.user.userId);

    // Await session initialization instead of fire-and-forget: a failure here
    // (e.g. DB error) must reach the client instead of silently leaving the
    // room stuck in 'playing' with no tick loop driving it.
    const arenaRealtime = req.app.get('arenaRealtime');
    if (result && result.sessionId) {
      const gameService = require('../services/game-service');
      try {
        await gameService.startGameSession(result.roomId, req.user.userId, arenaRealtime);
      } catch (err) {
        try {
          await gameService.recoverFailedStart(result.sessionId);
        } catch (recoveryError) {
          console.error('[rooms] failed start recovery error:', recoveryError);
        }
        throw err;
      }
    }

    return res.json(success(result, '游戏开始'));
  } catch (err) {
    console.error('[rooms] startGame error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json(fail(err.message, status));
  }
});

module.exports = router;
