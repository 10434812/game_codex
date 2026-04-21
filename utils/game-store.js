const {
  DEFAULT_STAGE,
  GAME_DURATION_SECONDS,
  MAX_PLAYERS,
  ROOM_UI_LIMIT,
  ROUND_INTERVAL_SECONDS,
} = require('./constants');
const engine = require('./game-engine');

let state = createEmptyState();
const listeners = new Set();
let timer = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  return {
    roomId: '',
    stage: clone(DEFAULT_STAGE),
    status: 'idle',
    duration: GAME_DURATION_SECONDS,
    timeLeft: GAME_DURATION_SECONDS,
    round: 0,
    players: [],
    teams: [],
    result: null,
    initialScores: {},
    lastEvents: [],
    feedText: '等待开局',
  };
}

function emit() {
  const snapshot = getState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {}
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
  const selfPlayer = result.ranking.find((player) => player.isSelf) || result.ranking[0];
  const initialScore = selfPlayer ? currentState.initialScores[selfPlayer.id] || 0 : 0;
  const gain = selfPlayer ? Math.max(0, selfPlayer.score - initialScore) : 0;

  return {
    ...result,
    gain,
    coins: gain * 3,
    achievement: buildAchievement(currentState.stage),
  };
}

function createRoomFromStage(stage = DEFAULT_STAGE, options = {}) {
  stopTimer();
  const roomState = engine.createRoomState(stage, options);
  state = {
    ...createEmptyState(),
    roomId: roomState.roomId,
    stage: roomState.stage,
    status: 'room',
    players: roomState.players,
    initialScores: buildInitialScores(roomState.players),
    feedText: '房间已创建，等待开始',
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
    lastEvents: [],
    feedText: '对局开始，祝你好运',
  };

  if (options.autoStartTimer !== false) {
    startTimer();
  }

  emit();
  return getState();
}

function finishGame() {
  stopTimer();
  state = {
    ...state,
    status: 'finished',
    result: buildFinishedResult(state),
    lastEvents: [],
    feedText: '对局结束，正在结算',
  };
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

  if (nextTimeLeft > 0 && nextTimeLeft % ROUND_INTERVAL_SECONDS === 0) {
    const roundResult = engine.playRound(state.players, state.teams, options);
    nextPlayers = roundResult.players;
    nextTeams = roundResult.teams;
    nextRound += 1;
    nextEvents = roundResult.events;
    nextFeedText = buildRoundFeed(nextEvents, nextPlayers, nextTeams);
  }

  state = {
    ...state,
    timeLeft: nextTimeLeft,
    round: nextRound,
    players: nextPlayers,
    teams: nextTeams,
    lastEvents: nextEvents,
    feedText: nextFeedText,
  };

  if (state.timeLeft === 0) {
    return finishGame();
  }

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
    lastEvents: [{actorId: targetId, delta: amount}],
    feedText,
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
  state = createEmptyState();
  emit();
  return getState();
}

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
  startGame,
  subscribe,
  tick,
};
