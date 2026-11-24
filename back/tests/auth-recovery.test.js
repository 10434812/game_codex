const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter, once} = require('node:events');
const https = require('node:https');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-auth-recovery-test-secret-123456789';
const dbPath = require.resolve('../src/models/db');
const configServicePath = require.resolve('../src/services/admin-config-service');
const originalDb = require.cache[dbPath];
const originalConfigService = require.cache[configServicePath];
const originalHttpsGet = https.get;
const config = require('../src/config');
let user;
let wechatOpenId;
let insertions;
let wechatCalls;

const db = {
  async queryOne(sql, params) {
    if (/SELECT is_banned FROM users/.test(sql)) return user && Number(params[0]) === user.id ? user : null;
    if (/SELECT \* FROM users WHERE id = \? AND openid = \?/.test(sql)) {
      return user && Number(params[0]) === user.id && params[1] === user.openid ? user : null;
    }
    if (/SELECT \* FROM users WHERE openid = \?/.test(sql)) return user && params[0] === user.openid ? user : null;
    return null;
  },
  async execute() { insertions += 1; throw new Error('refresh must not create an account'); },
};
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: db};
require.cache[configServicePath] = {id: configServicePath, filename: configServicePath, loaded: true, exports: {
  getWechatLoginSettings: async () => ({enabled: true, appId: 'test-app', secret: 'test-secret', tokenTtl: '7d'}),
  getConfig: async () => '100',
}};
https.get = (_url, optionsOrCallback, maybeCallback) => {
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
  wechatCalls += 1;
  const request = new EventEmitter();
  queueMicrotask(() => {
    const response = new EventEmitter();
    callback(response);
    response.emit('data', JSON.stringify({openid: wechatOpenId, session_key: 'test-only'}));
    response.emit('end');
  });
  return request;
};

const app = express();
app.use(express.json());
app.use('/api/auth', require('../src/routes/auth'));
let server;
let base;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/auth/refresh`;
});
test.beforeEach(() => {
  user = {id: 7, openid: 'wechat-user-7', nick_name: '旅行者', avatar_url: '', coins: 77, level: 1, is_banned: 0, deleted_at: null};
  wechatOpenId = user.openid;
  insertions = 0;
  wechatCalls = 0;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  https.get = originalHttpsGet;
  if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
  if (originalConfigService) require.cache[configServicePath] = originalConfigService; else delete require.cache[configServicePath];
});

function expiredToken(secret = process.env.JWT_SECRET) {
  return jwt.sign({userId: 7, openid: 'wechat-user-7'}, secret, {expiresIn: -60});
}

async function refresh(token) {
  const response = await fetch(base, {
    method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({code: 'test-code'}),
  });
  return {status: response.status, body: await response.json()};
}

test('过期凭证只能续期同一微信账号', async () => {
  const result = await refresh(expiredToken());
  assert.equal(result.status, 200);
  assert.equal(result.body.data.user.id, 7);
  assert.equal(jwt.verify(result.body.data.token, process.env.JWT_SECRET).userId, 7);
  assert.equal(insertions, 0);
});

test('未迁移注销字段的旧数据库仍能续期已有账号', async () => {
  delete user.deleted_at;
  const result = await refresh(expiredToken());
  assert.equal(result.status, 200);
  assert.equal(result.body.data.user.id, 7);
  assert.equal(insertions, 0);
});

test('普通登录继续返回已有账号', async () => {
  const response = await fetch(base.replace('/refresh', '/login'), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: 'test-code'}),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.user.id, 7);
  assert.equal(insertions, 0);
});

test('受邀体验不向名单外已有账号发放续期凭证', async (t) => {
  const original = config.deployment;
  config.deployment = {channel: 'trial', trialUserIds: [8]};
  t.after(() => {config.deployment = original;});
  const result = await refresh(expiredToken());
  assert.equal(result.status, 403);
  assert.equal(insertions, 0);
});

test('受邀体验为名单外新微信号建档但不发凭证，并返回体验编号', async (t) => {
  const original = config.deployment;
  const originalExecute = db.execute;
  const originalQueryOne = db.queryOne;
  config.deployment = {channel: 'trial', trialUserIds: [7]};
  let created = null;
  db.execute = async (sql, params) => {
    insertions += 1;
    assert.match(sql, /INSERT INTO users/);
    created = {id: 42, openid: params[0], is_banned: 0};
    return [{insertId: 42}];
  };
  db.queryOne = async (sql, params) => {
    if (/SELECT \* FROM users WHERE openid = \?/.test(sql)) return created && params[0] === created.openid ? created : null;
    if (/SELECT \* FROM users WHERE id = \?/.test(sql)) return created && Number(params[0]) === created.id ? created : null;
    return originalQueryOne(sql, params);
  };
  t.after(() => {config.deployment = original; db.execute = originalExecute; db.queryOne = originalQueryOne;});
  user = null;
  const login = () => fetch(base.replace('/refresh', '/login'), {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: 'test-code'}),
  });
  const response = await login();
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.message, /体验编号是 42/);
  assert.deepEqual(body.data, {code: 'TRIAL_ACCESS_REQUIRED', trialUserId: 42});
  assert.equal(insertions, 1);
  // 再次登录复用同一账号，不重复建档。
  const again = await login();
  assert.equal(again.status, 403);
  assert.equal((await again.json()).data.trialUserId, 42);
  assert.equal(insertions, 1);
  // 加入名单后即可登录。
  config.deployment = {channel: 'trial', trialUserIds: [7, 42]};
  const allowed = await login();
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data.user.id, 42);
});

test('微信账号变化时拒绝续期，不创建账号', async () => {
  wechatOpenId = 'another-wechat-account';
  const result = await refresh(expiredToken());
  assert.equal(result.status, 401);
  assert.equal(insertions, 0);
});

test('已注销账号拒绝续期，不创建账号', async () => {
  user.deleted_at = new Date();
  const result = await refresh(expiredToken());
  assert.equal(result.status, 401);
  assert.equal(insertions, 0);
});

test('已封禁账号拒绝续期', async () => {
  user.is_banned = 1;
  const result = await refresh(expiredToken());
  assert.equal(result.status, 403);
  assert.equal(insertions, 0);
});

test('缺少旧凭证时拒绝续期，不请求微信', async () => {
  const response = await fetch(base, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: 'test-code'}),
  });
  assert.equal(response.status, 401);
  assert.equal(wechatCalls, 0);
});

test('无效签名在请求微信或数据库之前被拒绝', async () => {
  const result = await refresh(expiredToken('incorrect-signing-secret'));
  assert.equal(result.status, 401);
  assert.equal(wechatCalls, 0);
  assert.equal(insertions, 0);
});

test('小游戏登录选择独立配置并在JWT记录客户端，跨端续期被拒绝', async () => {
  const settings = require(configServicePath);
  const original = settings.getWechatLoginSettings;
  const selected = [];
  settings.getWechatLoginSettings = async (client) => {
    selected.push(client);
    return {enabled: true, appId: `${client}-app`, secret: 'test-only', tokenTtl: '7d'};
  };
  try {
    const response = await fetch(base.replace('/refresh', '/login'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code: 'test-code', client: 'minigame'}),
    });
    assert.equal(response.status, 200);
    const token = (await response.json()).data.token;
    assert.equal(jwt.verify(token, process.env.JWT_SECRET).client, 'minigame');
    assert.deepEqual(selected, ['minigame']);
    const cross = await refresh(token);
    assert.equal(cross.status, 401);
    assert.equal(wechatCalls, 1);
    const same = await fetch(base, {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify({code: 'test-code', client: 'minigame'}),
    });
    assert.equal(same.status, 200);
    assert.deepEqual(selected, ['minigame', 'minigame']);
  } finally {settings.getWechatLoginSettings = original;}
});

test('非法客户端在微信换码前返回400，小游戏配置缺失不签发账号', async () => {
  const response = await fetch(base.replace('/refresh', '/login'), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({code: 'test-code', client: 'unknown'}),
  });
  assert.equal(response.status, 400); assert.equal(wechatCalls, 0);
  const settings = require(configServicePath), original = settings.getWechatLoginSettings;
  settings.getWechatLoginSettings = async () => ({enabled: true, appId: 'mini', secret: ''});
  try {
    const missing = await fetch(base.replace('/refresh', '/login'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({code: 'test-code', client: 'minigame'}),
    });
    assert.equal(missing.status, 500); assert.equal(wechatCalls, 0);
  } finally {settings.getWechatLoginSettings = original;}
});
