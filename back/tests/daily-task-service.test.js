const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models/db');
const service = require('../src/services/daily-task-service');

test('每日任务在北京时间零点重置', () => {
  assert.equal(service.taskDate(new Date('2026-10-30T15:59:59Z')), '2026-10-30');
  assert.equal(service.taskDate(new Date('2026-10-30T16:00:00Z')), '2026-10-31');
});

test('未参与玩家从零开始，已完成任务展示封顶进度和领取状态', async (t) => {
  let row = null;
  t.mock.method(db, 'queryOne', async () => row);
  assert.deepEqual((await service.getTasks(1)).tasks.map((x) => x.progress), [0, 0, 0]);
  row = {games: 7, teamed: 2, claimed: 1};
  const {tasks} = await service.getTasks(1);
  assert.deepEqual(tasks.map((x) => x.progress), [1, 3, 1]);
  assert.deepEqual(tasks.map((x) => x.claimed), [true, false, false]);
});

test('奖励仅可领取一次；进度不足、无效任务和流水写入失败不会发放奖励', async (t) => {
  const row = {games: 1, teamed: 0, claimed: 0};
  let coins = 100;
  let failLedger = false;
  const ledger = [];
  let snapshot;
  const conn = {
    beginTransaction: async () => { snapshot = {coins, claimed: row.claimed}; },
    execute: async (sql, params) => {
      if (sql.startsWith('SELECT coins')) return [[{coins}]];
      if (sql.startsWith('SELECT games')) return [[row]];
      if (sql.startsWith('UPDATE daily_tasks')) row.claimed |= params[0];
      if (sql.startsWith('UPDATE users')) coins += params[0];
      if (sql.startsWith('INSERT INTO coin_records')) {
        if (failLedger) throw new Error('ledger unavailable');
        ledger.push(params);
      }
      return [{affectedRows: 1}];
    },
    commit: async () => {},
    rollback: async () => { coins = snapshot.coins; row.claimed = snapshot.claimed; },
    release() {},
  };
  t.mock.method(db.pool, 'getConnection', async () => conn);
  await assert.rejects(service.claim(1, 'unknown'), {statusCode: 404});
  await assert.rejects(service.claim(1, 'play3'), {statusCode: 409});
  await assert.rejects(service.claim(1, 'team1'), {statusCode: 409});
  failLedger = true;
  await assert.rejects(service.claim(1, 'play1'), /ledger unavailable/);
  assert.equal(coins, 100);
  assert.equal(row.claimed, 0);
  failLedger = false;
  assert.deepEqual(await service.claim(1, 'play1'), {coins: 120, reward: 20});
  await assert.rejects(service.claim(1, 'play1'), {statusCode: 409});
  assert.equal(coins, 120);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0][3], 'daily_task');
});
