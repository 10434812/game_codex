const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const jwt = require('jsonwebtoken');

const backRoot = path.resolve(__dirname, '..');
const repoLegal = path.resolve(backRoot, '../utils/legal-config.js');
const backLegal = path.resolve(backRoot, 'src/config/legal-config.js');

function runNode(code, env) {
  return spawnSync(process.execPath, ['-e', code], {
    cwd: backRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('后端法律配置副本与小程序端源文件保持一致', { skip: !fs.existsSync(repoLegal) }, () => {
  assert.equal(fs.readFileSync(backLegal, 'utf8'), fs.readFileSync(repoLegal, 'utf8'));
});

test('后端法律配置副本可独立判定就绪状态', () => {
  const { isReady } = require('../src/config/legal-config');
  assert.equal(typeof isReady(), 'boolean');
});

test('用户 token 有效期：后台存储的秒数字串按秒生效，而不是毫秒', () => {
  const { generateToken } = require('../src/services/auth-service');
  const token = generateToken({ id: 5, openid: 'o-test' }, '604800');
  const decoded = jwt.decode(token);
  assert.equal(decoded.exp - decoded.iat, 604800);
});

test('用户 token 有效期：带单位的字符串（如 7d）保持原语义', () => {
  const { generateToken } = require('../src/services/auth-service');
  const token = generateToken({ id: 5, openid: 'o-test' }, '7d');
  const decoded = jwt.decode(token);
  assert.equal(decoded.exp - decoded.iat, 7 * 24 * 3600);
});

test('微信 jscode2session：上游无响应超时会以 502 失败，而不是永久挂起', async () => {
  const { wechatCode2Session } = require('../src/services/auth-service');
  const fakeHttpsGet = (_url, _opts, _cb) => {
    const req = new EventEmitter();
    req.destroy = (err) => { process.nextTick(() => req.emit('error', err)); };
    process.nextTick(() => req.emit('timeout'));
    return req;
  };
  await assert.rejects(
    wechatCode2Session('code', { appId: 'wxtest', secret: 'x' }, { httpsGet: fakeHttpsGet, timeoutMs: 10 }),
    (err) => err.statusCode === 502 && /timeout/.test(err.message)
  );
});

test('微信 jscode2session：超过体积上限的响应被截断拒绝', async () => {
  const { wechatCode2Session } = require('../src/services/auth-service');
  const fakeHttpsGet = (_url, _opts, cb) => {
    const req = new EventEmitter();
    req.destroy = (err) => { process.nextTick(() => req.emit('error', err)); };
    const res = new EventEmitter();
    process.nextTick(() => {
      cb(res);
      res.emit('data', Buffer.alloc(100 * 1024, 'a'));
      res.emit('end');
    });
    return req;
  };
  await assert.rejects(
    wechatCode2Session('code', { appId: 'wxtest', secret: 'x' }, { httpsGet: fakeHttpsGet }),
    (err) => err.statusCode === 502
  );
});

test('生产环境缺少 DB_PASSWORD 时拒绝启动，不回落到源码中的默认口令', () => {
  const result = runNode("require('./src/config')", {
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(40),
    [['ADMIN','JWT','SECRET'].join('_')]: 'b'.repeat(40),
    ADMIN_PASSWORD: 'c'.repeat(20),
    DB_PASSWORD: '',
    DEPLOYMENT_CHANNEL: 'trial',
    TRIAL_USER_IDS: '1',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DB_PASSWORD is required in production/);
});

test('管理员账号：非法角色在访问数据库前即被拒绝', async () => {
  const { createAdmin, updateAdmin } = require('../src/services/admin-admin-service');
  await assert.rejects(createAdmin('ops', 'long-enough-pw', 'Super'), (err) => err.statusCode === 400);
  await assert.rejects(updateAdmin(1, { role: 'root' }), (err) => err.statusCode === 400);
});

test('管理员账号：过短密码在访问数据库前即被拒绝', async () => {
  const { createAdmin, resetPassword } = require('../src/services/admin-admin-service');
  await assert.rejects(createAdmin('ops', '123', 'normal'), (err) => err.statusCode === 400);
  await assert.rejects(resetPassword(1, 'short'), (err) => err.statusCode === 400);
});
