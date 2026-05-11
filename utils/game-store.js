const {
  DEFAULT_STAGE,
  GAME_DURATION_SECONDS,
  MATCH_MODE_TEXT,
  MAX_PLAYERS,
  PLAYER_STATUS_SELF_READY,
  PLAYER_STATUS_SELF_WAITING,
  ROOM_UI_LIMIT,
  ROUND_INTERVAL_SECONDS,
} = require('./constants');
const engine = require('./game-engine');
const shopStore = require('./shop-store');
const playerStats = require('./player-stats');

const GAME_STATE_KEY = 'game_codex_game_state_v1';

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
        round: state.round,
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

// Try to restore persisted state on module load
const persisted = loadPersistedState();
if (persisted && persisted.status === 'playing') {
  state = {
    ...state,
    roomId: persisted.roomId || state.roomId,
    stage: persisted.stage || state.stage,
    status: persisted.status || state.status,
    timeLeft: typeof persisted.timeLeft === 'number' ? persisted.timeLeft : state.timeLeft,
    round: typeof persisted.round === 'number' ? persisted.round : state.round,
  };
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
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    round: 0,
    players: [],
    teams: [],
    result: null,
    initialScores: {},
    scoreLog: {},
    lastEvents: [],
    feedText: `等待开局（${MATCH_MODE_TEXT}）`,
  };
}

function emit() {
  const snapshot = getState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
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
  timer = setInterval(() => {
    tick();
  }, 1000);
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

function buildAchievement(stage) {
  const achievementMap = {
    '万里长城': '长城守望者',
    '富士山': '富士远眺者',
    '巴黎铁塔': '巴黎追光者',
    '大峡谷': '峡谷远征者',
    '泰姬陵': '陵光旅人',
  };
  return achievementMap[stage.name] || `${stage.name}旅者`;
}

function buildFinishedResult(currentState) {
  const result = engine.buildResult(currentState.players);
  const scoreBreakdownMap = buildScoreBreakdownMap(currentState.scoreLog, currentState.players);
  const selfPlayer = result.ranking.find((player) => player.isSelf) || result.ranking[0];
  const initialScore = selfPlayer ? currentState.initialScores[selfPlayer.id] || 0 : 0;
  const gain = selfPlayer ? Math.max(0, selfPlayer.score - initialScore) : 0;

  return {
    ...result,
    resultId: `result-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    gain,
    coins: gain * 3,
    achievement: buildAchievement(currentState.stage),
    scoreBreakdownMap,
  };
}

function createRoomFromStage(stage = DEFAULT_STAGE, options = {}) {
  stopTimer();
  clearPersistedState();
  const roomState = engine.createRoomState(stage, options);
  state = {
    ...createEmptyState(),
    roomId: roomState.roomId,
    stage: roomState.stage,
    status: 'room',
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
  const paired = engine.pairPlayers(readyPlayers, options);
  state = {
    ...state,
    status: 'playing',
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    round: 0,
    players: paired.players,
    teams: paired.teams,
    result: null,
    initialScores: buildInitialScores(paired.players),
    scoreLog: createScoreLog(paired.players),
    lastEvents: [],
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
  stopTimer();
  const result = buildFinishedResult(state);
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
  const teammateMap = (teams || []).reduce((map, team) => {
    if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
      return map;
    }
    map[team.memberIds[0]] = team.memberIds[1];
    map[team.memberIds[1]] = team.memberIds[0];
    return map;
  }, {});

  const topEvent = events[0];
  const actor = playerMap[topEvent.actorId];
  if (!actor) {
    return '本轮结算完成';
  }

  const mateId = teammateMap[topEvent.actorId];
  const mate = mateId ? playerMap[mateId] : null;
  const delta = topEvent.delta;
  const linked = engine.getLinkedDelta(delta);
  const actorPart = `${actor.name}${delta >= 0 ? '+' : ''}${delta}`;
  if (!mate) {
    return `${actorPart}`;
  }
  const matePart = `${mate.name}${linked >= 0 ? '+' : ''}${linked}`;
  return `${actorPart}，队友联动 ${matePart}`;
}

function tick(options = {}) {
  if (state.status !== 'playing') {
    return getState();
  }

  const nextTimeLeft = Math.max(0, state.timeLeft - 1);
  let nextPlayers = state.players;
  let nextTeams = state.teams;
  let nextRound = state.round;
  let nextEvents = [];
  let nextFeedText = state.feedText;
  let nextScoreLog = ensureScoreLogPlayers(state.scoreLog, nextPlayers);

  if (nextTimeLeft > 0 && nextTimeLeft % ROUND_INTERVAL_SECONDS === 0) {
    const roundResult = engine.playRound(state.players, state.teams, options);
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
      const teammateId = teammateMap[event.actorId];
      if (!teammateId) {
        return;
      }
      const linkedDelta = engine.getLinkedDelta(event.delta);
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

  savePersistedState();
  emit();
  return getState();
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
    options.feedText || `${target ? target.name : '玩家'} 福袋投资${sign}${amount}`;

  state = {
    ...state,
    players: nextPlayers,
    scoreLog: appendScoreLogEntries(state.scoreLog, nextPlayers, [
      {
        playerId: targetId,
        type: options.scoreType || 'investment',
        delta: amount,
        round: state.round,
      },
    ]),
    lastEvents: [{actorId: targetId, delta: amount}],
    feedText,
  };
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
    roomSize: options.roomSize || ROOM_UI_LIMIT,
  });
  return startGame(options);
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
  __resetForTests,
  createRoomFromStage,
  ensureRoom,
  finishGame,
  getState,
  inviteHumanPlayer,
  resetToHome,
  restartGame,
  applyPlayerScoreDelta,
  setSelfReady,
  startGame,
  subscribe,
  tick,
};
