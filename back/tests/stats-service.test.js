const test = require('node:test');
const assert = require('node:assert/strict');

function loadStatsService(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/stats-service');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/services/stats-service');
}

test('getSummary reads recordCount from mysql execute rows', async () => {
  const statsService = loadStatsService({
    queryOne: async () => ({
      total_income: 1200,
      total_exp: 320,
      game_count: 4,
      win_count: 1,
      level: 3,
    }),
    execute: async () => [[{recordCount: 7}], []],
  });

  const summary = await statsService.getSummary(12);

  assert.equal(summary.recordCount, 7);
});

test('getCoinRecords returns account ledger records for income page', async () => {
  const statsService = loadStatsService({
    execute: async () => [[{total: 1}], []],
    queryAll: async () => [
      {
        id: 3,
        amount: -880,
        balance_after: 7940,
        type: 'purchase',
        title: '购买 琥珀流光',
        created_at: '2026-05-13 10:00:00',
      },
    ],
  });

  const result = await statsService.getCoinRecords(12, 1, 50);

  assert.equal(result.total, 1);
  assert.deepEqual(result.records[0], {
    id: 3,
    amount: -880,
    balanceAfter: 7940,
    type: 'purchase',
    title: '购买 琥珀流光',
    createdAt: '2026-05-13 10:00:00',
  });
});
