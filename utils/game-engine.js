const {
  AVATAR_POOL,
  DEFAULT_STAGE,
  HUMAN_NAMES,
  HUMAN_PLAYER_STATE,
  INITIAL_SCORE_RANGE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NEGATIVE_SCORE_RANGE,
  POSITIVE_PROBABILITY,
  POSITIVE_SCORE_RANGE,
  ROBOT_NAMES,
  ROBOT_PLAYER_STATE,
  ROOM_PLAYER_COUNT_OPTIONS,
  ROOM_UI_LIMIT,
  SELF_PLAYER_NAME,
  SELF_PLAYER_STATE,
  SELF_POSITIVE_PROBABILITY,
  SELF_TEAMMATE_POSITIVE_PROBABILITY,
  TEAM_RESHUFFLE_PROBABILITY,
  TEAM_SIZE,
} = require('./constants');

function getRandom(options) {
  return options && typeof options.random === 'function' ? options.random : Math.random;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min, max, random) {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffleInPlace(list, random) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index, random);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
}

function clonePlayer(player) {
  return {...player};
}

function normalizeScore(score, random) {
  if (typeof score === 'number') {
    return Math.max(0, Math.floor(score));
  }

  return randomInt(INITIAL_SCORE_RANGE.min, INITIAL_SCORE_RANGE.max, random);
}

function getAvatarBySeat(seat) {
  return AVATAR_POOL[(seat - 1) % AVATAR_POOL.length];
}

function getUsedRobotNames(players) {
  return new Set(players.filter((player) => player.isRobot).map((player) => player.name));
}

function getUsedHumanNames(players) {
  return new Set(players.filter((player) => !player.isRobot && !player.isSelf).map((player) => player.name));
}

function pickNameFromPool(pool, usedNames, random, fallbackPrefix) {
  const options = pool.filter((name) => !usedNames.has(name));
  if (!options.length) {
    return `${fallbackPrefix}${usedNames.size + 1}`;
  }
  return options[randomInt(0, options.length - 1, random)];
}

function getAvailableRobotName(usedNames, random) {
  return pickNameFromPool(ROBOT_NAMES, usedNames, random, '机器人');
}

function getAvailableHumanName(usedNames, random) {
  return pickNameFromPool(HUMAN_NAMES, usedNames, random, '玩家');
}

function getNextSeat(players) {
  return players.reduce((maxSeat, player) => Math.max(maxSeat, player.seat || 0), 0) + 1;
}

function createSelfPlayer(overrides = {}, options = {}) {
  const random = getRandom(options);
  const seat = overrides.seat || 1;

  return {
    id: overrides.id || 'player-self',
    name: overrides.name || SELF_PLAYER_NAME,
    avatar: overrides.avatar || getAvatarBySeat(seat),
    isRobot: false,
    isSelf: true,
    seat,
    score: normalizeScore(overrides.score, random),
    teamId: overrides.teamId || null,
    ready: true,
    state: overrides.state || SELF_PLAYER_STATE,
  };
}

function createRobotPlayer(overrides = {}, options = {}) {
  const random = getRandom(options);
  const seat = overrides.seat || 1;
  const usedNames = overrides.usedNames || new Set();
  const name = overrides.name || getAvailableRobotName(usedNames, random);

  return {
    id: overrides.id || `robot-${seat}-${Math.floor(random() * 100000)}`,
    name,
    avatar: overrides.avatar || getAvatarBySeat(seat),
    isRobot: true,
    isSelf: false,
    seat,
    score: normalizeScore(overrides.score, random),
    teamId: overrides.teamId || null,
    ready: true,
    state: overrides.state || ROBOT_PLAYER_STATE,
  };
}

function createHumanPlayer(overrides = {}, options = {}) {
  const random = getRandom(options);
  const seat = overrides.seat || 1;
  const usedNames = overrides.usedNames || new Set();
  const name = overrides.name || getAvailableHumanName(usedNames, random);

  return {
    id: overrides.id || `human-${seat}-${Math.floor(random() * 100000)}`,
    name,
    avatar: overrides.avatar || getAvatarBySeat(seat),
    isRobot: false,
    isSelf: false,
    seat,
    score: normalizeScore(overrides.score, random),
    teamId: overrides.teamId || null,
    ready: true,
    state: overrides.state || HUMAN_PLAYER_STATE,
  };
}

function normalizePlayers(players) {
  const list = (players || []).map(clonePlayer).sort((a, b) => a.seat - b.seat).slice(0, MAX_PLAYERS);
  return list.map((player, index) => ({
    ...player,
    seat: index + 1,
    avatar: player.avatar || getAvatarBySeat(index + 1),
    state: player.state || (player.isSelf ? SELF_PLAYER_STATE : ROBOT_PLAYER_STATE),
    ready: player.ready !== false,
    score: Math.max(0, Math.floor(player.score || 0)),
  }));
}

function createInitialPlayers(options = {}) {
  const random = getRandom(options);
  const desiredCount = clamp(options.count || MIN_PLAYERS, 1, MAX_PLAYERS);
  const players = [createSelfPlayer({score: options.selfScore}, options)];
  const usedNames = getUsedRobotNames(players);

  while (players.length < desiredCount) {
    const seat = players.length + 1;
    const robot = createRobotPlayer({seat, usedNames}, {random});
    usedNames.add(robot.name);
    players.push(robot);
  }

  return normalizePlayers(players);
}

function ensureMinimumPlayers(players, options = {}) {
  const random = getRandom(options);
  const normalized = normalizePlayers(players);
  const usedNames = getUsedRobotNames(normalized);

  while (normalized.length < MIN_PLAYERS) {
    const seat = getNextSeat(normalized);
    const robot = createRobotPlayer({seat, usedNames}, {random});
    usedNames.add(robot.name);
    normalized.push(robot);
  }

  return normalizePlayers(normalized);
}

function ensureEvenPlayers(players, options = {}) {
  const random = getRandom(options);
  const normalized = normalizePlayers(players);
  if (normalized.length % TEAM_SIZE === 0) {
    return normalized;
  }

  const usedNames = getUsedRobotNames(normalized);
  const seat = getNextSeat(normalized);
  const robot = createRobotPlayer({seat, usedNames}, {random});
  usedNames.add(robot.name);
  normalized.push(robot);
  return normalizePlayers(normalized);
}

function addInvitedHuman(players, options = {}) {
  const random = getRandom(options);
  const normalized = normalizePlayers(players);
  if (normalized.length >= MAX_PLAYERS) {
    return normalized;
  }

  const usedNames = getUsedHumanNames(normalized);
  const seat = getNextSeat(normalized);
  const human = createHumanPlayer({seat, usedNames}, {random});
  normalized.push(human);
  return normalizePlayers(normalized);
}

function pairPlayers(players, options = {}) {
  const normalized = ensureEvenPlayers(players, options);
  const withTeams = normalized.map(clonePlayer);
  const teams = [];

  for (let index = 0; index < withTeams.length; index += TEAM_SIZE) {
    const teamId = `team-${teams.length + 1}`;
    if (index + 1 < withTeams.length) {
      const memberIds = [withTeams[index].id, withTeams[index + 1].id];
      withTeams[index].teamId = teamId;
      withTeams[index + 1].teamId = teamId;
      teams.push({id: teamId, memberIds});
    } else {
      withTeams[index].teamId = teamId;
      teams.push({id: teamId, memberIds: [withTeams[index].id]});
    }
  }

  return {
    players: withTeams,
    teams,
  };
}

function assignTeamsByOrder(playersInOrder) {
  const withTeams = (playersInOrder || []).map(clonePlayer);
  const teams = [];

  for (let index = 0; index < withTeams.length; index += TEAM_SIZE) {
    const teamId = `team-${teams.length + 1}`;
    if (index + 1 < withTeams.length) {
      const memberIds = [withTeams[index].id, withTeams[index + 1].id];
      withTeams[index].teamId = teamId;
      withTeams[index + 1].teamId = teamId;
      teams.push({id: teamId, memberIds});
    } else {
      withTeams[index].teamId = teamId;
      teams.push({id: teamId, memberIds: [withTeams[index].id]});
    }
  }

  return {
    players: normalizePlayers(withTeams),
    teams,
  };
}

function maybeReshuffleTeams(players, options = {}) {
  const random = getRandom(options);
  const base = pairPlayers(players, options);
  if (base.players.length < 4 || random() > TEAM_RESHUFFLE_PROBABILITY) {
    return base;
  }

  const selfPlayer = base.players.find((player) => player.isSelf);
  const others = base.players.filter((player) => !player.isSelf).map(clonePlayer);
  shuffleInPlace(others, random);

  if (selfPlayer) {
    const teammate = others.shift();
    if (teammate) {
      return assignTeamsByOrder([clonePlayer(selfPlayer), teammate, ...others]);
    }
  }

  return assignTeamsByOrder(others);
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

function getLinkedDelta(delta) {
  const amount = Math.floor(Math.abs(delta) * 0.5);
  if (delta > 0) {
    return Math.max(1, amount);
  }
  if (delta < 0) {
    return -amount;
  }
  return 0;
}

function applyRoundEvents(players, teams, events) {
  const normalized = normalizePlayers(players);
  const nextPlayers = normalized.map(clonePlayer);
  const indexMap = nextPlayers.reduce((map, player, index) => {
    map[player.id] = index;
    return map;
  }, {});
  const teammateMap = buildTeammateMap(teams);

  (events || []).forEach((event) => {
    if (!event || typeof event.delta !== 'number' || !(event.actorId in indexMap)) {
      return;
    }

    const actorIndex = indexMap[event.actorId];
    nextPlayers[actorIndex].score = Math.max(0, nextPlayers[actorIndex].score + event.delta);

    const teammateId = teammateMap[event.actorId];
    if (!teammateId || !(teammateId in indexMap)) {
      return;
    }

    const teammateIndex = indexMap[teammateId];
    const teammateDelta = getLinkedDelta(event.delta);
    nextPlayers[teammateIndex].score = Math.max(0, nextPlayers[teammateIndex].score + teammateDelta);
  });

  return nextPlayers;
}

function pickDistinctPlayers(players, count, random) {
  const pool = players.map((player) => player.id);
  const picked = [];

  while (pool.length && picked.length < count) {
    const index = randomInt(0, pool.length - 1, random);
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}

function createScoreDelta(actor, players, random) {
  const selfPlayer = players.find((player) => player.isSelf);
  const selfTeamId = selfPlayer ? selfPlayer.teamId : null;
  let probability = POSITIVE_PROBABILITY;

  if (actor.isSelf) {
    probability = SELF_POSITIVE_PROBABILITY;
  } else if (selfTeamId && actor.teamId === selfTeamId) {
    probability = SELF_TEAMMATE_POSITIVE_PROBABILITY;
  }

  if (actor.isRobot) {
    const ranking = players.slice().sort((a, b) => b.score - a.score || a.seat - b.seat);
    const rankIndex = ranking.findIndex((player) => player.id === actor.id);
    const ratio = rankIndex <= 0 ? 0 : rankIndex / Math.max(1, ranking.length - 1);
    probability += 0.08 * ratio;
  }

  probability = clamp(probability, 0.35, 0.85);

  if (random() < probability) {
    return randomInt(POSITIVE_SCORE_RANGE.min, POSITIVE_SCORE_RANGE.max, random);
  }

  return -randomInt(NEGATIVE_SCORE_RANGE.min, NEGATIVE_SCORE_RANGE.max, random);
}

function playRound(players, teams, options = {}) {
  const random = getRandom(options);
  const normalizedPlayers = normalizePlayers(players);
  const paired = maybeReshuffleTeams(normalizedPlayers, options);
  const actorCount = randomInt(1, Math.min(3, paired.players.length), random);
  const actorIds = pickDistinctPlayers(paired.players, actorCount, random);
  const events = actorIds.map((actorId) => {
    const actor = paired.players.find((player) => player.id === actorId);
    return {
      actorId,
      delta: createScoreDelta(actor, paired.players, random),
    };
  });

  return {
    events,
    players: applyRoundEvents(paired.players, paired.teams, events),
    teams: paired.teams,
  };
}

function getRevealCountByPlayerSize(totalPlayers) {
  if (totalPlayers <= 4) {
    return 1;
  }
  if (totalPlayers <= 6) {
    return 2;
  }
  return 3;
}

function pickRandomIds(ids, count, random = Math.random) {
  const pool = [...ids];
  const result = [];
  while (pool.length && result.length < count) {
    const index = randomInt(0, pool.length - 1, random);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

function buildVisibleScoreState(players, timeLeft, duration, previous = {}, options = {}) {
  const random = getRandom(options);
  const list = Array.isArray(players) ? players : [];
  if (!list.length) {
    return {
      phase: -1,
      playerCount: 0,
      visibleIds: [],
      changed: true,
    };
  }
  const totalDuration = Number(duration) || 180;
  const elapsed = Math.max(0, totalDuration - (Number(timeLeft) || 0));
  const phase = Math.floor(elapsed / 30);
  const playerCount = list.length;
  const samePhase = previous && phase === previous.phase && playerCount === previous.playerCount;
  if (samePhase && Array.isArray(previous.visibleIds)) {
    return {
      phase,
      playerCount,
      visibleIds: previous.visibleIds,
      changed: false,
    };
  }
  const others = list.filter((player) => !player.isSelf).map((player) => player.id);
  const revealCount = Math.min(getRevealCountByPlayerSize(playerCount), others.length);
  return {
    phase,
    playerCount,
    visibleIds: pickRandomIds(others, revealCount, random),
    changed: true,
  };
}

function buildRanking(players) {
  return normalizePlayers(players)
    .sort((a, b) => b.score - a.score || a.seat - b.seat)
    .map((player, index) => ({...player, rank: index + 1}));
}

function formatScore(score) {
  return Number(score || 0).toLocaleString('en-US');
}

function buildResult(players) {
  const ranking = buildRanking(players);
  const top3 = {
    first: ranking[0] ? mapResultPlayer(ranking[0]) : emptyResultPlayer(),
    second: ranking[1] ? mapResultPlayer(ranking[1]) : emptyResultPlayer(),
    third: ranking[2] ? mapResultPlayer(ranking[2]) : emptyResultPlayer(),
  };

  return {
    ranking,
    top3,
    rest: ranking.slice(3).map((player) => ({
      id: player.id,
      rank: player.rank,
      name: player.name,
      score: formatScore(player.score),
      avatar: player.avatar,
      isSelf: !!player.isSelf,
    })),
  };
}

function emptyResultPlayer() {
  return {
    name: '--',
    score: '0',
    avatar: AVATAR_POOL[0],
  };
}

function mapResultPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    score: formatScore(player.score),
    avatar: player.avatar,
    isSelf: !!player.isSelf,
  };
}

function createRoomId(options = {}) {
  const random = getRandom(options);
  return String(randomInt(1000, 9999, random));
}

function chooseRoomPlayerCount(options = {}) {
  const random = getRandom(options);
  const index = randomInt(0, ROOM_PLAYER_COUNT_OPTIONS.length - 1, random);
  return ROOM_PLAYER_COUNT_OPTIONS[index];
}

function normalizeStage(stage) {
  if (!stage) {
    return {...DEFAULT_STAGE};
  }
  return {
    ...DEFAULT_STAGE,
    ...stage,
  };
}

function createRoomState(stage, options = {}) {
  const roomSize = clamp(options.roomSize || chooseRoomPlayerCount(options), MIN_PLAYERS, ROOM_UI_LIMIT);
  const players = createInitialPlayers({count: roomSize, random: getRandom(options)});
  return {
    roomId: createRoomId(options),
    stage: normalizeStage(stage),
    players,
  };
}

module.exports = {
  addInvitedHuman,
  applyRoundEvents,
  buildRanking,
  buildResult,
  buildVisibleScoreState,
  chooseRoomPlayerCount,
  createHumanPlayer,
  createInitialPlayers,
  createRobotPlayer,
  createRoomId,
  createRoomState,
  createSelfPlayer,
  ensureEvenPlayers,
  ensureMinimumPlayers,
  formatScore,
  getLinkedDelta,
  normalizeStage,
  pairPlayers,
  playRound,
};
