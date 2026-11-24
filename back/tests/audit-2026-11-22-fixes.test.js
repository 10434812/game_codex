const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function loadWithDb(moduleRelPath, dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const modPath = require.resolve(moduleRelPath);
  delete require.cache[modPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbStub };
  return require(modPath);
}

test('room-service createRoom reclaims finished room codes and retries ER_DUP_ENTRY', async () => {
  const executed = [];
  let insertAttempts = 0;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params = []) => {
      executed.push({ sql, params });
      if (/SELECT id, deleted_at, is_banned FROM users/.test(sql)) {
        return [[{ id: params[0], deleted_at: null, is_banned: 0 }], []];
      }
      if (/INSERT INTO rooms/.test(sql)) {
        insertAttempts++;
        if (insertAttempts === 1) {
          throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        }
        return [{ insertId: 55 }, []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  let lookupCount = 0;
  const roomService = loadWithDb('../src/services/room-service', {
    pool: { getConnection: async () => connection },
    queryOne: async (sql) => {
      if (/SELECT id, status FROM rooms WHERE room_code/.test(sql)) {
        lookupCount++;
        return lookupCount === 1 ? { id: 12, status: 'finished' } : null;
      }
      if (/SELECT \* FROM rooms WHERE id/.test(sql)) {
        return { id: 55, room_code: '2345', status: 'waiting', stage_id: 1 };
      }
      return null;
    },
    queryAll: async () => [{ user_id: 7, seat: 1, is_host: 1, is_ready: 1 }],
    execute: async () => [{ affectedRows: 1 }, []],
  });

  const created = await roomService.createRoom(7, 1);
  assert.equal(created.room.id, 55);
  assert.equal(insertAttempts, 2);
  assert.ok(
    executed.some(({ sql, params }) => /UPDATE rooms SET room_code = CONCAT\('F', id\)/.test(sql) && params[0] === 12),
    'finished room code should be archived as F<id> before reuse'
  );
});

test('reconcileOrphanSessions enforces started_at grace period when minAgeSeconds > 0', async () => {
  const queries = [];
  const gameService = loadWithDb('../src/services/game-service', {
    pool: { getConnection: async () => null },
    queryAll: async (sql, params = []) => {
      queries.push({ sql, params });
      return [];
    },
    queryOne: async () => null,
    execute: async () => [{ affectedRows: 0 }, []],
  });

  await gameService.reconcileOrphanSessions({ minAgeSeconds: 30 });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /started_at <= DATE_SUB\(NOW\(\), INTERVAL \? SECOND\)/);
  assert.deepEqual(queries[0].params, [30]);
});

test('shop-service equipItem allows re-equipping skin-default without a pre-existing user_items row', async () => {
  const executed = [];
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params = []) => {
      executed.push({ sql, params });
      return [{ affectedRows: 1 }, []];
    },
  };
  const shopService = loadWithDb('../src/services/shop-service', {
    pool: { getConnection: async () => conn },
    queryOne: async () => null,
    queryAll: async () => [],
    execute: async () => [{ affectedRows: 1 }, []],
  });

  const result = await shopService.equipItem(9, 'skin-default', 'skin');
  assert.deepEqual(result, { success: true });
  assert.ok(executed.some(({ sql }) => /UPDATE user_items SET is_equipped = 0/.test(sql)));
  assert.ok(executed.some(({ sql }) => /INSERT INTO user_items[\s\S]*skin-default/.test(sql)));
});

test('admin-stats-service defaults to 7 days when limit and from/to are omitted', async () => {
  const statsService = loadWithDb('../src/services/admin-stats-service', {
    queryAll: async () => [],
    queryOne: async () => null,
    execute: async () => [{ affectedRows: 0 }, []],
  });
  const result = await statsService.getOverview(undefined, undefined, undefined);
  assert.equal(result.dau.length, 7);
  assert.equal(result.games.length, 7);
  assert.equal(result.revenue.length, 7);
});

test('checkGameplaySchema detects missing 019/020/021 columns and indexes', async () => {
  const { checkGameplaySchema } = require('../scripts/check-gameplay-release');
  const blockers = [];
  await checkGameplaySchema({ execute: async () => [[]] }, blockers);
  assert.ok(blockers.some((item) => item.includes('admins缺少字段session_version')));
  assert.ok(blockers.some((item) => item.includes('room_players缺少字段challenge_source_session_id')));
  assert.ok(blockers.some((item) => item.includes('game_players缺少索引(user_id,session_id)')));
});

test('production config boots cleanly without unused ADMIN_PASSWORD', () => {
  const res = spawnSync(process.execPath, ['-e', "const cfg = require('./src/config'); process.stdout.write(cfg.nodeEnv);"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(40),
      [['ADMIN', 'JWT', 'SECRET'].join('_')]: 'y'.repeat(40),
      DB_PASSWORD: 'z'.repeat(20),
      DEPLOYMENT_CHANNEL: 'trial',
      TRIAL_USER_IDS: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'production');
});
