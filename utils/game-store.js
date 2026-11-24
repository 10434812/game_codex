const {
  DEFAULT_STAGE,
  GAME_DURATION_SECONDS,
  MATCH_MODE_TEXT,
  MAX_PLAYERS,
  PLAYER_STATUS_SELF_READY,
  PLAYER_STATUS_SELF_WAITING,
  ROUND_INTERVAL_SECONDS,
} = require('./constants');
const engine = require('./game-engine');
const runArena = require('./run-arena');
const shopStore = require('./shop-store');
const playerStats = require('./player-stats');
const {buildAchievement, buildAchievementMedal} = require('./achievement-medals');
const {getCachedProfile} = require('./user-profile');

const GAME_STATE_KEY = 'game_codex_game_state_v1';
// 持久化节流：对局 tick 期间每 5s 写一次存储（关键节点：开局/暂停/结算 立即写）
const PERSIST_INTERVAL_SECONDS = 5;

let state = createEmptyState();
const listeners = new Set();
let timer = null;

function loadPersistedState() {
  try {
    if (typeof wx !== 'undefined' && wx.getStorageSync) {
      const stored = wx.getStorageSync(GAME_STATE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    }
  } catch (error) {
    console.warn('[game-store] loadPersistedState error:', error);
  }
  return null;
}

function savePersistedState() {
  try {
    if (typeof wx !== 'undefined' && wx.setStorageSync) {
      const payload = {
        roomId: state.roomId,
        stage: state.stage,
        status: state.status,
        timeLeft: state.timeLeft,
        duration: state.duration,
        round: state.round,
        players: state.players,
        teams: state.teams,
        lockedPair: state.lockedPair,
        runWorld: state.runWorld,
        initialScores: state.initialScores,
        scoreLog: state.scoreLog,
        guestAssets: state.guestAssets,
      };
      wx.setStorageSync(GAME_STATE_KEY, JSON.stringify(payload));
    }
  } catch (error) {
    console.warn('[game-store] savePersistedState error:', error);
  }
}

function clearPersistedState() {
  try {
    if (typeof wx !== 'undefined' && wx.removeStorageSync) {
      wx.removeStorageSync(GAME_STATE_KEY);
    }
  } catch (error) {
    console.warn('[game-store] clearPersistedState error:', error);
  }
}

// 恢复完整性校验：只接受可继续游玩的有效中间态（room/playing + 非空 players）
// 任何无效/残缺中间态一律重置为初始状态并清理存储，避免出现"playing 但 0 玩家"的僵尸对局
function isValidPersistedState(persisted) {
  if (!persisted || typeof persisted !== 'object') {
    return false;
  }
  const status = persisted.status;
  if (status === 'playing') {
    return (
      Array.isArray(persisted.players) &&
      persisted.players.length > 0 &&
      Array.isArray(persisted.teams) &&
      typeof persisted.timeLeft === 'number' &&
      persisted.timeLeft > 0
    );
  }
  if (status === 'room') {
    return Array.isArray(persisted.players) && persisted.players.length > 0;
  }
  return false;
}

// Try to restore persisted state on module load
const persisted = loadPersistedState();
if (isValidPersistedState(persisted)) {
  state = {
    ...state,
    roomId: persisted.roomId || state.roomId,
    stage: persisted.stage || state.stage,
    status: persisted.status,
    timeLeft: typeof persisted.timeLeft === 'number' ? persisted.timeLeft : state.timeLeft,
    // 旧版进行中存档来自 180 秒对局；新对局会保存明确时长。
    duration: Number(persisted.duration) || (persisted.status === 'playing' ? 180 : GAME_DURATION_SECONDS),
    round: typeof persisted.round === 'number' ? persisted.round : state.round,
    players: persisted.players,
    teams: persisted.teams || [],
    lockedPair: Array.isArray(persisted.lockedPair) ? persisted.lockedPair : null,
    runWorld: persisted.status === 'playing' ? runArena.restoreRunWorld(persisted.runWorld, persisted.players, persisted.teams || [], ((Number(persisted.duration) || 180) - persisted.timeLeft) * 1000) : null,
    guestAssets: persisted.guestAssets !== false,
    initialScores: persisted.initialScores || buildInitialScores(persisted.players),
    scoreLog: persisted.scoreLog || createScoreLog(persisted.players),
    feedText: persisted.status === 'playing'
      ? `对局已恢复（${MATCH_MODE_TEXT}），剩余 ${persisted.timeLeft}s`
      : `房间已恢复（${MATCH_MODE_TEXT}）`,
  };
} else if (persisted) {
  // 无效/残缺中间态：清掉并回到初始状态
  clearPersistedState();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  return {
    roomId: '',
    stage: clone(DEFAULT_STAGE),
    modeText: MATCH_MODE_TEXT,
    status: 'idle',
    guestAssets: false,
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    round: 0,
    players: [],
    teams: [],
    result: null,
    initialScores: {},
    scoreLog: {},
    lastEvents: [],
    // 玩家手动组队锁定的 [selfId, mateId]。为空时队伍按引擎默认规则每回合随机重排。
    lockedPair: null,
    runWorld: null,
    feedText: `等待开局（${MATCH_MODE_TEXT}）`,
  };
}

function emit() {
  // state 每次更新都是整体替换（不可变更新），直接传引用即可；
  // 监听方按需自行拷贝，避免每 tick 一次全状态 JSON 深拷贝（局末可达 78KB）
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) { console.warn('[game-store] emit listener error:', error); }
  });
}

function stopTimer() {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
}

function startTimer() {
  if (timer) {
    return;
  }
  let previousFrameAt = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const elapsed = Math.max(0, now - previousFrameAt);
    previousFrameAt = now;
    if (state.runWorld) advanceRunFrame(elapsed);
    else tick();
  }, state.runWorld ? 16 : 1000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

function getState() {
  return clone(state);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function buildInitialScores(players) {
  return players.reduce((scores, player) => {
    scores[player.id] = player.score;
    return scores;
  }, {});
}

function createScoreLog(players) {
  return (players || []).reduce((map, player) => {
    map[player.id] = [];
    return map;
  }, {});
}

function ensureScoreLogPlayers(baseLog, players) {
  const next = {...(baseLog || {})};
  (players || []).forEach((player) => {
    if (!next[player.id]) {
      next[player.id] = [];
    }
  });
  return next;
}

function appendScoreLogEntries(baseLog, players, entries = []) {
  const next = ensureScoreLogPlayers(baseLog, players);
  const timestamp = Date.now();
  entries.forEach((entry) => {
    if (!entry || !entry.playerId || !next[entry.playerId] || typeof entry.delta !== 'number') {
      return;
    }
    next[entry.playerId] = [
      ...next[entry.playerId],
      {
        type: entry.type || 'round',
        delta: entry.delta,
        round: Number(entry.round) || 0,
        timestamp,
      },
    ];
  });
  return next;
}

function buildTeammateMap(teams) {
  return (teams || []).reduce((map, team) => {
    if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
      return map;
    }
    map[team.memberIds[0]] = team.memberIds[1];
    map[team.memberIds[1]] = team.memberIds[0];
    return map;
  }, {});
}

function buildScoreBreakdownMap(scoreLog, players) {
  const ids = (players || []).map((player) => player.id);
  return ids.reduce((map, playerId) => {
    const entries = Array.isArray(scoreLog && scoreLog[playerId]) ? scoreLog[playerId] : [];
    const breakdown = {
      round: 0,
      teamBonus: 0,
      investment: 0,
      fortuneBag: 0,
      total: 0,
    };
    entries.forEach((entry) => {
      const delta = Number(entry.delta) || 0;
      if (entry.type === 'team_bonus') {
        breakdown.teamBonus += delta;
      } else if (entry.type === 'investment') {
        breakdown.investment += delta;
      } else if (entry.type === 'fortune_bag') {
        breakdown.fortuneBag += delta;
      } else {
        breakdown.round += delta;
      }
    });
    breakdown.total = breakdown.round + breakdown.teamBonus + breakdown.investment + breakdown.fortuneBag;
    map[playerId] = breakdown;
    return map;
  }, {});
}

function buildFinishedResult(currentState) {
  const result = engine.buildResult(currentState.players);
  const scoreBreakdownMap = buildScoreBreakdownMap(currentState.scoreLog, currentState.players);
  const selfPlayer = result.ranking.find((player) => player.isSelf) || result.ranking[0];
  const initialScore = selfPlayer ? currentState.initialScores[selfPlayer.id] || 0 : 0;
  const gain = selfPlayer ? Math.max(0, selfPlayer.score - initialScore) : 0;
  const achievement = buildAchievement(currentState.stage);
  const selfRank = selfPlayer ? selfPlayer.rank : 0;

  return {
    ...result,
    resultId: `result-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    gain,
    coins: gain * 3,
    achievement,
    achievementMedal: buildAchievementMedal({
      stage: currentState.stage,
      achievement,
      gain,
      rank: selfRank,
    }),
    scoreBreakdownMap,
    performanceMap: runArena.runPerformanceMap(currentState.runWorld),
  };
}

function createRoomFromStage(stage = DEFAULT_STAGE, options = {}) {
  stopTimer();
  clearPersistedState();
  const cachedProfile = getCachedProfile();
  const mergedOptions = {
    ...options,
    selfAvatar: options.selfAvatar || cachedProfile.avatarUrl || '',
    selfName: options.selfName || (cachedProfile.nickName && cachedProfile.nickName !== '微信用户' ? cachedProfile.nickName : ''),
  };
  const roomState = engine.createRoomState(stage, mergedOptions);
  state = {
    ...createEmptyState(),
    roomId: roomState.roomId,
    stage: roomState.stage,
    status: 'room',
    guestAssets: shopStore.getStoreState().assetSource !== 'server',
    players: roomState.players,
    initialScores: buildInitialScores(roomState.players),
    scoreLog: createScoreLog(roomState.players),
    feedText: `房间已创建，等待开始（${MATCH_MODE_TEXT}）`,
  };
  emit();
  return getState();
}

function ensureRoom(stage = DEFAULT_STAGE, options = {}) {
  if (state.status === 'room' || state.status === 'playing') {
    return getState();
  }

  return createRoomFromStage(stage, options);
}

function inviteHumanPlayer(options = {}) {
  if (state.status !== 'room') {
    return getState();
  }

  if (state.players.length >= MAX_PLAYERS) {
    return getState();
  }

  const invitedPlayers = engine.addInvitedHuman(state.players, options);
  if (invitedPlayers.length === state.players.length) {
    return getState();
  }

  const newPlayer = invitedPlayers[invitedPlayers.length - 1];
  state = {
    ...state,
    players: invitedPlayers,
    initialScores: buildInitialScores(invitedPlayers),
    feedText: `${newPlayer.name} 已加入房间`,
  };
  emit();
  return getState();
}

function startGame(options = {}) {
  if (state.status === 'idle' || state.status === 'finished') {
    createRoomFromStage(state.stage || DEFAULT_STAGE, options);
  }

  stopTimer();
  const readyPlayers = engine.ensureMinimumPlayers(state.players, options);
  const paired = {players: readyPlayers.map((player) => ({...player, independent: true, teamId: null})), teams: []};
  state = {
    ...state,
    status: 'playing',
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    guestAssets: state.guestAssets && shopStore.getStoreState().assetSource !== 'server',
    round: 0,
    players: paired.players,
    teams: paired.teams,
    runWorld: runArena.createRunWorld(paired.players),
    result: null,
    initialScores: buildInitialScores(paired.players),
    scoreLog: createScoreLog(paired.players),
    lastEvents: [],
    lockedPair: null,
    feedText: `对局开始（${MATCH_MODE_TEXT}），祝你好运`,
  };

  if (options.autoStartTimer !== false) {
    startTimer();
  }

  savePersistedState();
  emit();
  return getState();
}


function finishGame() {
  if (state.status === 'finished') return getState();
  stopTimer();
  const result = buildFinishedResult(state);
  if (!state.guestAssets || shopStore.getStoreState().assetSource === 'server') {
    // 本地演练没有服务器结算凭证，不能展示为账号锦鲤币入账。
    result.coins = 0;
    result.rewardNotice = '本地体验不计入账号锦鲤币';
  }
  if (result.coins > 0) {
    shopStore.addCoins(result.coins, {
      type: 'game_reward',
      title: `对局结算·${state.stage && state.stage.name ? state.stage.name : '未知场景'}`,
    });
  }
  playerStats.recordSettlement({
    resultId: result.resultId,
    stageName: state.stage && state.stage.name ? state.stage.name : '',
    achievement: result.achievement,
    income: result.coins,
    exp: result.gain,
    modeText: state.modeText || MATCH_MODE_TEXT,
    createdAt: Date.now(),
  });
  state = {
    ...state,
    status: 'finished',
    result,
    lastEvents: [],
    lockedPair: null,
    feedText: '对局结束，正在结算',
  };
  clearPersistedState();
  emit();
  return getState();
}

function findPlayerMap(players) {
  return (players || []).reduce((map, player) => {
    map[player.id] = player;
    return map;
  }, {});
}

function buildRoundFeed(events, players, teams) {
  if (!events || !events.length) {
    return '等待下一轮事件';
  }

  const playerMap = findPlayerMap(players);
  const teammateMap = buildTeammateMap(teams);

  // 一回合最多 3 个事件。旧写法只播报 events[0]，另外两条直接丢掉，
  // 玩家看到分数在动却找不到对应的播报。自己参与的事件优先排前面。
  const lines = events
    .map((event) => {
      const actor = playerMap[event.actorId];
      if (!actor || typeof event.delta !== 'number') {
        return null;
      }
      const mateId = event.teammateId || teammateMap[event.actorId];
      const mate = mateId ? playerMap[mateId] : null;
      const linked = typeof event.linkedDelta === 'number'
        ? event.linkedDelta
        : engine.getLinkedDelta(event.delta);
      const actorPart = `${actor.name}${event.delta >= 0 ? '+' : ''}${event.delta}`;
      const text = mate && linked
        ? `${actorPart}（${mate.name}${linked >= 0 ? '+' : ''}${linked}）`
        : actorPart;
      return {
        text,
        involvesSelf: !!actor.isSelf || !!(mate && mate.isSelf),
      };
    })
    .filter(Boolean);

  if (!lines.length) {
    return '本轮结算完成';
  }

  return lines
    .sort((a, b) => Number(b.involvesSelf) - Number(a.involvesSelf))
    .map((line) => line.text)
    .join(' · ');
}

function tick(options = {}) {
  if (state.runWorld) return advanceRunFrame(1000, options);
  if (state.status !== 'playing') {
    return state;
  }

  const nextTimeLeft = Math.max(0, state.timeLeft - 1);
  let nextPlayers = state.players;
  let nextTeams = state.teams;
  let nextRound = state.round;
  let nextEvents = [];
  let nextFeedText = state.feedText;
  let nextScoreLog = ensureScoreLogPlayers(state.scoreLog, nextPlayers);

  if (nextTimeLeft > 0 && (state.duration - nextTimeLeft) % ROUND_INTERVAL_SECONDS === 0) {
    // tick 由 setInterval 无参调用，锁定队伍要在这里从 state 注入，否则引擎每回合照样重排
    const roundOptions = state.lockedPair
      ? {...options, lockedPair: state.lockedPair}
      : options;
    const roundResult = engine.playRound(state.players, state.teams, roundOptions);
    nextPlayers = roundResult.players;
    nextTeams = roundResult.teams;
    nextRound += 1;
    nextEvents = roundResult.events;
    const teammateMap = buildTeammateMap(nextTeams);
    const scoreEntries = [];
    nextEvents.forEach((event) => {
      if (!event || !event.actorId || typeof event.delta !== 'number') {
        return;
      }
      scoreEntries.push({
        playerId: event.actorId,
        type: 'round',
        delta: event.delta,
        round: nextRound,
      });
      const teammateId = event.teammateId || teammateMap[event.actorId];
      if (!teammateId) {
        return;
      }
      // 引擎已经把联动值算好挂在事件上，这里直接用，保证明细和实际加分一致
      const linkedDelta = typeof event.linkedDelta === 'number'
        ? event.linkedDelta
        : engine.getLinkedDelta(event.delta);
      if (!linkedDelta) {
        return;
      }
      scoreEntries.push({
        playerId: teammateId,
        type: 'team_bonus',
        delta: linkedDelta,
        round: nextRound,
      });
    });
    nextScoreLog = appendScoreLogEntries(nextScoreLog, nextPlayers, scoreEntries);
    nextFeedText = buildRoundFeed(nextEvents, nextPlayers, nextTeams);
  }

  state = {
    ...state,
    timeLeft: nextTimeLeft,
    round: nextRound,
    players: nextPlayers,
    teams: nextTeams,
    scoreLog: nextScoreLog,
    lastEvents: nextEvents,
    feedText: nextFeedText,
  };

  if (state.timeLeft === 0) {
    return finishGame();
  }

  // 持久化节流：tick 每秒 1 次 → 每 5s 写一次（开局/暂停/结算等关键节点单独写）
  if (nextTimeLeft % PERSIST_INTERVAL_SECONDS === 0) {
    savePersistedState();
  }
  emit();
  return state;
}

function applyPlayerScoreDelta(playerId, delta, options = {}) {
  if (state.status !== 'playing') {
    return getState();
  }

  const amount = Math.floor(Number(delta) || 0);
  if (!amount) {
    return getState();
  }

  const fallbackPlayer = state.players.find((player) => player.isSelf) || state.players[0];
  const targetId = playerId || (fallbackPlayer ? fallbackPlayer.id : '');
  if (!targetId) {
    return getState();
  }

  let found = false;
  const nextPlayers = state.players.map((player) => {
    if (player.id !== targetId) {
      return player;
    }
    found = true;
    return {
      ...player,
      score: Math.max(0, Number(player.score || 0) + amount),
    };
  });

  if (!found) {
    return getState();
  }

  const target = nextPlayers.find((player) => player.id === targetId);
  const sign = amount >= 0 ? '+' : '';
  const feedText =
    options.feedText || `${target ? target.name : '玩家'} 积分${sign}${amount}`;

  state = {
    ...state,
    players: nextPlayers,
    scoreLog: appendScoreLogEntries(state.scoreLog, nextPlayers, [
      {
        playerId: targetId,
        type: options.scoreType || 'game_reward',
        delta: amount,
        round: state.round,
      },
    ]),
    lastEvents: [{actorId: targetId, delta: amount}],
    feedText,
  };
  savePersistedState();
  emit();
  return getState();
}

/**
 * 玩家手动组队：把 [自己, 队友] 锁进 state，并立刻按这个约束重排队伍。
 * 之后每回合 tick 都会带上 lockedPair，引擎的随机重排不会再拆散这一对。
 */
function setSelfTeam(mateId) {
  if (state.runWorld && state.status === 'playing') {
    const self = state.players.find((p) => p.isSelf);
    if (self) runArena.selectRunTarget(state.runWorld, self.id, mateId);
    emit(); return getState();
  }
  if (state.status !== 'playing' || !mateId) {
    return getState();
  }
  const selfPlayer = state.players.find((player) => player.isSelf);
  if (!selfPlayer || selfPlayer.id === mateId) {
    return getState();
  }
  const mate = state.players.find((player) => player.id === mateId);
  if (!mate) {
    return getState();
  }

  const lockedPair = [selfPlayer.id, mateId];
  const players = state.players.map((player) => lockedPair.includes(player.id) ? {...player, independent: false} : player);
  const paired = engine.pairPlayers(players, {lockedPair});
  state = {
    ...state,
    lockedPair,
    players: paired.players,
    teams: paired.teams,
    feedText: `已与 ${mate.name} 组队，本局锁定联动`,
  };
  savePersistedState();
  emit();
  return getState();
}

/** 退出队伍后保持独立，直到玩家再次主动组队。 */
function clearSelfTeam() {
  if (state.runWorld && state.status === 'playing') {
    const self = state.players.find((p) => p.isSelf);
    if (self) runArena.selectRunTarget(state.runWorld, self.id, null);
    const next = runArena.advanceRunArena(state.runWorld, state.players, 0);
    state = {...state, runWorld: next.world, players: next.players, teams: next.teams};
    savePersistedState(); emit(); return getState();
  }
  if (state.status !== 'playing') {
    return getState();
  }
  const players = state.players.map((player) => player.isSelf ? {...player, independent: true} : player);
  const paired = engine.pairPlayers(players, {});
  state = {
    ...state,
    lockedPair: null,
    players: paired.players,
    teams: paired.teams,
    feedText: '已保持独立，按个人积分结算',
  };
  savePersistedState();
  emit();
  return getState();
}

function setSelfReady(ready) {
  if (state.status !== 'room') {
    return getState();
  }
  const nextReady = ready !== false;
  const nextPlayers = state.players.map((player) => {
    if (!player.isSelf) {
      return player;
    }
    return {
      ...player,
      ready: nextReady,
      state: nextReady ? PLAYER_STATUS_SELF_READY : PLAYER_STATUS_SELF_WAITING,
    };
  });
  state = {
    ...state,
    players: nextPlayers,
    feedText: nextReady ? '已准备，等待开局' : '已取消准备',
  };
  emit();
  return getState();
}

function restartGame(options = {}) {
  const stage = state.stage || DEFAULT_STAGE;
  createRoomFromStage(stage, {
    ...options,
    roomSize: options.roomSize || state.players.length || undefined,
  });
  return startGame(options);
}

/**
 * 暂停对局：停止 1s tick 定时器并持久化当前快照。
 * 离开对局页（onHide/onUnload/切后台）时调用，防止幽灵对局在后台跑完并静默结算。
 */
function pauseGame() {
  if (state.runWorld) state.runWorld.runners.forEach((r) => runArena.setRunInput(state.runWorld, r.id, 0, 0));
  if (state.status !== 'playing') {
    return getState();
  }
  stopTimer();
  savePersistedState();
  return getState();
}

/**
 * 恢复对局：重新启动 1s tick 定时器（仅 playing 态）。
 * 回到对局页（onShow）时调用；持久化恢复的 playing 态同样通过它恢复计时。
 */
function resumeGame() {
  if (state.status !== 'playing' || timer) {
    return getState();
  }
  startTimer();
  return getState();
}

function resetToHome() {
  stopTimer();
  clearPersistedState();
  state = createEmptyState();
  emit();
  return getState();
}

/** @private Testing only - do not use in production */
function __resetForTests() {
  stopTimer();
  listeners.clear();
  state = createEmptyState();
}

module.exports = {
  advanceRunFrame,
  setRunDirection,
  __resetForTests,
  createRoomFromStage,
  ensureRoom,
  finishGame,
  getState,
  inviteHumanPlayer,
  pauseGame,
  resetToHome,
  restartGame,
  resumeGame,
  applyPlayerScoreDelta,
  clearSelfTeam,
  setSelfReady,
  setSelfTeam,
  startGame,
  subscribe,
  tick,
};

function setRunDirection(dx, dy) {
  if (state.status !== 'playing' || !state.runWorld) return;
  const self = state.players.find((p) => p.isSelf);
  if (self) runArena.setRunInput(state.runWorld, self.id, dx, dy);
}

function advanceRunFrame(deltaMs, options = {}) {
  if (state.status !== 'playing' || !state.runWorld) return state;
  const before = state.timeLeft;
  const next = runArena.advanceRunArena(state.runWorld, state.players, Math.min(deltaMs, state.duration * 1000 - state.runWorld.elapsedMs), options.random);
  const timeLeft = Math.max(0, state.duration - Math.floor(next.world.elapsedMs / 1000));
  const entries = next.events.filter((e) => e.type === 'pickup').flatMap((e) => [
    {playerId: e.actorId, delta: e.delta, type: e.kind === 'bag' ? 'fortune_bag' : 'round', round: state.round},
    ...(e.teammateId ? [{playerId: e.teammateId, delta: e.linkedDelta, type: 'team_bonus', round: state.round}] : []),
  ]);
  state = {...state, players: next.players, teams: next.teams, runWorld: next.world, timeLeft,
    round: Math.floor(next.world.elapsedMs / 3000), lastEvents: next.events,
    scoreLog: appendScoreLogEntries(state.scoreLog, next.players, entries),
    feedText: next.events.length ? buildRoundFeed(next.events.filter((e) => e.type === 'pickup'), next.players, next.teams) : state.feedText};
  if (timeLeft === 0) return finishGame();
  if (before !== timeLeft && timeLeft % 5 === 0) savePersistedState();
  emit(); return state;
}
