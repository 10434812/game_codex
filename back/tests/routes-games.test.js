const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * GET /api/games/:id and GET /api/games/:id/result must only be readable by
 * players of that session; outsiders get the same 404 as a missing game so
 * auto-increment session ids are not enumerable.
 */
function loadGamesRouter({ isMember = false, sessionStatus = 'finished', hasResult = false, hasPlayerRow = false } = {}) {
  const dbPath = require.resolve('../src/models/db');
  const authPath = require.resolve('../src/middleware/auth');
  const routerPath = require.resolve('../src/routes/games');

  const dbStub = {
    execute: async () => [{ affectedRows: 1 }, []],
    queryOne: async (sql, params = []) => {
      if (/FROM game_players/.test(sql)) {
        return isMember ? { id: 1 } : null;
      }
      if (/FROM game_sessions/.test(sql)) {
        return sessionStatus ? { id: Number(params[0]), status: sessionStatus, stage_id: 1 } : null;
      }
      if (/FROM game_results/.test(sql)) {
        return hasResult
          ? { result_json: JSON.stringify({ ranking: [{ id: '1', name: '甲', score: '100', avatar: '', rank: 1 }], gain: 0, coins: 0 }) }
          : null;
      }
      return null;
    },
    queryAll: async () => [],
    pool: { getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute: async () => [{ affectedRows: 1 }, []] }) },
  };
  const authStub = (req, _res, next) => {
    req.user = { userId: 1 };
    next();
  };

  delete require.cache[routerPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: authStub };
  return require('../src/routes/games');
}

function findHandler(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  return null;
}

async function invoke(handler, params) {
  let statusCode = 200;
  let body = null;
  const req = { params, user: { userId: 1 }, body: {}, app: { get: () => null } };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(obj) {
      body = obj;
    },
  };
  await handler(req, res, (err) => {
    throw err;
  });
  return { statusCode, body };
}

test('GET /games/:id returns 404 for a non-member (session id not enumerable)', async () => {
  const router = loadGamesRouter({ isMember: false, sessionStatus: 'finished' });
  const handler = findHandler(router, 'get', '/:id');
  assert.ok(handler);

  const { statusCode, body } = await invoke(handler, { id: '1' });

  assert.equal(statusCode, 404);
  assert.match(body.message, /对局不存在/);
});

test('GET /games/current 按当前账号查询进行中的对局，路由优先于通用ID', async () => {
  const router = loadGamesRouter();
  const db = require('../src/models/db');
  db.queryOne = async (sql, params) => {
    assert.match(sql, /gp.user_id = \? AND gs.status = 'playing'/);
    assert.deepEqual(params, [1]);
    return {sessionId: 9, roomId: 7};
  };
  const {statusCode, body} = await invoke(findHandler(router, 'get', '/current'), {});
  assert.equal(statusCode, 200);
  assert.deepEqual(body.data, {sessionId: 9, roomId: 7});
  const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.ok(paths.indexOf('/current') < paths.indexOf('/:id'));
});

test('POST /games/:id/cancel-start 拒绝非成员取消对局', async () => {
  const router = loadGamesRouter({isMember: false});
  const {statusCode} = await invoke(findHandler(router, 'post', '/:id/cancel-start'), {id: '9'});
  assert.equal(statusCode, 404);
});

test('GET /games/:id returns session state for a member', async () => {
  const router = loadGamesRouter({ isMember: true, sessionStatus: 'finished' });
  const handler = findHandler(router, 'get', '/:id');

  const { statusCode, body } = await invoke(handler, { id: '1' });

  assert.equal(statusCode, 200);
  assert.equal(body.data.sessionId, 1);
  assert.equal(body.data.status, 'finished');
});

test('GET /games/:id rejects non-numeric ids', async () => {
  const router = loadGamesRouter({ isMember: true, sessionStatus: 'finished' });
  const handler = findHandler(router, 'get', '/:id');

  const { statusCode } = await invoke(handler, { id: 'abc' });

  assert.equal(statusCode, 400);
});

test('GET /games/:id/result returns 404 for a non-member', async () => {
  const router = loadGamesRouter({ isMember: false, hasResult: true });
  const handler = findHandler(router, 'get', '/:id/result');

  const { statusCode, body } = await invoke(handler, { id: '1' });

  assert.equal(statusCode, 404);
  assert.match(body.message, /对局不存在/);
});

test('GET /games/:id/result returns personalized result for a member', async () => {
  const router = loadGamesRouter({ isMember: true, hasResult: true, hasPlayerRow: true, sessionStatus: 'finished' });
  const handler = findHandler(router, 'get', '/:id/result');

  const { statusCode, body } = await invoke(handler, { id: '1' });

  assert.equal(statusCode, 200);
  assert.ok(body.data);
  assert.equal(body.data.gain, 0);
});
