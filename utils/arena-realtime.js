const api = require('./api-client');
const privacy = require('./privacy-consent');

let socketTask = null;
let activeSessionId = '';
let activeHandlers = {};

function buildRealtimeBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const withoutApiSuffix = normalized.replace(/\/api$/i, '');
  if (withoutApiSuffix.startsWith('https://')) {
    return `wss://${withoutApiSuffix.slice('https://'.length)}`;
  }
  if (withoutApiSuffix.startsWith('http://')) {
    return `ws://${withoutApiSuffix.slice('http://'.length)}`;
  }
  return withoutApiSuffix;
}

function buildArenaRealtimeUrl(baseUrl, sessionId, token) {
  const realtimeBase = buildRealtimeBaseUrl(baseUrl);
  if (!realtimeBase || !sessionId) {
    return '';
  }
  // The token is deliberately NOT placed in the URL query: it travels in a
  // Sec-WebSocket-Protocol subprotocol (see buildArenaRealtimeProtocols) so
  // it never leaks into server logs, proxies or referrers.
  return `${realtimeBase}/ws/arena?sessionId=${encodeURIComponent(sessionId)}`;
}

/**
 * Subprotocol carrying the arena auth token. The backend reads the token
 * from `Sec-WebSocket-Protocol` (format `arena.<jwt>`), falling back to the
 * legacy `?token=` query for old clients.
 */
function buildArenaRealtimeProtocols(baseUrl, sessionId, token) {
  return token ? [`arena.${token}`] : [];
}

function disconnect() {
  if (socketTask) {
    try {
      socketTask.close({ code: 1000, reason: 'manual_disconnect' });
    } catch (_err) {}
  }
  socketTask = null;
  activeSessionId = '';
  activeHandlers = {};
}

function connect(sessionId, handlers = {}) {
  privacy.assertAllowed();
  const token = api.getToken();
  const url = buildArenaRealtimeUrl(api.getBaseUrl(), sessionId, token);
  if (!url || typeof wx === 'undefined' || typeof wx.connectSocket !== 'function') {
    return false;
  }

  disconnect();

  activeSessionId = String(sessionId);
  activeHandlers = handlers || {};
  socketTask = wx.connectSocket({
    url,
    protocols: buildArenaRealtimeProtocols(api.getBaseUrl(), sessionId, token),
  });

  socketTask.onOpen(() => {
    if (typeof activeHandlers.onOpen === 'function') {
      activeHandlers.onOpen();
    }
  });

  socketTask.onMessage((message) => {
    let payload = null;
    try {
      payload = JSON.parse(message.data);
    } catch (_err) {
      return;
    }
    if (!payload || !payload.event) {
      return;
    }

    const eventName = String(payload.event);
    const eventHandlers = {
      connected: activeHandlers.onConnected,
      game_state: activeHandlers.onGameState,
      game_tick: activeHandlers.onGameTick,
      time_update: activeHandlers.onTimeUpdate,
      game_finished: activeHandlers.onGameFinished,
      emote_broadcast: activeHandlers.onEmoteBroadcast,
    };
    const handler = eventHandlers[eventName];
    if (typeof handler === 'function') {
      handler(payload.data);
    }
  });

  socketTask.onClose((event) => {
    socketTask = null;
    if (typeof activeHandlers.onClose === 'function') {
      activeHandlers.onClose(event);
    }
  });

  socketTask.onError((event) => {
    if (typeof activeHandlers.onError === 'function') {
      activeHandlers.onError(event);
    }
  });

  return true;
}

module.exports = {
  buildRealtimeBaseUrl,
  buildArenaRealtimeUrl,
  buildArenaRealtimeProtocols,
  connect,
  disconnect,
};
