const test = require('node:test');
const assert = require('node:assert/strict');

function loadService(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/admin-stats-service');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/services/admin-stats-service');
}

test('getOverview with limit returns exactly N calendar days, zero-filled', async () => {
  const calls = [];
  // A date guaranteed to be inside the last-7-days window (today - 2).
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const insideDate = fmt(twoDaysAgo);

  const dbStub = {
    queryAll: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM game_sessions gs/.test(sql)) {
        // dau: one row inside the window
        return [{ date: twoDaysAgo, count: 4 }];
      }
      if (/FROM game_sessions/.test(sql)) {
        return [];
      }
      if (/FROM coin_records/.test(sql)) {
        return [{ date: twoDaysAgo, amount: '300' }];
      }
      return [];
    },
    queryOne: async () => null,
    execute: async () => [{ affectedRows: 1 }, []],
  };
  const svc = loadService(dbStub);

  const result = await svc.getOverview(undefined, undefined, 7);

  assert.equal(result.dau.length, 7);
  assert.equal(result.games.length, 7);
  assert.equal(result.revenue.length, 7);
  // Dates are strictly the last 7 calendar days ending today.
  const dates = result.dau.map((item) => item.date);
  const today = new Date();
  const expectedLast = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  assert.equal(dates[dates.length - 1], expectedLast);
  // Zero-fill: the known 4-user day is preserved, others are 0.
  const dauByDate = Object.fromEntries(result.dau.map((item) => [item.date, item.count]));
  assert.equal(dauByDate[insideDate], 4);
  assert.deepEqual(result.revenue.find((item) => item.date === insideDate), { date: insideDate, amount: 300 });
  assert.equal(Object.values(dauByDate).filter((count) => count > 0).length, 1);
  assert.equal(Object.values(dauByDate).filter((count) => count === 0).length, 6);
  // The range used in SQL starts 6 days before today.
  assert.match(calls[0].sql, /gs\.started_at >= \? AND gs\.started_at <= \?/);
});

test('getOverview with explicit from/to keeps the given range (StatsOverview compatibility)', async () => {
  const calls = [];
  const dbStub = {
    queryAll: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM game_sessions gs/.test(sql)) return [{ date: new Date(2026, 0, 1), count: 2 }];
      if (/FROM game_sessions/.test(sql)) return [];
      if (/FROM coin_records/.test(sql)) return [{ date: new Date(2026, 0, 1), amount: '40' }];
      return [];
    },
    queryOne: async () => null,
    execute: async () => [{ affectedRows: 1 }, []],
  };
  const svc = loadService(dbStub);

  const result = await svc.getOverview('2026-01-01', '2026-01-02', 7);

  assert.deepEqual(result.dau, [{ date: '2026-01-01', count: 2 }]);
  assert.deepEqual(result.revenue, [{ date: '2026-01-01', amount: 40 }]);
  assert.equal(calls[0].params[0], '2026-01-01');
  assert.equal(calls[0].params[1], '2026-01-02 23:59:59');
});
