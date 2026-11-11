const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-trial-access-test-signing-secret';
const config = require('../src/config');
const db = require('../src/models/db');
const jwt = require('jsonwebtoken');
const auth = require('../src/middleware/auth');

test('生产受邀体验需要明确名单，配置只接受正整数账号编号', () => {
  const configPath = path.resolve(__dirname, '../src/config');
  const environment = {...process.env, NODE_ENV: 'production', JWT_SECRET: 'u'.repeat(40), ADMIN_JWT_SECRET: 'a'.repeat(40),
    ADMIN_PASSWORD: 'isolated-test-admin-password', DEPLOYMENT_CHANNEL: 'trial'};
  for (const ids of ['', '0', '-1', '1.5', 'abc', '1,,2']) {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
      encoding: 'utf8', env: {...environment, TRIAL_USER_IDS: ids},
    });
    assert.notEqual(result.status, 0, `invalid trial list: ${ids}`);
    assert.match(result.stderr, /TRIAL_USER_IDS/);
  }
  const valid = spawnSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(configPath)}).deployment))`], {
    encoding: 'utf8', env: {...environment, TRIAL_USER_IDS: ' 7,8,7 '},
  });
  assert.equal(valid.status, 0);
  assert.deepEqual(JSON.parse(valid.stdout), {channel: 'trial', trialUserIds: [7, 8]});
  const unknown = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
    encoding: 'utf8', env: {...environment, DEPLOYMENT_CHANNEL: 'unknown'},
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /DEPLOYMENT_CHANNEL/);
});

test('受邀体验的 HTTP 与共享连接鉴权拒绝未列入名单的有效账号', async (t) => {
  const original = config.deployment;
  config.deployment = {channel: 'trial', trialUserIds: [7]};
  t.after(() => {config.deployment = original; auth.__private.userStateCache.clear();});
  t.mock.method(db, 'queryOne', async () => ({is_banned: 0, deleted_at: null}));
  auth.__private.userStateCache.clear();
  await auth.assertActiveUser(7);
  await assert.rejects(auth.assertActiveUser(8), (error) => error.statusCode === 403 && /受邀体验/.test(error.message));
  let status;
  let proceeded = false;
  const req = {headers: {authorization: 'Bearer ' + jwt.sign({userId: 8, openid: 'test-user'}, config.jwt.secret)}};
  await auth(req, {status(value) {status = value; return this;}, json() {}}, () => {proceeded = true;});
  assert.equal(status, 403);
  assert.equal(proceeded, false);
});
