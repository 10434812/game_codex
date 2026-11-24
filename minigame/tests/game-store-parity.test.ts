/**
 * 对局状态机一致性验证：TS 移植版与小程序端 utils/game-store.js 逐 tick 比对。
 *
 * 两个模块都是单例并各自持有模块级状态，因此分别用独立的替身存储驱动。
 * 注意：每个用例只在开头重置一次，之后的每一步都必须在**未重置**的状态上继续，
 * 否则多步流程（建房→开局→tick）会被打断。
 * resultId 与 scoreLog 的时间戳是随机的，比对前剥离。
 */

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';

import * as storeTs from '../src/core/GameStore';
import {makeRandom} from './seeded-random';

const requireFromHere = createRequire(import.meta.url);

interface LegacyGameStore {
  getState(): unknown;
  subscribe(listener: (state: unknown) => void): () => void;
  createRoomFromStage(stage: unknown, options?: unknown): unknown;
  ensureRoom(stage: unknown, options?: unknown): unknown;
  inviteHumanPlayer(options?: unknown): unknown;
  startGame(options?: unknown): unknown;
  restartGame(options?: unknown): unknown;
  tick(options?: unknown): unknown;
  finishGame(): unknown;
  applyPlayerScoreDelta(playerId: string, delta: unknown, options?: unknown): unknown;
  setSelfTeam(mateId: string): unknown;
  clearSelfTeam(): unknown;
  setSelfReady(ready: unknown): unknown;
  resetToHome(): unknown;
  isValidPersistedState(raw: unknown): boolean;
  __resetForTests(): void;
}

const storeJs = requireFromHere('../../utils/game-store.js') as LegacyGameStore;

const GAME_KEY = 'game_codex_game_state_v1';

function withStorage<T>(storage: Map<string, unknown>, run: () => T): T {
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    showToast: () => undefined,
  });
  try {
    return run();
  } finally {
    Reflect.deleteProperty(globalThis, 'wx');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : null;
}

function stripScoreLog(log: unknown): unknown {
  const map = asRecord(log);
  if (!map) {
    return log;
  }
  return Object.fromEntries(
    Object.entries(map).map(([playerId, entries]) => [
      playerId,
      Array.isArray(entries)
        ? entries.map((entry) => {
            const item = asRecord(entry);
            return item ? {type: item.type, delta: item.delta, round: item.round} : entry;
          })
        : entries,
    ])
  );
}

function stripGameState(value: unknown): unknown {
  const state = asRecord(value);
  if (!state) {
    return value;
  }
  const result = asRecord(state.result);
  return {
    ...state,
    result: result ? {...result, resultId: '<result-id>'} : state.result,
    scoreLog: stripScoreLog(state.scoreLog),
  };
}

interface Pair {
  legacyStorage: Map<string, unknown>;
  portStorage: Map<string, unknown>;
}

function createPair(): Pair {
  return {legacyStorage: new Map(), portStorage: new Map()};
}

/** 只在用例开头调用一次：把两侧都置为初始态。 */
function resetBoth(pair: Pair): void {
  withStorage(pair.legacyStorage, () => storeJs.__resetForTests());
  withStorage(pair.portStorage, () => storeTs.__resetForTests());
}

/** 双模块并行执行同一步操作，并逐次比对状态。 */
function stepBoth<T>(
  pair: Pair,
  legacyRun: (module: LegacyGameStore) => T,
  portRun: () => T,
  label: string
): [T, T] {
  const legacy = withStorage(pair.legacyStorage, () => legacyRun(storeJs));
  const port = withStorage(pair.portStorage, () => portRun());
  assert.deepStrictEqual(stripGameState(port), stripGameState(legacy), label);
  return [legacy, port];
}

test('持久化恢复判定与小程序端行为一致', () => {
  // 旧模块没有导出 isValidPersistedState，因此改为：把种子写进存储后
  // 清掉 require 缓存重新加载旧模块，用它的真实恢复结果反查移植版的判定。
  const modulePath = requireFromHere.resolve('../../utils/game-store.js');
  const cases: {persisted: unknown; restoredStatus: string; cleared: boolean}[] = [
    {persisted: null, restoredStatus: 'idle', cleared: false},
    {persisted: {}, restoredStatus: 'idle', cleared: true},
    {persisted: {status: 'idle'}, restoredStatus: 'idle', cleared: true},
    {persisted: {status: 'finished'}, restoredStatus: 'idle', cleared: true},
    {persisted: {status: 'playing', players: [], teams: [], timeLeft: 10}, restoredStatus: 'idle', cleared: true},
    {
      persisted: {status: 'playing', players: [{id: 'a', score: 10}], teams: [], timeLeft: 10},
      restoredStatus: 'playing',
      cleared: false,
    },
    {
      persisted: {status: 'playing', players: [{id: 'a', score: 10}], teams: [], timeLeft: 0},
      restoredStatus: 'idle',
      cleared: true,
    },
    {persisted: {status: 'room', players: []}, restoredStatus: 'idle', cleared: true},
    {
      persisted: {status: 'room', players: [{id: 'a', score: 10}]},
      restoredStatus: 'room',
      cleared: false,
    },
  ];

  for (const testCase of cases) {
    const storage = new Map<string, unknown>();
    storage.set(GAME_KEY, JSON.stringify(testCase.persisted));
    const restored = withStorage(storage, () => {
      delete requireFromHere.cache[modulePath];
      const fresh = requireFromHere('../../utils/game-store.js') as LegacyGameStore;
      return fresh.getState() as {status: string; feedText: string};
    });

    assert.equal(
      restored.status,
      testCase.restoredStatus,
      `旧模块恢复结果不符：${JSON.stringify(testCase.persisted)}`
    );
    assert.equal(storage.has(GAME_KEY), !testCase.cleared, `存储清理行为不符：${JSON.stringify(testCase.persisted)}`);
    assert.equal(
      storeTs.isValidPersistedState(testCase.persisted),
      testCase.restoredStatus !== 'idle',
      `移植版判定与旧模块不一致：${JSON.stringify(testCase.persisted)}`
    );
    if (testCase.restoredStatus !== 'idle') {
      assert.match(restored.feedText, /已恢复/);
    }
  }
});

test('复玩保留人数与显式调整人数在两个客户端一致', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(pair,
    (module) => module.createRoomFromStage({id: 1}, {roomSize: 6, random: makeRandom(21)}),
    () => storeTs.createRoomFromStage({id: 1}, {roomSize: 6, random: makeRandom(21)}), 'create 6');
  stepBoth(pair,
    (module) => module.restartGame({autoStartTimer: false, random: makeRandom(22)}),
    () => storeTs.restartGame({autoStartTimer: false, random: makeRandom(22)}), 'replay 6');
  assert.equal(storeTs.getState().players.length, 6);
  stepBoth(pair,
    (module) => module.restartGame({roomSize: 4, autoStartTimer: false, random: makeRandom(23)}),
    () => storeTs.restartGame({roomSize: 4, autoStartTimer: false, random: makeRandom(23)}), 'replay 4');
  assert.equal(storeTs.getState().players.length, 4);
});

test('建房、邀请与开局状态一致', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 5}, {roomSize: 6, random: makeRandom(11)}),
    () => storeTs.createRoomFromStage({id: 5}, {roomSize: 6, random: makeRandom(11)}),
    'createRoomFromStage'
  );
  stepBoth(
    pair,
    (module) => module.inviteHumanPlayer({random: makeRandom(12)}),
    () => storeTs.inviteHumanPlayer({random: makeRandom(12)}),
    'inviteHumanPlayer'
  );
  stepBoth(
    pair,
    (module) => module.startGame({autoStartTimer: false, random: makeRandom(13)}),
    () => storeTs.startGame({autoStartTimer: false, random: makeRandom(13)}),
    'startGame'
  );
  assert.equal(storeTs.getState().status, 'playing');
});

test('逐秒 tick 120 次，状态与结算逐次一致', () => {
  const pair = createPair();
  resetBoth(pair);
  const legacyRandom = makeRandom(2026);
  const portRandom = makeRandom(2026);

  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 2}, {roomSize: 8, random: makeRandom(1)}),
    () => storeTs.createRoomFromStage({id: 2}, {roomSize: 8, random: makeRandom(1)}),
    'createRoomFromStage'
  );
  stepBoth(
    pair,
    (module) => module.startGame({autoStartTimer: false, random: makeRandom(2)}),
    () => storeTs.startGame({autoStartTimer: false, random: makeRandom(2)}),
    'startGame'
  );

  for (let second = 0; second < 120; second += 1) {
    stepBoth(
      pair,
      (module) => module.tick({random: legacyRandom}),
      () => storeTs.tick({random: portRandom}),
      `tick #${second}`
    );
  }

  const portState = storeTs.getState();
  assert.equal(portState.status, 'finished');
  assert.equal(portState.round, 40);
  assert.equal(portState.result?.ranking.length, 8);
  assert.equal(portState.timeLeft, 0);
});

test('点选邀请、机器人同意后追上成队与退出两侧一致', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 1}, {roomSize: 6, random: makeRandom(3)}),
    () => storeTs.createRoomFromStage({id: 1}, {roomSize: 6, random: makeRandom(3)}),
    'createRoomFromStage'
  );
  const [, started] = stepBoth(
    pair,
    (module) => module.startGame({autoStartTimer: false, random: makeRandom(4)}),
    () => storeTs.startGame({autoStartTimer: false, random: makeRandom(4)}),
    'startGame'
  );

  const startedState = started as {players: {id: string; isSelf: boolean}[]; teams: {memberIds: string[]}[]};
  const selfId = startedState.players.find((player) => player.isSelf)?.id;
  assert.ok(selfId);
  const selfTeam = startedState.teams.find((team) => team.memberIds.includes(selfId));
  const mateId = startedState.players.find(
    (player) => player.id !== selfId && !(selfTeam && selfTeam.memberIds.includes(player.id))
  )?.id;
  assert.ok(mateId, '应存在一个非队友玩家');

  stepBoth(pair, (module) => module.setSelfTeam(mateId), () => storeTs.setSelfTeam(mateId), 'setSelfTeam');
  assert.equal(storeTs.getState().runWorld?.runners.find((r) => r.id === selfId)?.targetId, mateId);
  assert.equal(storeTs.getState().teams.length, 0);

  const legacyRandom = makeRandom(5);
  const portRandom = makeRandom(5);
  for (let second = 0; second < 30; second += 1) {
    stepBoth(
      pair,
      (module) => module.tick({random: legacyRandom}),
      () => storeTs.tick({random: portRandom}),
      `tick #${second}`
    );
  }

  const portState = storeTs.getState();
  assert.equal(portState.runWorld?.runners.find((r) => r.id === selfId)?.mateId, mateId);
  const lockedTeam = portState.teams.find((team) => team.memberIds.includes(selfId));
  assert.deepStrictEqual([...(lockedTeam?.memberIds ?? [])].sort(), [selfId, mateId].sort());

  stepBoth(pair, (module) => module.clearSelfTeam(), () => storeTs.clearSelfTeam(), 'clearSelfTeam');
  assert.equal(storeTs.getState().lockedPair, null);
});

test('手动加减分与准备状态两侧一致', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(6)}),
    () => storeTs.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(6)}),
    'createRoomFromStage'
  );
  stepBoth(pair, (module) => module.setSelfReady(false), () => storeTs.setSelfReady(false), 'setSelfReady(false)');
  stepBoth(pair, (module) => module.setSelfReady(true), () => storeTs.setSelfReady(true), 'setSelfReady(true)');

  const [, started] = stepBoth(
    pair,
    (module) => module.startGame({autoStartTimer: false, random: makeRandom(7)}),
    () => storeTs.startGame({autoStartTimer: false, random: makeRandom(7)}),
    'startGame'
  );
  const selfId = (started as {players: {id: string; isSelf: boolean}[]}).players.find((player) => player.isSelf)?.id;
  assert.ok(selfId);

  stepBoth(
    pair,
    (module) => module.applyPlayerScoreDelta(selfId, 60, {feedText: '领取福袋 +60', scoreType: 'fortune_bag'}),
    () => storeTs.applyPlayerScoreDelta(selfId, 60, {feedText: '领取福袋 +60', scoreType: 'fortune_bag'}),
    'applyPlayerScoreDelta'
  );
  stepBoth(
    pair,
    (module) => module.applyPlayerScoreDelta(selfId, 0),
    () => storeTs.applyPlayerScoreDelta(selfId, 0),
    'applyPlayerScoreDelta(0)'
  );
  stepBoth(
    pair,
    (module) => module.applyPlayerScoreDelta('not-exist', 10),
    () => storeTs.applyPlayerScoreDelta('not-exist', 10),
    'applyPlayerScoreDelta(unknown id)'
  );

  const breakdown = storeTs.getState().result?.scoreBreakdownMap;
  assert.equal(breakdown, undefined, '对局未结束时不应有结算');
});

test('订阅者收到的状态与返回的克隆一致', () => {
  const pair = createPair();
  const legacySeen: string[] = [];
  const portSeen: string[] = [];

  withStorage(pair.legacyStorage, () => {
    storeJs.__resetForTests();
    const unsubscribe = storeJs.subscribe((state) => {
      legacySeen.push(String((state as {status: string}).status));
    });
    storeJs.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(8)});
    storeJs.startGame({autoStartTimer: false, random: makeRandom(9)});
    unsubscribe();
    storeJs.tick({random: makeRandom(10)});
  });

  withStorage(pair.portStorage, () => {
    storeTs.__resetForTests();
    const unsubscribe = storeTs.subscribe((state) => {
      portSeen.push(state.status);
    });
    storeTs.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(8)});
    storeTs.startGame({autoStartTimer: false, random: makeRandom(9)});
    unsubscribe();
    storeTs.tick({random: makeRandom(10)});
  });

  assert.deepStrictEqual(portSeen, legacySeen);
  assert.deepStrictEqual(portSeen, ['room', 'playing']);
});

test('resetToHome 后回到初始状态，两侧一致', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(11)}),
    () => storeTs.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(11)}),
    'createRoomFromStage'
  );
  stepBoth(pair, (module) => module.resetToHome(), () => storeTs.resetToHome(), 'resetToHome');
  assert.equal(storeTs.getState().status, 'idle');
  assert.equal(pair.portStorage.has(GAME_KEY), false);
});

test('ensureRoom 在已有房间时复用', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(12)}),
    () => storeTs.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(12)}),
    'createRoomFromStage'
  );
  stepBoth(
    pair,
    (module) => module.ensureRoom({id: 7}, {roomSize: 10, random: makeRandom(13)}),
    () => storeTs.ensureRoom({id: 7}, {roomSize: 10, random: makeRandom(13)}),
    'ensureRoom'
  );
  assert.equal(storeTs.getState().stage.id, 1);
  assert.equal(storeTs.getState().players.length, 4);
});

test('对局结束后再 finishGame 不重复结算', () => {
  const pair = createPair();
  resetBoth(pair);
  stepBoth(
    pair,
    (module) => module.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(14)}),
    () => storeTs.createRoomFromStage({id: 1}, {roomSize: 4, random: makeRandom(14)}),
    'createRoomFromStage'
  );
  stepBoth(
    pair,
    (module) => module.startGame({autoStartTimer: false, random: makeRandom(15)}),
    () => storeTs.startGame({autoStartTimer: false, random: makeRandom(15)}),
    'startGame'
  );
  stepBoth(pair, (module) => module.finishGame(), () => storeTs.finishGame(), 'finishGame');
  const first = storeTs.getState().result?.resultId;
  stepBoth(pair, (module) => module.finishGame(), () => storeTs.finishGame(), 'finishGame again');
  assert.equal(storeTs.getState().result?.resultId, first);
});
