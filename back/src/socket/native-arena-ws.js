const jwt = require('jsonwebtoken');
const {WebSocket, WebSocketServer} = require('ws');
const config = require('../config');
const gameService = require('../services/game-service');

const clientsBySession = new Map();

function sendJson(ws, event, data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({event, data}));
}

function addClient(sessionId, ws) {
  const key = String(sessionId);
  if (!clientsBySession.has(key)) {
    clientsBySession.set(key, new Set());
  }
  clientsBySession.get(key).add(ws);
}

function removeClient(ws) {
  const sessionId = ws.sessionId;
  if (!sessionId) {
    return;
  }
  const clients = clientsBySession.get(String(sessionId));
  if (!clients) {
    return;
  }
  clients.delete(ws);
  if (!clients.size) {
    clientsBySession.delete(String(sessionId));
  }
}

function createBroadcaster(socketIo) {
  return {
    to(room) {
      const sessionId = String(room || '').replace(/^arena:/, '');
      return {
        emit(event, data) {
          if (socketIo) {
            socketIo.to(room).emit(event, data);
          }
          const clients = clientsBySession.get(sessionId);
          if (!clients) {
            return;
          }
          clients.forEach((ws) => {
            if (event === 'game_tick' || event === 'time_update') {
              const state = gameService.getGameState(sessionId, ws.userId);
              if (state) {
                sendJson(ws, 'game_state', state);
              }
              return;
            }
            sendJson(ws, event, data);
          });
        },
      };
    },
  };
}

function initNativeArenaWs(server, socketIo) {
  const wss = new WebSocketServer({server, path: '/ws/arena'});
  const broadcaster = createBroadcaster(socketIo);

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const sessionId = url.searchParams.get('sessionId');
      if (!token || !sessionId) {
        ws.close(1008, 'missing token or sessionId');
        return;
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      ws.userId = decoded.userId;
      ws.sessionId = String(sessionId);
      addClient(sessionId, ws);

      const state = gameService.getGameState(sessionId, decoded.userId);
      if (state) {
        sendJson(ws, 'game_state', state);
      }

      ws.on('message', (raw) => {
        let message = null;
        try {
          message = JSON.parse(String(raw || ''));
        } catch (_err) {
          return;
        }
        if (message && message.event === 'ping') {
          sendJson(ws, 'pong', {time: Date.now()});
        }
      });
    } catch (_err) {
      ws.close(1008, 'invalid token');
    }
  });

  wss.on('close', () => {
    clientsBySession.clear();
  });

  wss.on('connection', (ws) => {
    ws.on('close', () => removeClient(ws));
    ws.on('error', () => removeClient(ws));
  });

  return {wss, broadcaster};
}

module.exports = {
  initNativeArenaWs,
  createBroadcaster,
};
