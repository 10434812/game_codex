const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const {actionBudget} = require('../utils/action-budget');
const config = require('../config');
const db = require('../models/db');
const gameService = require('../services/game-service');
const gameActions = require('../services/game-actions-service');
const { assertActiveUser, watchAccount } = require('./account-guard');

// Auth token travels in a Sec-WebSocket-Protocol subprotocol named
// `arena.<jwt>` (JWT chars are valid RFC 6455 token chars). The URL query
// `?token=` is kept only as a compatibility fallback for legacy clients.
const AUTH_SUBPROTOCOL_PREFIX = 'arena.';
const ARENA_PATH = '/ws/arena';
const SOCKET_IO_PATH_PREFIX = '/socket.io';

// 客户端只发送单条 run_input（几十字节）；上限同时作为 ws 层 maxPayload，
// 在帧被完整缓冲前就拒绝超大消息，避免未鉴权连接占用内存。
const MAX_CLIENT_MESSAGE_BYTES = 512;
const WS_MAX_PAYLOAD_BYTES = 1024;
const MAX_CONNECTIONS_PER_USER = 4;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// 关闭码：4001 表示凭证/成员资格失效（客户端应停止重连）；1011 表示服务端内部故障（客户端可退避重连）。
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_TOO_MANY_CONNECTIONS = 1008;

function readTokenFromSubprotocol(req) {
  const header = req.headers['sec-websocket-protocol'];
  if (!header) {
    return '';
  }
  const protocols = String(header)
    .split(',')
    .map((protocol) => protocol.trim())
    .filter(Boolean);
  const authProtocol = protocols.find((protocol) => protocol.startsWith(AUTH_SUBPROTOCOL_PREFIX));
  return authProtocol ? authProtocol.slice(AUTH_SUBPROTOCOL_PREFIX.length) : '';
}

function parseUpgradeRequest(req) {
  let requestUrl;
  try {
    requestUrl = new URL(req.url, 'http://localhost');
  } catch (_err) {
    return null;
  }
  if (requestUrl.pathname !== ARENA_PATH) {
    return null;
  }

  // Primary source: Sec-WebSocket-Protocol subprotocol.
  let token = readTokenFromSubprotocol(req);
  if (!token) {
    // Compatibility fallback: legacy clients still send ?token= in the URL.
    token = requestUrl.searchParams.get('token') || '';
    if (token) {
      console.warn(
        '[ArenaRealtime] token received via URL query instead of subprotocol; upgrade the client to send Sec-WebSocket-Protocol'
      );
    }
  }

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

function safeSend(ws, event, data) {
  if (!ws || ws.readyState !== ws.OPEN) {
    return;
  }
  try {
    ws.send(JSON.stringify({ event, data }));
  } catch (_err) {}
}

function safeClose(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch (_err) {}
}

function rejectUpgrade(socket, status, statusText) {
  try {
    socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch (_err) {}
  socket.destroy();
}

function createArenaRealtimeHub(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
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

  function countUserConnections(userId) {
    let count = 0;
    wss.clients.forEach((client) => {
      if (client.userId === userId && client.readyState === client.OPEN) count += 1;
    });
    return count;
  }

  // 应用层心跳：客户端失联（切网、进程被杀）时及时回收连接与账号巡检定时器。
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (_err) {}
    });
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();

  server.on('upgrade', (req, socket, head) => {
    const parsed = parseUpgradeRequest(req);
    if (!parsed) {
      // 其它路径交给 socket.io 等已注册的处理器；无人认领的升级请求直接拒绝，避免连接无限期挂起。
      const pathname = (() => { try { return new URL(req.url, 'http://localhost').pathname; } catch (_err) { return ''; } })();
      if (!pathname.startsWith(SOCKET_IO_PATH_PREFIX)) {
        rejectUpgrade(socket, 404, 'Not Found');
      }
      return;
    }

    // Complete the upgrade (even for auth failures) so the client receives a
    // proper WebSocket close frame with the reason code instead of a raw destroy.
    req.realtimeAuth = parsed;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  async function admitConnection(ws, auth) {
    // The JWT user must be a member (game_players row) of this session.
    let member = false;
    try {
      await assertActiveUser(auth.userId);
      member = await isSessionMember(auth.sessionId, auth.userId);
    } catch (err) {
      // 账号被禁用/注销属于凭证失效；其它异常（数据库故障）只是暂时无法校验，不应被报告为权限问题。
      if (err && (err.statusCode === 401 || err.statusCode === 403)) {
        safeClose(ws, CLOSE_UNAUTHORIZED, 'not_arena_member');
        return false;
      }
      console.error(
        `[ArenaRealtime] member check failed for session ${auth.sessionId}, user ${auth.userId}:`,
        err
      );
      safeClose(ws, CLOSE_INTERNAL_ERROR, 'server_error');
      return false;
    }
    if (!member) {
      safeClose(ws, CLOSE_UNAUTHORIZED, 'not_arena_member');
      return false;
    }
    return true;
  }

  wss.on('connection', (ws, req) => {
    const auth = req.realtimeAuth || {};
    if (!auth.userId || !auth.sessionId) {
      safeClose(ws, CLOSE_UNAUTHORIZED, auth.error || 'unauthorized');
      return;
    }

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // 鉴权完成前就注册清理逻辑，保证任何异常路径下连接都能被回收。
    let stopWatching = () => {};
    ws.on('close', () => {
      stopWatching();
      removeClient(ws);
    });
    ws.on('error', () => {
      stopWatching();
      removeClient(ws);
    });

    handleAuthorizedConnection(ws, auth).catch((err) => {
      console.error('[ArenaRealtime] connection setup failed:', err);
      stopWatching();
      removeClient(ws);
      safeClose(ws, CLOSE_INTERNAL_ERROR, 'server_error');
    });

    async function handleAuthorizedConnection(client, credentials) {
      if (!(await admitConnection(client, credentials))) return;
      if (client.readyState !== client.OPEN) return;

      if (countUserConnections(credentials.userId) > MAX_CONNECTIONS_PER_USER) {
        safeClose(client, CLOSE_TOO_MANY_CONNECTIONS, 'too_many_connections');
        return;
      }

      client.userId = credentials.userId;
      client.sessionId = credentials.sessionId;
      stopWatching = watchAccount(client.userId, () => client.close(CLOSE_UNAUTHORIZED, 'account_disabled'));

      let state = null;
      try {
        state = gameService.getGameState(client.sessionId, client.userId);
      } catch (err) {
        // 成员记录存在但内存对局缺少该玩家（竞态/孤儿状态）：只关闭当前连接，不能拖垮进程。
        console.error(`[ArenaRealtime] session ${client.sessionId} state unavailable for user ${client.userId}:`, err && err.message);
        stopWatching();
        safeClose(client, CLOSE_INTERNAL_ERROR, 'session_unavailable');
        return;
      }

      const clients = sessionClients.get(client.sessionId) || new Set();
      clients.add(client);
      sessionClients.set(client.sessionId, clients);

      safeSend(client, 'connected', { sessionId: client.sessionId });
      if (state) {
        safeSend(client, 'game_state', state);
      }

      const allowInput = actionBudget(20);
      client.on('message', (raw) => {
        if (!allowInput()) return;
        try {
          if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return;
          const message = JSON.parse(String(raw));
          if (message.event !== 'run_input') return;
          gameActions.move(gameService.getActiveGame(client.sessionId), client.userId, message.data || {});
        } catch (err) {
          safeSend(client, 'arena_error', {message: err.statusCode ? err.message : '移动方向同步失败'});
        }
      });
    }
  });

  return {
    emitToSession(sessionId, event, data) {
      const clients = sessionClients.get(Number(sessionId));
      if (!clients || !clients.size) {
        return;
      }
      clients.forEach((ws) => {
        // 单个客户端的状态构造失败只影响它自己，不能中断同房间其它玩家的广播。
        try {
          if (event === 'game_frame') safeSend(ws, 'game_state', gameService.getGameState(sessionId, ws.userId));
          else safeSend(ws, event, data);
        } catch (err) {
          console.error(`[ArenaRealtime] broadcast to user ${ws.userId} failed:`, err && err.message);
        }
      });
    },
    close() {
      clearInterval(heartbeat);
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
