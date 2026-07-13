const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const gameService = require('../services/game-service');

function parseUpgradeRequest(req) {
  const requestUrl = new URL(req.url, 'http://localhost');
  if (requestUrl.pathname !== '/ws/arena') {
    return null;
  }

  const token = requestUrl.searchParams.get('token') || '';
  const sessionId = Number(requestUrl.searchParams.get('sessionId') || 0);
  if (!token || !sessionId) {
    return { error: 'missing_credentials' };
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return {
      userId: decoded.userId,
      sessionId,
    };
  } catch (_err) {
    return { error: 'invalid_token' };
  }
}

function safeSend(ws, event, data) {
  if (!ws || ws.readyState !== ws.OPEN) {
    return;
  }
  try {
    ws.send(JSON.stringify({ event, data }));
  } catch (_err) {}
}

function createArenaRealtimeHub(server) {
  const wss = new WebSocketServer({ noServer: true });
  const sessionClients = new Map();

  function removeClient(ws) {
    const sessionId = Number(ws && ws.sessionId) || 0;
    if (!sessionId || !sessionClients.has(sessionId)) {
      return;
    }
    const clients = sessionClients.get(sessionId);
    clients.delete(ws);
    if (!clients.size) {
      sessionClients.delete(sessionId);
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const parsed = parseUpgradeRequest(req);
    if (!parsed) {
      return;
    }

    if (parsed.error) {
      socket.destroy();
      return;
    }

    req.realtimeAuth = parsed;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const auth = req.realtimeAuth || {};
    ws.userId = auth.userId;
    ws.sessionId = auth.sessionId;

    const clients = sessionClients.get(ws.sessionId) || new Set();
    clients.add(ws);
    sessionClients.set(ws.sessionId, clients);

    safeSend(ws, 'connected', { sessionId: ws.sessionId });
    const state = gameService.getGameState(ws.sessionId, ws.userId);
    if (state) {
      safeSend(ws, 'game_state', state);
    }

    ws.on('close', () => {
      removeClient(ws);
    });

    ws.on('error', () => {
      removeClient(ws);
    });
  });

  return {
    emitToSession(sessionId, event, data) {
      const clients = sessionClients.get(Number(sessionId));
      if (!clients || !clients.size) {
        return;
      }
      clients.forEach((ws) => {
        safeSend(ws, event, data);
      });
    },
    close() {
      wss.clients.forEach((ws) => {
        try {
          ws.close();
        } catch (_err) {}
      });
      sessionClients.clear();
      wss.close();
    },
  };
}

module.exports = {
  createArenaRealtimeHub,
};
