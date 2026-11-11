/**
 * 战绩一致性验证：TS 移植版与小程序端 utils/player-stats.js 逐项比对。
 *
 * 两个模块共用同一个存储键，因此各自使用独立的替身存储，逐个用例切换。
 */

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

import * as statsTs from '../src/core/PlayerStats';

const requireFromHere = createRequire(import.meta.url);
const statsJs = requireFromHere('../../utils/player-stats.js') as {
  getState(): unknown;
  getSummary(): unknown;
  getIncomeRecords(): unknown;
  recordSettlement(payload: unknown): unknown;
  clearLocalData(): unknown;
};

const STATS_KEY = 'game_codex_player_stats_v1';

interface LegacyModule {
  getState(): unknown;
  getSummary(): unknown;
  getIncomeRecords(): unknown;
  recordSettlement(payload: unknown): unknown;
  clearLocalData(): unknown;
}

/** 用指定存储驱动旧模块，返回结果。 */
function runLegacy<T>(storage: Map<string, unknown>, run: (module: LegacyModule) => T): T {
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  try {
    return run(statsJs);
  } finally {
    Reflect.deleteProperty(globalThis, 'wx');
  }
}

/** 用指定存储驱动移植版。 */
function runPort<T>(storage: Map<string, unknown>, run: () => T): T {
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  try {
    return run();
  } finally {
    Reflect.deleteProperty(globalThis, 'wx');
  }
}

test('空存储时初始状态一致', () => {
  const legacyStorage = new Map<string, unknown>();
  const portStorage = new Map<string, unknown>();
  const legacy = runLegacy(legacyStorage, (module) => module.getState());
  const port = runPort(portStorage, () => statsTs.getState());
  assert.deepStrictEqual(port, legacy);
  assert.deepStrictEqual(
    runPort(portStorage, () => statsTs.getSummary()),
    runLegacy(legacyStorage, (module) => module.getSummary())
  );
});

/** 缺省 createdAt 会回落到 Date.now()，两侧毫秒不同，比对时剥离。 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : null;
}

function stripCreatedAt(value: unknown): unknown {
  const state = asRecord(value);
  if (!state) {
    return value;
  }
  const records = state.records;
  return {
    ...state,
    records: Array.isArray(records)
      ? records.map((record) => {
          const item = asRecord(record);
          if (!item) {
            return record;
          }
          const {createdAt: _createdAt, ...rest} = item;
          return rest;
        })
      : records,
  };
}

test('残缺状态被规范化后一致', () => {
  const seed = {
    totalIncome: -10,
    totalExp: 'abc',
    records: [
      {id: '', income: 1},
      {id: 'a', createdAt: 1700000000000, stageName: '', achievement: 3, income: -5, exp: '7', modeText: null},
      null,
      'x',
      {id: 'b', createdAt: 'bad', stageName: '西湖夜游', income: '12.9', exp: 3.7},
    ],
  };
  const legacyStorage = new Map<string, unknown>([[STATS_KEY, structuredClone(seed)]]);
  const portStorage = new Map<string, unknown>([[STATS_KEY, structuredClone(seed)]]);
  const legacyState = runLegacy(legacyStorage, (module) => module.getState());
  const portState = runPort(portStorage, () => statsTs.getState());
  assert.deepStrictEqual(stripCreatedAt(portState), stripCreatedAt(legacyState));
  // 缺省时间戳应回落到当前时间，而不是 0 或 NaN
  const fallbackRecord = (portState as {records: {id: string; createdAt: number}[]}).records.find(
    (record) => record.id === 'b'
  );
  assert.ok(fallbackRecord);
  assert.ok(Math.abs(fallbackRecord.createdAt - Date.now()) < 60_000);
});

test('结算记录：去重、累加与排序一致', () => {
  const legacyStorage = new Map<string, unknown>();
  const portStorage = new Map<string, unknown>();

  const payloads = [
    {resultId: 'r1', stageName: '万里长城', achievement: '长城守望者', income: 300, exp: 120, modeText: '本地体验', createdAt: 1700000000000},
    {resultId: 'r1', stageName: '重复', income: 999, exp: 999, createdAt: 1700000001000},
    {resultId: 'r2', stageName: '富士山', achievement: '富士远眺者', income: 0, exp: 0, createdAt: 1700000002000},
    {id: 'r3', stageName: '大峡谷', income: -20, exp: 1.9, createdAt: 1700000003000},
    {resultId: '', income: 10},
  ];

  for (const payload of payloads) {
    const legacy = runLegacy(legacyStorage, (module) => module.recordSettlement(payload));
    const port = runPort(portStorage, () => statsTs.recordSettlement(payload));
    assert.deepStrictEqual(port, legacy, `payload=${JSON.stringify(payload)}`);
  }

  assert.deepStrictEqual(
    runPort(portStorage, () => statsTs.getIncomeRecords()),
    runLegacy(legacyStorage, (module) => module.getIncomeRecords())
  );
  assert.deepStrictEqual(
    runPort(portStorage, () => statsTs.getSummary()),
    runLegacy(legacyStorage, (module) => module.getSummary())
  );
});

test('超过 200 条时截断行为一致', () => {
  const records = Array.from({length: 205}, (_, index) => ({
    id: `rec-${index}`,
    createdAt: 1700000000000 + index,
    stageName: '万里长城',
    achievement: '长城守望者',
    income: index,
    exp: index,
    modeText: '本地体验',
  }));
  const seed = {totalIncome: 1000, totalExp: 2000, records};

  const legacyStorage = new Map<string, unknown>([[STATS_KEY, structuredClone(seed)]]);
  const portStorage = new Map<string, unknown>([[STATS_KEY, structuredClone(seed)]]);
  const legacyState = runLegacy(legacyStorage, (module) => module.getState()) as {records: unknown[]};
  const portState = runPort(portStorage, () => statsTs.getState());
  assert.equal(legacyState.records.length, 200);
  assert.deepStrictEqual(portState, legacyState);
});

test('清空本地数据行为一致', () => {
  const seed = {totalIncome: 5, totalExp: 5, records: [{id: 'a', income: 5, exp: 5, createdAt: 1, stageName: 'x'}]};
  const legacyStorage = new Map<string, unknown>([[STATS_KEY, structuredClone(seed)]]);
  const portStorage = new Map<string, unknown>([[STATS_KEY, structuredClone(seed)]]);
  assert.deepStrictEqual(
    runPort(portStorage, () => statsTs.clearLocalData()),
    runLegacy(legacyStorage, (module) => module.clearLocalData())
  );
  assert.equal(portStorage.has(STATS_KEY), false);
  assert.equal(legacyStorage.has(STATS_KEY), false);
});
