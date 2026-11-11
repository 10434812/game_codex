const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const shopService = require('../src/services/shop-service');

test('backend shop catalog includes avatar ring items', async () => {
  const items = await shopService.getItems();

  assert.ok(items.some((item) => item.category === 'ring' && item.id === 'ring-amber-glow'));
});

test('user_items schema supports ring inventory category', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/001_create_tables.sql'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/shop.js'), 'utf8');

  assert.match(sql, /ENUM\('skin','pet','ring'\)/);
  assert.match(route, /\['skin', 'pet', 'ring'\]/);
});

// ─── buyItem: affectedRows guard (concurrent purchase race) ──────────────

function loadShopService(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/shop-service');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/services/shop-service');
}

function createBuyConnection({ deductAffected = 1, throwOnInsertItem = false, balance = 5000 }) {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
    execute: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/UPDATE users SET coins/.test(sql)) {
        return [{ affectedRows: deductAffected }, []];
      }
      if (/SELECT coins FROM users/.test(sql)) {
        return [[{ coins: balance }], []];
      }
      if (/INSERT INTO user_items/.test(sql) && throwOnInsertItem) {
        const err = new Error('Duplicate entry \'1-pet-jinli\' for key \'user_items.uk_user_item\'');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  return { connection, calls };
}

function createBuyDbStub(connection) {
  return {
    pool: { getConnection: async () => connection },
    queryOne: async (sql) => {
      if (/SELECT coins FROM users/.test(sql)) return { coins: 5000 };
      if (/FROM user_items/.test(sql)) return null;
      return null;
    },
    queryAll: async () => [],
  };
}

test('buyItem rejects and rolls back when the coin deduction affects 0 rows (race)', async () => {
  const { connection, calls } = createBuyConnection({ deductAffected: 0 });
  const svc = loadShopService(createBuyDbStub(connection));

  await assert.rejects(() => svc.buyItem(1, 'pet-jinli'), /金币不足/);

  // Item was NOT granted and no ledger row was written.
  assert.equal(calls.filter((call) => /INSERT INTO user_items/.test(call.sql)).length, 0);
  assert.equal(calls.filter((call) => /INSERT INTO coin_records/.test(call.sql)).length, 0);
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
});

test('buyItem grants the item, deducts coins and writes a ledger row', async () => {
  const { connection, calls } = createBuyConnection({ balance: 5000 - 666 });
  const svc = loadShopService(createBuyDbStub(connection));

  const result = await svc.buyItem(1, 'pet-jinli');

  assert.equal(result.coins, 4334);
  assert.equal(result.item.id, 'pet-jinli');
  assert.equal(calls.filter((call) => /INSERT INTO user_items/.test(call.sql)).length, 1);
  const record = calls.find((call) => /INSERT INTO coin_records/.test(call.sql));
  assert.equal(record.params[0], 1);
  assert.equal(record.params[1], -666);
  assert.equal(record.params[2], 4334);
  assert.equal(record.params[3], 'purchase');
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
});

test('buyItem maps a duplicate-ownership race to a friendly error', async () => {
  const { connection, calls } = createBuyConnection({ throwOnInsertItem: true });
  const svc = loadShopService(createBuyDbStub(connection));

  await assert.rejects(() => svc.buyItem(1, 'pet-jinli'), /已拥有该物品/);

  // Rolled back: no ledger row, no commit.
  assert.equal(calls.filter((call) => /INSERT INTO coin_records/.test(call.sql)).length, 0);
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
});
