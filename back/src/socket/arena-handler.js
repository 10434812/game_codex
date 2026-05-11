const jwt = require('jsonwebtoken');
const config = require('../config');
const gameService = require('../services/game-service');

// Map: socket.id -> { userId, sessionId }
const connectedClients = new Map();

function initSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.userId = decoded.userId;
      socket.openid = decoded.openid;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] User ${socket.userId} connected: ${socket.id}`);

    // Join arena session
    socket.on('join_arena', ({ sessionId }) => {
      if (!sessionId) return;
      socket.join(`arena:${sessionId}`);
      connectedClients.set(socket.id, { userId: socket.userId, sessionId });
      console.log(`[Socket] User ${socket.userId} joined arena:${sessionId}`);

      // Send current state
      const state = gameService.getGameState(sessionId);
      if (state) {
        socket.emit('game_state', state);
      }
    });

    // Leave arena
    socket.on('leave_arena', ({ sessionId }) => {
      if (sessionId) socket.leave(`arena:${sessionId}`);
      connectedClients.delete(socket.id);
    });

    // Emote
    socket.on('emote', ({ sessionId, emoteId }) => {
      if (sessionId && emoteId) {
        socket.to(`arena:${sessionId}`).emit('emote_broadcast', {
          fromUserId: socket.userId,
          emoteId,
        });
      }
    });

    // Fortune bag actions
    socket.on('fortune_buy', ({ sessionId, opportunity }) => {
      socket.to(`arena:${sessionId}`).emit('fortune_result', {
        userId: socket.userId,
        action: 'buy',
        opportunity,
      });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] User ${socket.userId} disconnected: ${socket.id}`);
      connectedClients.delete(socket.id);
    });
  });
}

module.exports = initSocket;
