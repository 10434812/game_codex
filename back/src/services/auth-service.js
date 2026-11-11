const jwt = require('jsonwebtoken');
const https = require('https');
const config = require('../config');
const db = require('../models/db');
const configService = require('./admin-config-service');
const {assertTrialAccess} = require('./trial-access');

/**
 * Call WeChat jscode2session API to exchange login code for openid/session_key.
 * Uses Node.js built-in https module (no axios dependency).
 *
 * @param {string} code - wx.login() code from mini-program client
 * @returns {Promise<{ openid: string, session_key: string }>}
 */
const WECHAT_REQUEST_TIMEOUT_MS = 8000;
const WECHAT_MAX_RESPONSE_BYTES = 64 * 1024;

function wechatCode2Session(code, wxConfig, {httpsGet = https.get, timeoutMs = WECHAT_REQUEST_TIMEOUT_MS} = {}) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      appid: wxConfig.appId,
      secret: wxConfig.secret,
      js_code: code,
      grant_type: 'authorization_code',
    });

    const url = `https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`;

    const req = httpsGet(url, {timeout: timeoutMs}, (res) => {
      let data = '';
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > WECHAT_MAX_RESPONSE_BYTES) {
          req.destroy(Object.assign(new Error('WeChat API response too large'), {statusCode: 502}));
          return;
        }
        data += chunk;
      });
      res.on('end', () => {
        if (received > WECHAT_MAX_RESPONSE_BYTES) return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.errcode) {
            reject(new Error(`WeChat API error: ${parsed.errmsg} (code: ${parsed.errcode})`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('WeChat API timeout'), {statusCode: 502}));
    });
    req.on('error', reject);
  });
}

/**
 * Find existing user by openid, or create a new one with defaults.
 *
 * @param {string} openid - WeChat openid
 * @returns {Promise<Object>} user row from database
 */
async function findOrCreateUser(openid, startCoins = 100) {
  // Try to find existing user
  let user = await db.queryOne('SELECT * FROM users WHERE openid = ?', [openid]);

  if (user) {
    return user;
  }

  // Create new user with defaults
  const defaultNickName = '锦鲤玩家';
  const defaultAvatarUrl = 'https://xcx.ukb88.com/assets/bg/avatars/avatar_01.png';
  const [result] = await db.execute(
    `INSERT INTO users (openid, nick_name, avatar_url, level, total_exp, total_income, coins, game_count, win_count, is_banned)
     VALUES (?, ?, ?, 1, 0, 0, ?, 0, 0, 0)`,
    [openid, defaultNickName, defaultAvatarUrl, startCoins]
  );

  // Fetch the newly created user to return the full row
  user = await db.queryOne('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return user;
}

/**
 * 将 token 有效期规范为 jsonwebtoken 可接受的取值。
 * 后台 wechat.login_token_ttl 存的是「秒」的纯数字串；jsonwebtoken 会把字符串交给 `ms` 解析，
 * 纯数字会被当成毫秒（604800 → 604 秒）。因此纯数字一律按秒转为 number，其余（如 '7d'）原样保留。
 */
function normalizeExpiresIn(value) {
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : text;
}

/**
 * Generate a JWT token for a given user.
 *
 * @param {Object} user - User row from database
 * @returns {string} signed JWT
 */
function generateToken(user, expiresIn = config.jwt.expiresIn) {
  return jwt.sign(
    { userId: user.id, openid: user.openid },
    config.jwt.secret,
    { expiresIn: normalizeExpiresIn(expiresIn) }
  );
}

/**
 * Full login flow: exchange WeChat code → find/create user → issue JWT.
 *
 * @param {string} code - wx.login() code from mini-program client
 * @returns {Promise<{ token: string, user: Object }>}
 * @throws {Error} if WeChat API fails or code is invalid
 */
async function login(code, {previousToken} = {}) {
  let previousUser = null;
  if (previousToken) {
    try {
      previousUser = jwt.verify(previousToken, config.jwt.secret, {ignoreExpiration: true});
      if (!Number.isSafeInteger(Number(previousUser.userId)) || Number(previousUser.userId) <= 0 || !previousUser.openid) {
        throw new Error('invalid user');
      }
    } catch (_error) {
      throw Object.assign(new Error('登录凭证无效，请重新登录'), {statusCode: 401});
    }
  }
  const wxConfig = await configService.getWechatLoginSettings();
  if (!wxConfig.enabled) {
    throw new Error('WeChat login disabled');
  }
  if (!wxConfig.appId || !wxConfig.secret) {
    throw new Error('WeChat login config missing');
  }

  // 1. Exchange code for openid / session_key
  const wxSession = await wechatCode2Session(code, wxConfig);

  // Refresh must never create a new account or switch to a different user.
  let user;
  if (previousUser) {
    if (wxSession.openid !== previousUser.openid) {
      throw Object.assign(new Error('微信账号已变更，请重新登录'), {statusCode: 401});
    }
    user = await db.queryOne('SELECT * FROM users WHERE id = ? AND openid = ?', [previousUser.userId, wxSession.openid]);
    if (!user || user.deleted_at) throw Object.assign(new Error('账号已注销或不存在，请重新登录'), {statusCode: 401});
    if (user.is_banned) throw Object.assign(new Error('账号已被封禁，请联系客服'), {statusCode: 403});
  } else if (config.deployment.channel === 'trial') {
    user = await db.queryOne('SELECT * FROM users WHERE openid = ?', [wxSession.openid]);
    if (!user) throw Object.assign(new Error('当前为受邀体验，请联系管理员添加体验账号'), {statusCode: 403});
    if (user.deleted_at) throw Object.assign(new Error('账号已注销，请重新登录'), {statusCode: 401});
  } else {
    const startCoinsValue = await configService.getConfig('game.initial_coins');
    const startCoins = Number.isFinite(Number(startCoinsValue)) ? Number(startCoinsValue) : 100;
    user = await findOrCreateUser(wxSession.openid, startCoins);
  }

  assertTrialAccess(user.id);

  // 3. Generate JWT
  const token = generateToken(user, wxConfig.tokenTtl || config.jwt.expiresIn);

  // 4. Return token + public user profile
  return {
    token,
    user: {
      id: user.id,
      nickName: user.nick_name,
      avatarUrl: user.avatar_url,
      coins: user.coins,
      level: user.level,
    },
  };
}

module.exports = {
  wechatCode2Session,
  findOrCreateUser,
  generateToken,
  login,
};
