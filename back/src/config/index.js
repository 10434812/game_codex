const dotenv = require('dotenv');
const path = require('path');
const { parseTrustProxy } = require('./trust-proxy');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// 只接受白名单取值：生产加固全部依赖精确等于 'production'，拼写错误（如 prod）
// 若静默回落为开发模式，会关闭强密钥校验并启用开发占位密钥。
const KNOWN_NODE_ENVS = ['development', 'production', 'test'];
const nodeEnv = process.env.NODE_ENV || 'development';
if (!KNOWN_NODE_ENVS.includes(nodeEnv)) {
  throw new Error(`NODE_ENV must be one of ${KNOWN_NODE_ENVS.join(', ')} (got "${nodeEnv}")`);
}

function requireProductionEnv(name, fallback = '') {
  const value = process.env[name];
  if (value) {
    return value;
  }
  if (nodeEnv === 'production') {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}

// 已知弱密钥占位值（拆字拼接，避免把占位串本身写进仓库源码）
const WEAK_SECRETS = [
  'dev-jwt-secret',
  'dev-admin-jwt-secret',
  ['change-this', 'to-random-secret-in-production'].join('-'),
  ['your', 'jwt', 'secret', 'here'].join('-'),
  ['secret', 'key', 'change', 'me'].join('-'),
  ['admin', '123'].join(''),
  'password',
  '123456',
];

/**
 * 生产环境强密钥校验：
 * - 拒绝空值 / 已知占位弱值 / 长度不足（默认 32 位）
 * - 生产环境校验失败直接抛错拒绝启动；开发环境降级到 fallback 并告警
 */
function requireStrongSecret(name, fallback = '', options = {}) {
  const minLength = options.minLength || 32;
  const value = process.env[name];

  const isWeak = !value
    || String(value).trim().length < minLength
    || WEAK_SECRETS.some((weak) => String(value).trim().toLowerCase() === weak);

  if (!isWeak) {
    return String(value).trim();
  }
  if (nodeEnv === 'production') {
    throw new Error(
      `${name} is required in production and must be a random string of at least ${minLength} characters (placeholder/weak values are rejected)`
    );
  }
  if (nodeEnv !== 'test') {
    console.warn(`[Config] ${name} 未配置或为弱占位值，开发环境使用内置 fallback`);
  }
  return fallback;
}

const userSigningSecret = requireStrongSecret('JWT_SECRET', 'dev-jwt-secret');
const adminSigningSecret = requireStrongSecret('ADMIN_JWT_SECRET', 'dev-admin-jwt-secret');
if (nodeEnv === 'production' && userSigningSecret === adminSigningSecret) {
  throw new Error('JWT_SECRET and ADMIN_JWT_SECRET must differ in production');
}

const deploymentChannel = process.env.DEPLOYMENT_CHANNEL || 'public';
if (!['public', 'trial'].includes(deploymentChannel)) {
  throw new Error('DEPLOYMENT_CHANNEL must be public or trial');
}
const trialUserIds = [...new Set((process.env.TRIAL_USER_IDS || '').trim()
  ? process.env.TRIAL_USER_IDS.split(',').map((value) => {
    const id = Number(value.trim());
    if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error('TRIAL_USER_IDS must contain positive integer user IDs');
    }
    return id;
  }) : [])];
if (nodeEnv === 'production' && deploymentChannel === 'trial' && !trialUserIds.length) {
  throw new Error('TRIAL_USER_IDS is required for production trial deployment');
}

function parseCorsOrigin(value) {
  if (!value) {
    return nodeEnv === 'production' ? false : '*';
  }

  const origins = String(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return nodeEnv === 'production' ? false : '*';
  }
  return origins.length === 1 ? origins[0] : origins;
}

module.exports = {
  port: parseInteger(process.env.PORT, 3000),
  nodeEnv,
  deployment: {channel: deploymentChannel, trialUserIds},

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInteger(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    // 生产环境必须显式提供数据库口令，不回落到源码中的公开默认值
    password: requireProductionEnv('DB_PASSWORD', 'game_codex_pass'),
    database: process.env.DB_NAME || 'game_codex',
  },

  jwt: {
    // 用户端 token 密钥（auth-service / auth 中间件 / ws 鉴权）
    secret: userSigningSecret,
    // 管理员端 token 密钥，与用户端分离（admin-auth / 后台登录）
    adminSecret: adminSigningSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    maxSessionDays: Math.max(1, parseInteger(process.env.JWT_MAX_SESSION_DAYS, 30)),
  },

  wx: {
    appId: process.env.WX_APPID || 'wxd7f500f3f21f15dd',
    secret: process.env.WX_SECRET || '',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },

  cors: {
    origin: parseCorsOrigin(process.env.CORS_ORIGIN),
  },

  // 反向代理信任策略，默认 false；部署在 nginx 后应设置 TRUST_PROXY=1，
  // 否则 req.ip 恒为代理地址，登录限速与审计日志都会失真。
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};
