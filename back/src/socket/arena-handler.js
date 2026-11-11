const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../models/db');
const gameService = require('../services/game-service');
const { assertActiveUser, watchAccount } = require('./account-guard');

// Map: socket.id -> { userId, sessionId }
const connectedClients = new Map();

/**
 * Membership guard: the socket's JWT user must be a player (game_players row)
 * of the target session. Emits an arena_error event when rejected.
 * @returns {Promise<boolean>} true when the user is allowed to act.
 */
async function isSessionMember(socket, sessionId) {
  if (!sessionId) {
    return false;
  }
  try {
    const row = await db.queryOne(
      'SELECT 1 FROM game_players WHERE session_id = ? AND user_id = ?',
      [sessionId, socket.userId]
    );
    if (!row) {
      socket.emit('arena_error', { code: 403, message: 'not_arena_member', sessionId });
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[Socket] member check failed for session ${sessionId}, user ${socket.userId}:`, err);
    socket.emit('arena_error', { code: 500, message: 'member_check_failed', sessionId });
    return false;
  }
}

function initSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, config.jwt.secret);
      await assertActiveUser(decoded.userId);
      socket.userId = decoded.userId;
      socket.openid = decoded.openid;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] User ${socket.userId} connected: ${socket.id}`);
    const stopWatching = watchAccount(socket.userId, () => socket.disconnect(true));

    // Catch both synchronous exceptions and rejected async handlers.
    const onAction = (event, handler) => {
      socket.on(event, async (payload) => {
        try {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || !['number', 'string'].includes(typeof payload.sessionId)
            || !Number.isSafeInteger(Number(payload.sessionId)) || Number(payload.sessionId) <= 0) {
            socket.emit('arena_error', { code: 400, message: 'invalid_payload' });
            return;
          }
          await assertActiveUser(socket.userId);
          await handler({ ...payload, sessionId: Number(payload.sessionId) });
        } catch (err) {
          socket.emit('arena_error', { code: err.statusCode || 500, message: 'action_failed' });
          if (err.statusCode === 401 || err.statusCode === 403) socket.disconnect(true);
        }
      });
    };

    // Join arena session
    onAction('join_arena', async ({ sessionId }) => {
      if (!sessionId) return;
      // Security: only players of this session may join its room.
      if (!(await isSessionMember(socket, sessionId))) {
        return;
      }
      await socket.join(`arena:${sessionId}`);
      connectedClients.set(socket.id, { userId: socket.userId, sessionId });
      console.log(`[Socket] User ${socket.userId} joined arena:${sessionId}`);

      // Send current state
      const state = gameService.getGameState(sessionId, socket.userId);
      if (state) {
        socket.emit('game_state', state);
      }
    });

    // Leave arena
    onAction('leave_arena', async ({ sessionId }) => {
      await socket.leave(`arena:${sessionId}`);
      connectedClients.delete(socket.id);
    });

    // Emote
    onAction('emote', async ({ sessionId, emoteId }) => {
      if (!['string', 'number'].includes(typeof emoteId) || !String(emoteId).trim()) {
        socket.emit('arena_error', { code: 400, message: 'invalid_emote' });
        return;
      }
      if (sessionId && emoteId) {
        // Security: only players of this session may broadcast emotes.
        if (!(await isSessionMember(socket, sessionId))) {
          return;
        }
        socket.to(`arena:${sessionId}`).emit('emote_broadcast', {
          fromUserId: socket.userId,
          emoteId,
        });
      }
    });

    // Fortune bag actions
    onAction('fortune_buy', async ({ sessionId, opportunity }) => {
      if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) {
        socket.emit('arena_error', { code: 400, message: 'invalid_opportunity' });
        return;
      }
      // Security: only players of this session may act on its fortune bag.
      if (!(await isSessionMember(socket, sessionId))) {
        return;
      }
      socket.to(`arena:${sessionId}`).emit('fortune_result', {
        userId: socket.userId,
        action: 'buy',
        opportunity,
      });
    });

    socket.on('disconnect', () => {
      stopWatching();
      console.log(`[Socket] User ${socket.userId} disconnected: ${socket.id}`);
      connectedClients.delete(socket.id);
    });
  });
}

module.exports = initSocket;
