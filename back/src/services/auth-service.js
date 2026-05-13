const jwt = require('jsonwebtoken');
const https = require('https');
const config = require('../config');
const db = require('../models/db');
const configService = require('./admin-config-service');

/**
 * Call WeChat jscode2session API to exchange login code for openid/session_key.
 * Uses Node.js built-in https module (no axios dependency).
 *
 * @param {string} code - wx.login() code from mini-program client
 * @returns {Promise<{ openid: string, session_key: string }>}
 */
function wechatCode2Session(code, wxConfig) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      appid: wxConfig.appId,
      secret: wxConfig.secret,
      js_code: code,
      grant_type: 'authorization_code',
    });

    const url = `https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`;

    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
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
      })
      .on('error', reject);
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
 * Generate a JWT token for a given user.
 *
 * @param {Object} user - User row from database
 * @returns {string} signed JWT
 */
function generateToken(user, expiresIn = config.jwt.expiresIn) {
  return jwt.sign(
    { userId: user.id, openid: user.openid },
    config.jwt.secret,
    { expiresIn }
  );
}

/**
 * Full login flow: exchange WeChat code → find/create user → issue JWT.
 *
 * @param {string} code - wx.login() code from mini-program client
 * @returns {Promise<{ token: string, user: Object }>}
 * @throws {Error} if WeChat API fails or code is invalid
 */
async function login(code) {
  const wxConfig = await configService.getWechatLoginSettings();
  if (!wxConfig.enabled) {
    throw new Error('WeChat login disabled');
  }
  if (!wxConfig.appId || !wxConfig.secret) {
    throw new Error('WeChat login config missing');
  }

  // 1. Exchange code for openid / session_key
  const wxSession = await wechatCode2Session(code, wxConfig);

  // 2. Find or create user
  const startCoinsValue = await configService.getConfig('game.initial_coins');
  const startCoins = Number.isFinite(Number(startCoinsValue)) ? Number(startCoinsValue) : 100;
  const user = await findOrCreateUser(wxSession.openid, startCoins);

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
