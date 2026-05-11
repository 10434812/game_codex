const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'game_codex_pass',
    database: process.env.DB_NAME || 'game_codex',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'change-this-to-random-secret-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  wx: {
    appId: process.env.WX_APPID || 'wx72a4b552a87b44cf',
    secret: process.env.WX_SECRET || '',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
};
