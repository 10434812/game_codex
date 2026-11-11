const jwt = require('jsonwebtoken');
const {WebSocket, WebSocketServer} = require('ws');
const config = require('../config');
const db = require('../models/db');
const gameService = require('../services/game-service');
const { assertActiveUser, watchAccount } = require('./account-guard');

// Auth token travels in a Sec-WebSocket-Protocol subprotocol named
// `arena.<jwt>`; the URL query `?token=` is kept only as a compatibility
// fallback for legacy clients.
const AUTH_SUBPROTOCOL_PREFIX = 'arena.';

const clientsBySession = new Map();

function readTokenFromRequest(req) {
  const header = req.headers && req.headers['sec-websocket-protocol'];
  if (header) {
    const protocols = String(header)
      .split(',')
      .map((protocol) => protocol.trim())
      .filter(Boolean);
    const authProtocol = protocols.find((protocol) => protocol.startsWith(AUTH_SUBPROTOCOL_PREFIX));
    if (authProtocol) {
      return authProtocol.slice(AUTH_SUBPROTOCOL_PREFIX.length);
    }
  }

  const requestUrl = new URL(req.url, 'http://localhost');
  const queryToken = requestUrl.searchParams.get('token') || '';
  if (queryToken) {
    console.warn(
      '[NativeArenaWs] token received via URL query instead of subprotocol; upgrade the client to send Sec-WebSocket-Protocol'
    );
  }
  return queryToken;
}

/**
 * Membership check: the JWT user must be a player of this game session.
 */
async function isSessionMember(sessionId, userId) {
  const row = await db.queryOne(
    'SELECT 1 FROM game_players WHERE session_id = ? AND user_id = ?',
    [sessionId, userId]
  );
  return !!row;
}

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

  wss.on('connection', async (ws, req) => {
    try {
      const token = readTokenFromRequest(req);
      const url = new URL(req.url, 'http://localhost');
      const sessionId = url.searchParams.get('sessionId');
      if (!token || !sessionId) {
        ws.close(4001, 'missing token or sessionId');
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(token, config.jwt.secret);
      } catch (_err) {
        ws.close(4001, 'invalid token');
        return;
      }

      // The JWT user must be a member (game_players row) of this session.
      await assertActiveUser(decoded.userId);
      let member = false;
      try {
        member = await isSessionMember(Number(sessionId), decoded.userId);
      } catch (err) {
        console.error(
          `[NativeArenaWs] member check failed for session ${sessionId}, user ${decoded.userId}:`,
          err
        );
      }
      if (!member) {
        ws.close(4001, 'not arena member');
        return;
      }

      ws.userId = decoded.userId;
      ws.sessionId = String(sessionId);
      if (ws.readyState !== WebSocket.OPEN) return;
      const stopWatching = watchAccount(ws.userId, () => ws.close(4001, 'account_disabled'));
      ws.on('close', stopWatching);
      ws.on('error', stopWatching);
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
    } catch (err) {
      console.error('[NativeArenaWs] connection handler error:', err);
      ws.close(4001, 'unauthorized');
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
