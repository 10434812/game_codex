const privacy = require('./privacy-consent');
const api = require('./api-client');
const {PlayFlowTracker} = require('./play-flow');
const DEVICE_KEY = 'jinli.analytics.device.v1';
const SAFE_KEYS = new Set(['sessionId', 'roomId', 'stageId', 'rank', 'score', 'itemId', 'taskId', 'source', 'message', 'stack', 'attemptId', 'sourceSessionId', 'reason', 'waitMs', 'durationMs', 'humanCount', 'botCount', 'preloadCount']);
let queue = [], timer = null, pending = null, lastTs = 0;
function cleanError(value) {
  return String(value || '').replace(/Bearer\s+\S+/gi, '[redacted]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/([?&](?:token|code|openid|session_key|key)=)[^&\s]*/gi, '$1[redacted]').slice(0, 500);
}
function properties(input) {
  const props = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!SAFE_KEYS.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) continue;
    props[key] = key === 'message' || key === 'stack' ? cleanError(value) : typeof value === 'string' ? value.slice(0, 80) : value;
  }
  // Shared limit is bytes; keep combined error fields small enough for UTF-8.
  while (unescape(encodeURIComponent(JSON.stringify(props))).length > 1024) {
    if (props.stack) props.stack = props.stack.slice(0, Math.floor(props.stack.length / 2));
    else if (props.message) props.message = props.message.slice(0, Math.floor(props.message.length / 2));
    else return {};
  }
  return props;
}
function schedule() {
  if (timer || !queue.length) return;
  timer = setTimeout(() => {timer = null; void flush();}, 10000);
  timer?.unref?.();
}
function track(name, props) {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) return;
  lastTs = Math.max(Date.now(), lastTs + 1);
  const token = privacy.isAllowed() ? api.getToken() : '';
  queue.push({name, ts: lastTs, props: properties(props), token});
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  if (queue.length >= 20) void flush();
  else schedule();
}
function deviceId() {
  let id = wx.getStorageSync(DEVICE_KEY);
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    id = `wx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    wx.setStorageSync(DEVICE_KEY, id);
  }
  return id;
}
function flush() {
  if (pending) return pending;
  if (timer) {clearTimeout(timer); timer = null;}
  if (!queue.length || !privacy.isAllowed() || typeof wx === 'undefined' || typeof wx.request !== 'function') {schedule(); return Promise.resolve(false);}
  const token = queue[0].token;
  const batch = [];
  for (const event of queue) {if (batch.length >= 50 || event.token !== token) break; batch.push(event);}
  pending = new Promise((resolve) => {
    try {
      wx.request({url: `${api.getBaseUrl()}/events`, method: 'POST', timeout: 8000,
        header: {'content-type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        data: {client: 'miniprogram', deviceId: deviceId(), events: batch.map(({token: _token, ...event}) => event)},
        success(response) {resolve(response.statusCode >= 200 && response.statusCode < 300 && response.data?.code === 0);},
        fail() {resolve(false);}});
    } catch (_) {resolve(false);}
  }).then((ok) => {
    if (ok) {const sent = new Set(batch); queue = queue.filter((event) => !sent.has(event));}
    return ok;
  }).finally(() => {pending = null; schedule();});
  return pending;
}
function reportError(error) {track('client_error', {message: error?.message || error?.errMsg || error, stack: error?.stack || ''});}
function discard() {clearTimeout(timer); timer = null; queue = []; }
function __resetForTests() {clearTimeout(timer); timer = null; queue = []; pending = null; lastTs = 0;}
const playFlow = new PlayFlowTracker({track, owner: api.getToken, sameOwner: api.isRecoveredToken});
module.exports = {track, flush, reportError, discard, __resetForTests, playFlow};
