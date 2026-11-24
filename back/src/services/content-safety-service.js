const https = require('https');
const crypto = require('crypto');
const configService = require('./admin-config-service');

const TIMEOUT_MS = 8000;

function unavailable() {
  const error = new Error('内容安全服务暂不可用，请稍后重试');
  error.statusCode = 503;
  return error;
}

function rejected(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function requestJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const request = https.request(url, {
      method: body === null ? 'GET' : 'POST',
      headers: body === null ? {} : { 'Content-Type': 'application/json' },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('error', () => reject(unavailable()));
      response.on('data', (chunk) => {
        text += chunk;
        if (text.length > 65536) request.destroy(unavailable());
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(unavailable());
        try { resolve(JSON.parse(text)); } catch (_) { reject(unavailable()); }
      });
    });
    const deadline = setTimeout(() => request.destroy(unavailable()), TIMEOUT_MS);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', () => reject(unavailable()));
    request.end(body);
  });
}

const tokenCaches = new Map();

async function getAccessToken(client = 'miniprogram') {
  const targetClient = client === 'minigame' ? 'minigame' : 'miniprogram';
  const settings = await configService.getWechatLoginSettings(targetClient);
  if (!settings.appId || !settings.secret) throw unavailable();
  const identity = crypto.createHash('sha256').update(`${settings.appId}:${settings.secret}`).digest('hex');
  const cached = tokenCaches.get(targetClient);
  if (cached && cached.identity === identity && cached.expiresAt > Date.now() + 60000) {
    return cached.value;
  }
  const query = new URLSearchParams({ grant_type: 'client_credential', appid: settings.appId, secret: settings.secret });
  const result = await requestJson(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
  if (result.errcode || typeof result.access_token !== 'string' || !result.access_token || !(Number(result.expires_in) > 60)) throw unavailable();
  tokenCaches.set(targetClient, { identity, value: result.access_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 });
  return result.access_token;
}

async function checkText(content, openid, client = 'miniprogram') {
  if (typeof content !== 'string' || !content.trim() || !openid) throw unavailable();
  const token = await getAccessToken(client);
  const result = await requestJson(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(token)}`, {
    content, version: 2, scene: 1, openid,
  });
  if (result.errcode === 87014) throw rejected('昵称未通过内容安全校验');
  if (result.errcode !== 0 || !result.result) throw unavailable();
  if (result.result.suggest !== 'pass') throw rejected('昵称未通过内容安全校验');
}

async function checkImage(mediaUrl, openid, client = 'miniprogram') {
  if (!openid || !mediaUrl.startsWith('https://')) throw unavailable();
  const token = await getAccessToken(client);
  const result = await requestJson(`https://api.weixin.qq.com/wxa/media_check_async?access_token=${encodeURIComponent(token)}`, {
    media_url: mediaUrl, media_type: 2, version: 2, scene: 1, openid,
  });
  if (result.errcode !== 0 || typeof result.trace_id !== 'string' || !result.trace_id) throw unavailable();
  // Acceptance is not approval. Only the authenticated asynchronous event may publish the image.
  return result.trace_id;
}

function callbackSettings() {
  const token = process.env.WX_CONTENT_SAFETY_TOKEN || '';
  const encodedKey = process.env.WX_CONTENT_SAFETY_AES_KEY || '';
  const baseUrl = (process.env.WX_CONTENT_SAFETY_BASE_URL || '').replace(/\/+$/, '');
  if (!token || !/^[A-Za-z0-9+/]{43}$/.test(encodedKey)) throw unavailable();
  let url;
  try { url = new URL(baseUrl); } catch (_) { throw unavailable(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw unavailable();
  return { token, key: Buffer.from(`${encodedKey}=`, 'base64'), baseUrl };
}

function verifyChallenge(query) {
  const { token } = callbackSettings();
  if (typeof query.echostr !== 'string' || typeof query.signature !== 'string'
      || typeof query.timestamp !== 'string' || !/^\d+$/.test(query.timestamp)
      || typeof query.nonce !== 'string' || !query.nonce) throw unavailable();
  const signature = crypto.createHash('sha1').update([token, query.timestamp, query.nonce].sort().join('')).digest('hex');
  const supplied = Buffer.from(query.signature);
  if (supplied.length !== signature.length || !crypto.timingSafeEqual(supplied, Buffer.from(signature))) throw unavailable();
  return query.echostr;
}

async function decodeCallback(query, encrypted) {
  const settings = callbackSettings();
  if (typeof encrypted !== 'string' || typeof query.timestamp !== 'string' || typeof query.nonce !== 'string' || typeof query.msg_signature !== 'string') throw unavailable();
  if (!/^\d+$/.test(query.timestamp) || Math.abs(Date.now() / 1000 - Number(query.timestamp)) > 300) throw unavailable();
  const signature = crypto.createHash('sha1').update([settings.token, query.timestamp, query.nonce, encrypted].sort().join('')).digest('hex');
  const supplied = Buffer.from(query.msg_signature);
  if (supplied.length !== signature.length || !crypto.timingSafeEqual(supplied, Buffer.from(signature))) throw unavailable();
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', settings.key, settings.key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
    const padding = padded[padded.length - 1];
    if (padding < 1 || padding > 32 || !padded.subarray(-padding).every((byte) => byte === padding)) throw unavailable();
    const plain = padded.subarray(0, -padding);
    if (plain.length < 20) throw unavailable();
    const size = plain.readUInt32BE(16);
    if (size > plain.length - 20) throw unavailable();
    const appIds = new Set();
    for (const client of ['miniprogram', 'minigame']) {
      try {
        const wx = await configService.getWechatLoginSettings(client);
        if (wx && wx.appId) appIds.add(wx.appId);
      } catch (_) {}
    }
    const callbackAppId = plain.subarray(20 + size).toString();
    if (!appIds.size || !appIds.has(callbackAppId)) throw unavailable();
    return plain.subarray(20, 20 + size).toString('utf8');
  } catch (_) { throw unavailable(); }
}

module.exports = { checkText, checkImage, callbackSettings, verifyChallenge, decodeCallback };
