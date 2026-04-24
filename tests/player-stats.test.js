const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
};

const stats = require('../utils/player-stats');

test.beforeEach(() => {
  storage.clear();
  stats.__resetForTests();
});

test('recordSettlement 会累计收益和经验', () => {
  stats.recordSettlement({
    resultId: 'result-1',
    stageName: '万里长城',
    achievement: '长城守望者',
    income: 360,
    exp: 120,
    modeText: '本地体验',
    createdAt: 1710000000000,
  });

  const summary = stats.getSummary();
  const records = stats.getIncomeRecords();

  assert.equal(summary.totalIncome, 360);
  assert.equal(summary.totalExp, 120);
  assert.equal(summary.recordsCount, 1);
  assert.equal(records[0].stageName, '万里长城');
  assert.equal(records[0].income, 360);
});

test('recordSettlement 按 resultId 去重', () => {
  stats.recordSettlement({resultId: 'result-dup', income: 300, exp: 100});
  stats.recordSettlement({resultId: 'result-dup', income: 300, exp: 100});

  const summary = stats.getSummary();
  assert.equal(summary.totalIncome, 300);
  assert.equal(summary.totalExp, 100);
  assert.equal(summary.recordsCount, 1);
});
