const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({balance = 100, missing = false, failLedger = false} = {}) {
  const ledger = [], calls = [];
  let coins = balance, commits = 0, rollbacks = 0, released = 0;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {commits++;},
    rollback: async () => {rollbacks++; coins = balance;},
    release: () => {released++;},
    execute: async (sql, params) => {
      calls.push(sql);
      if (/SELECT coins FROM users/.test(sql)) return [missing ? [] : [{coins}]];
      if (/UPDATE users SET coins/.test(sql)) {
        coins = /GREATEST/.test(sql) ? Math.max(0, coins + params[0]) : params[0];
        return [{affectedRows: missing ? 0 : 1}];
      }
      if (/INSERT INTO coin_records/.test(sql)) {
        if (failLedger) throw new Error('ledger unavailable');
        ledger.push(params);
      }
      return [{affectedRows: 1}];
    },
  };
  const db = {pool: {getConnection: async () => connection}};
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/admin-user-service.js'), 'utf8'), {
    module, require: (name) => name === '../models/db' ? db : {},
  });
  return {service: module.exports, ledger, calls, state: () => ({coins, commits, rollbacks, released})};
}

test('超额扣款夹到零时，流水记录实际扣款而非请求扣款', async () => {
  const h = harness();
  const result = await h.service.adjustCoins(7, -1000, '纠错');
  assert.equal(result.coins, 0);
  assert.equal(h.ledger[0][1], -100);
  assert.equal(h.ledger[0][2], 0);
  assert.match(h.calls[0], /SELECT.*FOR UPDATE/);
  assert.deepEqual(h.state(), {coins: 0, commits: 1, rollbacks: 0, released: 1});
});

test('不存在的用户不允许调整余额或写入孤儿流水', async () => {
  const h = harness({missing: true});
  await assert.rejects(h.service.adjustCoins(99, 10), {statusCode: 404});
  assert.equal(h.ledger.length, 0);
  assert.equal(h.state().rollbacks, 1);
  assert.equal(h.state().released, 1);
});

test('拒绝小数、无穷、溢出和零金额，且不修改余额', async () => {
  for (const amount of [1.5, Infinity, NaN, 4294967296, -4294967296, 0]) {
    const h = harness();
    await assert.rejects(h.service.adjustCoins(7, amount), {statusCode: 400});
    assert.equal(h.ledger.length, 0);
    assert.equal(h.state().coins, 100);
  }
});

test('余额加款不得超出数据库无符号整型范围', async () => {
  const h = harness({balance: 4294967290});
  await assert.rejects(h.service.adjustCoins(7, 10), {statusCode: 400});
  assert.equal(h.ledger.length, 0);
  assert.equal(h.state().coins, 4294967290);
});

test('流水写入失败时回滚余额，成功加款时账实相符', async () => {
  const failed = harness({failLedger: true});
  await assert.rejects(failed.service.adjustCoins(7, 20), /ledger unavailable/);
  assert.deepEqual(failed.state(), {coins: 100, commits: 0, rollbacks: 1, released: 1});
  const success = harness();
  await success.service.adjustCoins(7, 20);
  assert.equal(success.ledger[0][1], 20);
  assert.equal(success.ledger[0][2], 120);
});
