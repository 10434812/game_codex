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

const store = require('../utils/game-store');
const shopStore = require('../utils/shop-store');
const playerStats = require('../utils/player-stats');

function createRandom(...values) {
  let index = 0;
  return () => {
    const value = values[index];
    index = Math.min(index + 1, values.length - 1);
    return value;
  };
}

test.beforeEach(() => {
  storage.clear();
  shopStore.__resetForTests();
  playerStats.__resetForTests();
  store.__resetForTests();
});

test('startGame 会把房间状态切到 playing 并生成队伍', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});

  const state = store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  assert.equal(state.status, 'playing');
  assert.ok(state.teams.length >= 2);
  assert.equal(state.players.length >= 4, true);
});

test('tick 会在时间归零后产出 finished 结果', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  for (let index = 0; index < 180; index += 1) {
    store.tick({random: createRandom(0.2, 0.2, 0.2, 0.2)});
  }

  const state = store.getState();
  assert.equal(state.status, 'finished');
  assert.ok(state.result.top3.first);
  assert.ok(state.result.rest.length >= 1);
});

test('inviteHumanPlayer 会在房间阶段添加真人玩家', () => {
  const first = store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  const next = store.inviteHumanPlayer({random: createRandom(0.1, 0.1, 0.1)});

  assert.equal(next.players.length, first.players.length + 1);
  const joined = next.players[next.players.length - 1];
  assert.equal(joined.isRobot, false);
  assert.equal(joined.isSelf, false);
});

test('finishGame 会把金币收益写入商城余额', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  const self = store.getState().players.find((player) => player.isSelf);
  const beforeCoins = shopStore.getStoreState().coins;
  const beforeSummary = playerStats.getSummary();
  store.applyPlayerScoreDelta(self.id, 100, {scoreType: 'investment'});
  const finished = store.finishGame();
  const afterCoins = shopStore.getStoreState().coins;
  const afterSummary = playerStats.getSummary();

  assert.equal(finished.result.gain, 100);
  assert.equal(finished.result.coins, 300);
  assert.equal(afterCoins - beforeCoins, 300);
  assert.equal(afterSummary.totalIncome - beforeSummary.totalIncome, 300);
  assert.equal(afterSummary.totalExp - beforeSummary.totalExp, 100);
});

test('finishGame 会聚合真实 scoreLog 到结算明细', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  const self = store.getState().players.find((player) => player.isSelf);
  store.applyPlayerScoreDelta(self.id, -50, {scoreType: 'investment'});
  store.applyPlayerScoreDelta(self.id, 80, {scoreType: 'investment'});
  const finished = store.finishGame();
  const breakdown = finished.result.scoreBreakdownMap[self.id];

  assert.equal(typeof finished.result.resultId, 'string');
  assert.equal(breakdown.investment, 30);
  assert.equal(breakdown.total, breakdown.round + breakdown.teamBonus + breakdown.investment + breakdown.fortuneBag);
});
