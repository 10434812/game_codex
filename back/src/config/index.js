const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';

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

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInteger(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'game_codex_pass',
    database: process.env.DB_NAME || 'game_codex',
  },

  jwt: {
    secret: requireProductionEnv('JWT_SECRET', 'dev-jwt-secret'),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  wx: {
    appId: process.env.WX_APPID || 'wx72a4b552a87b44cf',
    secret: process.env.WX_SECRET || '',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: requireProductionEnv('ADMIN_PASSWORD', ''),
  },

  cors: {
    origin: parseCorsOrigin(process.env.CORS_ORIGIN),
  },
};
