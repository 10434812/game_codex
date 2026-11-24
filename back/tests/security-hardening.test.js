const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const jwt = require('jsonwebtoken');

// ─── 通用测试工具 ────────────────────────────────────────────

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (body) { this.body = body; return this; };
  return res;
}

function mockReq(overrides = {}) {
  return {
    ip: '127.0.0.1',
    headers: {},
    body: {},
    method: 'GET',
    params: {},
    query: {},
    ...overrides,
  };
}

/**
 * 在指定 NODE_ENV 下重新加载 config / response / middleware 模块（清 require 缓存），
 * 结束后恢复环境并再次清缓存，避免影响同一文件内的其他测试。
 */
async function withEnv(env, extraEnv = {}, fn) {
  const savedEnv = {};
  for (const key of Object.keys(extraEnv)) {
    savedEnv[key] = process.env[key];
    process.env[key] = extraEnv[key];
  }
  const savedNodeEnv = process.env.NODE_ENV;
  if (env !== undefined) process.env.NODE_ENV = env;

  const clearCache = () => {
    for (const key of Object.keys(require.cache)) {
      if (/src[\\/]config[\\/]index\.js$/.test(key)
        || /src[\\/]utils[\\/]response\.js$/.test(key)
        || /src[\\/]middleware[\\/]/.test(key)
        || /src[\\/]models[\\/]db\.js$/.test(key)) {
        delete require.cache[key];
      }
    }
  };

  clearCache();
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(extraEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    clearCache();
  }
}

// ─── 1. 生产环境 JWT 强密钥校验 ──────────────────────────────

test('config: production rejects short JWT secrets', async () => {
  await withEnv('production', { JWT_SECRET: 'too-short' }, () => {
    assert.throws(() => require('../src/config'), /JWT_SECRET/);
  });
});

test('config: production rejects weak placeholder JWT secrets', async () => {
  await withEnv('production', { JWT_SECRET: 'dev-jwt-secret' }, () => {
    assert.throws(() => require('../src/config'), /JWT_SECRET/);
  });
  await withEnv('production', { JWT_SECRET: 'change-this-to-random-secret-in-production' }, () => {
    assert.throws(() => require('../src/config'), /JWT_SECRET/);
  });
});

test('config: production requires separate strong ADMIN_JWT_SECRET', async () => {
  await withEnv('production', {
    JWT_SECRET: 'a'.repeat(40),
    ADMIN_JWT_SECRET: 'dev-admin-jwt-secret',
  }, () => {
    assert.throws(() => require('../src/config'), /ADMIN_JWT_SECRET/);
  });
});

test('config: strong secrets pass and admin secret is separate from user secret', async () => {
  await withEnv('development', {
    JWT_SECRET: 'u'.repeat(40),
    ADMIN_JWT_SECRET: 'a'.repeat(40),
  }, () => {
    const config = require('../src/config');
    assert.notEqual(config.jwt.secret, config.jwt.adminSecret);
    assert.equal(config.jwt.secret, 'u'.repeat(40));
    assert.equal(config.jwt.adminSecret, 'a'.repeat(40));
  });
});

test('config: production rejects identical user and admin signing secrets', async () => {
  await withEnv('production', {
    JWT_SECRET: 'u'.repeat(40),
    ADMIN_JWT_SECRET: 'u'.repeat(40),
  }, () => {
    assert.throws(() => require('../src/config'), /JWT_SECRET and ADMIN_JWT_SECRET must differ/);
  });
});

test('config: development falls back to dev secrets when env is weak', async () => {
  // Both secrets must be pinned weak here: dotenv loads back/.env values for
  // any var that is not already in process.env, so a strong ADMIN_JWT_SECRET
  // in .env would otherwise bypass the fallback branch under test.
  await withEnv('development', { JWT_SECRET: 'dev-jwt-secret', ADMIN_JWT_SECRET: 'dev-admin-jwt-secret' }, () => {
    const config = require('../src/config');
    assert.equal(config.jwt.secret, 'dev-jwt-secret');
    assert.equal(config.jwt.adminSecret, 'dev-admin-jwt-secret');
  });
});

// ─── 2. 生产错误响应不泄漏内部细节 ────────────────────────────

test('response.fail masks 5xx messages in production but keeps 4xx', async () => {
  await withEnv('production', { JWT_SECRET: 'p'.repeat(40), ADMIN_JWT_SECRET: 'q'.repeat(40) }, () => {
    const { fail } = require('../src/utils/response');
    const masked = fail('Duplicate entry for key uk_session_user', 500);
    assert.equal(masked.message, '服务开小差了，请稍后重试');
    assert.equal(masked.code, 500);
    const business = fail('用户名或密码错误', 401);
    assert.equal(business.message, '用户名或密码错误');
  });
});

test('response.fail keeps original message outside production', async () => {
  await withEnv('development', {}, () => {
    const { fail } = require('../src/utils/response');
    assert.equal(fail('some db detail', 500).message, 'some db detail');
  });
});

test('error-handler returns generic message for 5xx in production and logs', async () => {
  await withEnv('production', { JWT_SECRET: 'p'.repeat(40), ADMIN_JWT_SECRET: 'q'.repeat(40) }, () => {
    const errorHandler = require('../src/middleware/error-handler');
    const res = mockRes();
    const calls = [];
    const originalError = console.error;
    console.error = (...args) => calls.push(args);
    try {
      errorHandler(new Error('stack trace detail'), mockReq(), res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.message, '服务开小差了，请稍后重试');
      assert.equal(calls.length, 1);
    } finally {
      console.error = originalError;
    }
  });
});

// ─── 3. 内存级登录限流器 ─────────────────────────────────────

test('rate limiter locks after max failures and unlocks after lockMs', () => {
  const { InMemoryRateLimiter } = require('../src/middleware/rate-limiter');
  let now = 1_000_000;
  const limiter = new InMemoryRateLimiter({
    maxFailures: 3,
    windowMs: 1000,
    lockMs: 5000,
    now: () => now,
  });

  assert.equal(limiter.check('ip:admin').allowed, true);
  limiter.recordFailure('ip:admin');
  limiter.recordFailure('ip:admin');
  assert.equal(limiter.check('ip:admin').allowed, true);
  limiter.recordFailure('ip:admin'); // 第 3 次 → 锁定

  const result = limiter.check('ip:admin');
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs > 0 && result.retryAfterMs <= 5000);

  now += 5001; // 锁定到期
  assert.equal(limiter.check('ip:admin').allowed, true);
});

test('rate limiter window resets stale failures and clear() removes entries', () => {
  const { InMemoryRateLimiter } = require('../src/middleware/rate-limiter');
  let now = 1_000_000;
  const limiter = new InMemoryRateLimiter({
    maxFailures: 5,
    windowMs: 1000,
    lockMs: 5000,
    now: () => now,
  });

  limiter.recordFailure('k');
  now += 2000; // 窗口过期
  assert.equal(limiter.check('k').allowed, true);

  limiter.recordFailure('k');
  limiter.clear('k');
  assert.equal(limiter.check('k').allowed, true);
  // clear 后计数重置：再失败 maxFailures 次才锁定
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  assert.equal(limiter.check('k').allowed, true);
  limiter.recordFailure('k');
  assert.equal(limiter.check('k').allowed, false);
});

test('admin login rate limit middleware blocks after repeated 401s', () => {
  const { adminLoginRateLimit } = require('../src/middleware/rate-limiter');
  const middleware = adminLoginRateLimit({
    maxFailures: 2,
    windowMs: 1000,
    lockMs: 5000,
  });

  const attempt = (n) => {
    const req = mockReq({ ip: '1.2.3.4', body: { username: 'admin' } });
    const res = mockRes();
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
      res.statusCode = 401; // 模拟登录失败
      res.emit('finish');
    });
    assert.equal(nextCalled, true);
    return res;
  };

  attempt(1);
  attempt(2);
  // 第 3 次直接 429
  const req = mockReq({ ip: '1.2.3.4', body: { username: 'admin' } });
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
});

test('admin login rate limit clears counter on success', () => {
  const { adminLoginRateLimit } = require('../src/middleware/rate-limiter');
  const middleware = adminLoginRateLimit({ maxFailures: 2, windowMs: 1000, lockMs: 5000 });

  const attempt = (statusCode) => {
    const req = mockReq({ ip: '9.9.9.9', body: { username: 'ops' } });
    const res = mockRes();
    middleware(req, res, () => {
      res.statusCode = statusCode;
      res.emit('finish');
    });
  };

  attempt(401);
  attempt(200); // 成功登录 → 清空计数
  const req = mockReq({ ip: '9.9.9.9', body: { username: 'ops' } });
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true); // 未被锁定
});

// ─── 4. RBAC：requireRole ───────────────────────────────────

test('requireRole rejects normal admins and missing auth, allows super', () => {
  const { requireRole } = require('../src/middleware/require-role');

  const run = (admin) => {
    const req = mockReq();
    req.admin = admin;
    const res = mockRes();
    let nextCalled = false;
    requireRole('super')(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  };

  const normal = run({ adminId: 2, role: 'normal' });
  assert.equal(normal.nextCalled, false);
  assert.equal(normal.res.statusCode, 403);

  const noAuth = run(undefined);
  assert.equal(noAuth.nextCalled, false);
  assert.equal(noAuth.res.statusCode, 401);

  const superAdmin = run({ adminId: 1, role: 'super' });
  assert.equal(superAdmin.nextCalled, true);
});

test('sensitive config response is masked for normal role and raw for super', () => {
  const { maskSensitiveConfigForNormal } = require('../src/middleware/require-role');

  const buildPayload = () => ({
    code: 0,
    message: 'ok',
    data: [
      { key: 'wechat.login_secret', value: 'real-secret', isSensitive: true },
      { key: 'ai.api_key', value: 'real-api-key', isSensitive: true },
      { key: 'game.round_duration', value: '180', isSensitive: false },
    ],
  });

  const applyMask = (admin) => {
    const req = mockReq({ method: 'GET' });
    req.admin = admin;
    const res = mockRes();
    maskSensitiveConfigForNormal()(req, res, () => {});
    res.json(buildPayload());
    return res.body;
  };

  const normalView = applyMask({ adminId: 2, role: 'normal' });
  assert.equal(normalView.data[0].value, '******');
  assert.equal(normalView.data[1].value, '******');
  assert.equal(normalView.data[2].value, '180');

  const superView = applyMask({ adminId: 1, role: 'super' });
  assert.equal(superView.data[0].value, 'real-secret');
});

// ─── 5. admin-auth：独立密钥 + is_active 查库校验 ────────────

test('admin-auth rejects user tokens (separate secrets) and disabled admins', async () => {
  await withEnv('development', {}, async () => {
    const db = require('../src/models/db');
    const adminAuth = require('../src/middleware/admin-auth');
    const config = require('../src/config');

    let banned = false;
    db.queryOne = async () => ({ id: 1, username: 'admin', role: 'super', is_active: banned ? 0 : 1, session_version: 0 });

    // 用用户密钥签发的 token 无法通过管理员鉴权
    const userToken = jwt.sign({ userId: 5 }, config.jwt.secret, { expiresIn: '1h' });
    const res1 = mockRes();
    let nextCalled = false;
    await adminAuth(mockReq({ headers: { authorization: `Bearer ${userToken}` } }), res1, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res1.statusCode, 401);

    // 停用管理员 → 403
    banned = true;
    const adminToken = jwt.sign({ adminId: 1, sessionVersion: 0 }, config.jwt.adminSecret, { expiresIn: '1h' });
    const res2 = mockRes();
    await adminAuth(mockReq({ headers: { authorization: `Bearer ${adminToken}` } }), res2, () => {});
    assert.equal(res2.statusCode, 403);
    assert.match(res2.body.message, /停用/);

    // 启用管理员 → 放行，角色取自数据库
    banned = false;
    const req3 = mockReq({ headers: { authorization: `Bearer ${adminToken}` } });
    const res3 = mockRes();
    let passed = false;
    await adminAuth(req3, res3, () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(req3.admin.role, 'super');
    assert.equal(req3.admin.adminId, 1);
  });
});

// ─── 6. 用户鉴权：封禁校验 ──────────────────────────────────

test('user auth middleware blocks banned users with 403', async () => {
  await withEnv('development', {}, async () => {
    const db = require('../src/models/db');
    const authMiddleware = require('../src/middleware/auth');
    const config = require('../src/config');

    let banned = true;
    db.queryOne = async () => (banned ? { is_banned: 1 } : { is_banned: 0 });

    const token = jwt.sign({ userId: 7 }, config.jwt.secret, { expiresIn: '1h' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /封禁/);

    // 解封后放行
    banned = false;
    authMiddleware.__private.userStateCache.clear();
    const req2 = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res2 = mockRes();
    await authMiddleware(req2, res2, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req2.user.userId, 7);
  });
});

test('user auth middleware rejects tokens for deleted users', async () => {
  await withEnv('development', {}, async () => {
    const db = require('../src/models/db');
    const authMiddleware = require('../src/middleware/auth');
    const config = require('../src/config');
    db.queryOne = async () => null;

    const token = jwt.sign({ userId: 999 }, config.jwt.secret, { expiresIn: '1h' });
    const res = mockRes();
    await authMiddleware(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, () => {});
    assert.equal(res.statusCode, 401);
  });
});

// ─── 8. admin 路由挂载（RBAC 接线）──────────────────────────

test('admin router mounts role guards for admins/configs/coins', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const index = fs.readFileSync(path.join(__dirname, '../src/routes/admin/index.js'), 'utf8');

  assert.match(index, /requireRole\('super'\)/);
  assert.match(index, /\/users\/:id\/coins/);
  assert.match(index, /\/admins/, 'admins router mounted');
  assert.match(index, /maskSensitiveConfigForNormal/);
  assert.match(index, /\/configs/);
});
