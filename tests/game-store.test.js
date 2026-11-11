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

test('startGame 进入跑动对局，所有玩家以独立状态开局', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});

  const state = store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  assert.equal(state.status, 'playing');
  assert.equal(state.teams.length, 0);
  assert.equal(state.runWorld.runners.length, state.players.length);
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

test('finishGame 会把锦鲤币收益写入商城余额', () => {
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
  assert.equal(finished.result.achievement, '长城守望者');
  assert.equal(finished.result.achievementMedal.symbol, '城');
  assert.ok(finished.result.achievementMedal.tierLabel);
  assert.equal(afterCoins - beforeCoins, 300);
  assert.equal(afterSummary.totalIncome - beforeSummary.totalIncome, 300);
  assert.equal(afterSummary.totalExp - beforeSummary.totalExp, 100);
});

test('登录账号本地演练结算不显示或累加未经服务器确认的锦鲤币', () => {
  const api = require('../utils/api-client');
  const guest = shopStore.getStoreState();
  api.setToken('account-local-game');
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2)});
  store.startGame({random: createRandom(0.2), autoStartTimer: false});
  const self = store.getState().players.find((player) => player.isSelf);
  store.applyPlayerScoreDelta(self.id, 100, {scoreType: 'fortune_bag'});

  const finished = store.finishGame();
  assert.equal(finished.result.gain, 100);
  assert.equal(finished.result.coins, 0);
  assert.equal(finished.result.rewardNotice, '本地体验不计入账号锦鲤币');
  assert.equal(shopStore.getStoreState().coins, 0);
  assert.equal(playerStats.getSummary().totalIncome, 0);
  api.clearToken();
  assert.deepEqual(shopStore.getStoreState(), guest);
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


// ─── 持久化恢复与暂停/恢复 ────────────────────────────────

const GAME_STATE_KEY = 'game_codex_game_state_v1';

function reloadGameStore() {
  const gameStorePath = require.resolve('../utils/game-store');
  delete require.cache[gameStorePath];
  return require('../utils/game-store');
}

function writeStoredState(payload) {
  storage.set(GAME_STATE_KEY, JSON.stringify(payload));
}

test('startGame 会把可恢复的完整快照（players/teams）写入存储', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2)});
  store.startGame({random: createRandom(0.2, 0.2), autoStartTimer: false});

  const stored = JSON.parse(storage.get(GAME_STATE_KEY));
  assert.equal(stored.status, 'playing');
  assert.ok(Array.isArray(stored.players) && stored.players.length >= 4);
  assert.deepEqual(stored.teams, []);
  assert.equal(stored.runWorld.version, 1);
  assert.equal(typeof stored.timeLeft, 'number');
  assert.ok(stored.stage);
});

test('pauseGame 会停止 1s 定时器并持久化，resumeGame 重新启动定时器', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2)});
  store.startGame({random: createRandom(0.2, 0.2), autoStartTimer: true});

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let clearedCount = 0;
  let createdCount = 0;
  global.clearInterval = (id) => {
    clearedCount += 1;
    originalClearInterval(id);
  };
  global.setInterval = (fn, ms) => {
    createdCount += 1;
    return originalSetInterval(fn, ms);
  };
  try {
    const paused = store.pauseGame();
    assert.equal(paused.status, 'playing');
    assert.ok(clearedCount >= 1, 'pauseGame 应清除 1s 定时器');
    assert.equal(typeof paused.timeLeft, 'number');
    // 存储里应包含最新快照
    const stored = JSON.parse(storage.get(GAME_STATE_KEY));
    assert.equal(stored.status, 'playing');
    assert.ok(stored.players.length >= 4);

    const before = createdCount;
    const resumed = store.resumeGame();
    assert.equal(resumed.status, 'playing');
    assert.equal(createdCount, before + 1, 'resumeGame 应重新创建 1s 定时器');
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
    store.pauseGame();
  }
});

test('pauseGame 在非 playing 状态下是 no-op', () => {
  const idle = store.pauseGame();
  assert.equal(idle.status, 'idle');
  const resumed = store.resumeGame();
  assert.equal(resumed.status, 'idle');
});

test('模块加载时恢复合法 playing 快照（含 players/teams），且不自动启动计时', () => {
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2)});
  store.startGame({random: createRandom(0.2, 0.2), autoStartTimer: false});
  store.tick({random: createRandom(0.2)});
  store.pauseGame(); // 确保存储里有最新快照

  const restored = reloadGameStore();
  const snapshot = restored.getState();
  assert.equal(snapshot.status, 'playing');
  assert.ok(Array.isArray(snapshot.players) && snapshot.players.length >= 4);
  assert.deepEqual(snapshot.teams, []);
  assert.equal(snapshot.runWorld.elapsedMs, 1000);
  assert.equal(snapshot.timeLeft, 119);
  assert.equal(snapshot.round, 0);
  // scoreLog/initialScores 已按 players 重建
  assert.ok(snapshot.scoreLog[snapshot.players[0].id]);
  assert.equal(typeof snapshot.initialScores[snapshot.players[0].id], 'number');

  // 恢复后不会自动计时：tick 由调用方驱动，resumeGame 才重新启动定时器
  const afterTick = restored.tick({random: createRandom(0.2)});
  assert.equal(afterTick.timeLeft, 118);
  restored.resumeGame();
  const afterResume = restored.tick({random: createRandom(0.2)});
  assert.equal(afterResume.timeLeft, 117);
});

test('模块加载时恢复合法 room 快照', () => {
  // 手工构造 room 快照
  writeStoredState({
    roomId: 'room-9',
    stage: {id: 2, code: '02', name: '富士山'},
    status: 'room',
    players: [{id: 'p1', name: '测试', score: 100, isSelf: true}],
    teams: [],
  });

  const restored = reloadGameStore();
  const snapshot = restored.getState();
  assert.equal(snapshot.status, 'room');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].id, 'p1');
  const ensured = restored.ensureRoom();
  assert.equal(ensured.status, 'room');
});

test('模块加载时恢复出缺 players 的 playing 中间态 → 重置为 idle 并清理存储', () => {
  writeStoredState({status: 'playing', roomId: 'r1', timeLeft: 120, round: 5});

  const restored = reloadGameStore();
  assert.equal(restored.getState().status, 'idle');
  assert.equal(storage.has(GAME_STATE_KEY), false);
});

test('模块加载时恢复出 players 为空的 playing 态 → 重置为 idle 并清理存储', () => {
  writeStoredState({status: 'playing', players: [], teams: [], timeLeft: 120, round: 5});

  const restored = reloadGameStore();
  assert.equal(restored.getState().status, 'idle');
  assert.equal(storage.has(GAME_STATE_KEY), false);
});

test('模块加载时恢复出 timeLeft<=0 的 playing 态 → 重置为 idle 并清理存储', () => {
  writeStoredState({
    status: 'playing',
    players: [{id: 'p1', name: 'a', score: 1}],
    teams: [],
    timeLeft: 0,
    round: 5,
  });

  const restored = reloadGameStore();
  assert.equal(restored.getState().status, 'idle');
  assert.equal(storage.has(GAME_STATE_KEY), false);
});

test('模块加载时恢复出未知状态 → 重置为 idle 并清理存储', () => {
  writeStoredState({status: 'finished', players: [{id: 'p1', name: 'a', score: 1}], timeLeft: 0});

  const restored = reloadGameStore();
  assert.equal(restored.getState().status, 'idle');
  assert.equal(storage.has(GAME_STATE_KEY), false);
});

test('setSelfTeam 发出邀请，退出后清除意图并持续独立', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  const players = store.getState().players;
  const self = players.find((player) => player.isSelf);
  const target = players[1];

  const locked = store.setSelfTeam(target.id);
  assert.equal(locked.runWorld.runners.find((r) => r.id === self.id).targetId, target.id);
  assert.equal(locked.teams.length, 0);

  const cleared = store.clearSelfTeam();
  assert.equal(cleared.lockedPair, null);
  assert.equal(cleared.players.find((player) => player.isSelf).independent, true);
  for (let second = 0; second < 15; second++) store.tick({random: () => 0.2});
  assert.equal(store.getState().teams.some((item) => item.memberIds.includes(self.id)), false);
  const persisted = JSON.parse(storage.get('game_codex_game_state_v1'));
  assert.equal(persisted.players.find((player) => player.isSelf).independent, true);
  const teamed = store.setSelfTeam(target.id);
  assert.equal(teamed.players.find((player) => player.isSelf).independent, true);
  assert.equal(teamed.runWorld.runners.find((r) => r.id === self.id).targetId, target.id);
});

test('120 秒对局在第 3 秒首次结算，并在第 120 秒结束', () => {
  store.startGame({autoStartTimer: false, random: () => 0.2});
  assert.equal(store.getState().duration, 120);
  const self = store.getState().players.find((player) => player.isSelf);
  assert.equal(self.independent, true);
  assert.equal(self.teamId, null);
  for (let second = 1; second <= 120; second++) {
    const state = store.tick({random: () => 0.2});
    assert.equal(state.timeLeft, 120 - second);
    assert.equal(state.round, Math.floor(second / 3));
    assert.equal(state.status, second === 120 ? 'finished' : 'playing');
  }
});

test('setSelfTeam 拒绝不存在的玩家和自己', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  const self = store.getState().players.find((player) => player.isSelf);

  assert.equal(store.setSelfTeam('ghost-player').lockedPair, null);
  assert.equal(store.setSelfTeam(self.id).lockedPair, null);
  assert.equal(store.setSelfTeam('').lockedPair, null);
});

test('tick 会带上锁定队伍，整局不被拆散', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  const players = store.getState().players;
  const self = players.find((player) => player.isSelf);
  const target = players[1];
  store.setSelfTeam(target.id);

  for (let second = 0; second < 5 && !store.getState().teams.some((t) => t.memberIds.includes(self.id)); second++) store.tick({random: createRandom(0)});
  assert.ok(store.getState().teams.some((t) => t.memberIds.includes(self.id) && t.memberIds.includes(target.id)));
  for (let index = 0; index < 60; index += 1) {
    const state = store.tick({random: createRandom(0)});
    if (state.status !== 'playing') {
      break;
    }
    const team = state.teams.find((item) => item.memberIds.includes(self.id));
    assert.ok(team.memberIds.includes(target.id));
  }
});

test('finishGame 不执行福袋持仓随机平仓', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  const finished = store.finishGame();

  assert.equal(finished.result.autoSettledPosition, undefined);
  assert.equal('activePosition' in finished, false);
});

test('buildRoundFeed 会播报本回合全部事件，不再只留第一条', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  const saved = JSON.parse(storage.get(GAME_STATE_KEY));
  saved.players = saved.players.map((p) => ({...p, isRobot: false}));
  saved.runWorld.drops = saved.runWorld.runners.slice(0, 2).map((r, i) => ({
    id: `feed-${i}`, kind: 'bag', value: 10, x: r.x, y: r.y, speed: 1, warningUntil: 0,
  }));
  storage.set(GAME_STATE_KEY, JSON.stringify(saved));
  const restored = reloadGameStore();
  const state = restored.advanceRunFrame(20, {random: createRandom(0.2)});
  assert.equal(state.lastEvents.length, 2);
  assert.ok(state.feedText.includes(' · '), `多事件回合播报：${state.feedText}`);
});

test('联动值由引擎挂在事件上，积分明细与实际加分一致', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});

  for (let index = 0; index < 200; index += 1) {
    const state = store.tick();
    if (state.status !== 'playing') {
      break;
    }
    (state.lastEvents || []).forEach((event) => {
      if (!event.teammateId) {
        return;
      }
      const entries = state.scoreLog[event.teammateId] || [];
      const latest = entries[entries.length - 1];
      assert.equal(typeof event.linkedDelta, 'number');
      if (latest && latest.type === 'team_bonus' && latest.round === state.round) {
        assert.equal(latest.delta, event.linkedDelta);
      }
    });
  }
});

test('重复本地结算不会再次发放游客奖励', () => {
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  const first = store.finishGame();
  const assets = shopStore.getStoreState();
  const summary = playerStats.getSummary();
  const second = store.finishGame();
  assert.deepEqual(second.result, first.result);
  assert.deepEqual(shopStore.getStoreState(), assets);
  assert.deepEqual(playerStats.getSummary(), summary);
});

test('游客对局中登录账号后本地奖励不能计入账号或原游客库存', () => {
  const api = require('../utils/api-client');
  const guest = shopStore.getStoreState();
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  api.setToken('account-mid-game');
  const finished = store.finishGame();
  assert.equal(finished.result.coins, 0);
  assert.equal(shopStore.getStoreState().coins, 0);
  api.clearToken();
  assert.deepEqual(shopStore.getStoreState(), guest);
});

test('账号发起的本地对局即使登录过期也不生成游客资产奖励', () => {
  const api = require('../utils/api-client');
  const guest = shopStore.getStoreState();
  api.setToken('expired-local-game');
  store.startGame({autoStartTimer: false, random: createRandom(0.2)});
  api.clearToken();
  const finished = store.finishGame();
  assert.equal(finished.result.coins, 0);
  assert.deepEqual(shopStore.getStoreState(), guest);
});
