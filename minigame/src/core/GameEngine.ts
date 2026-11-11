/**
 * 纯规则引擎（原 utils/game-engine.js）。
 *
 * 无副作用、可注入随机源，小游戏端与小程序端共享同一套规则语义。
 * 移植保持逐函数等价：任何行为差异都由 tests/engine-parity.test.ts 拦截。
 */

import {
  AVATAR_POOL,
  DEFAULT_STAGE,
  GAME_DURATION_SECONDS,
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
  ROOM_UI_LIMIT,
  SELF_PLAYER_NAME,
  SELF_PLAYER_STATE,
  SELF_POSITIVE_PROBABILITY,
  SELF_TEAMMATE_POSITIVE_PROBABILITY,
  TEAM_RESHUFFLE_PROBABILITY,
  TEAM_SIZE,
  resolveStage,
  type Stage,
  type StageLike,
} from './Constants';
import {clamp, getRandom, randomInt, shuffleInPlace, type RandomOptions, type RandomSource} from './Random';

export interface Player {
  id: string;
  name: string;
  avatar: string;
  isRobot: boolean;
  isSelf: boolean;
  seat: number;
  score: number;
  teamId: string | null;
  independent?: boolean;
  ready: boolean;
  state: string;
}

export interface PlayerOverrides extends Partial<Player> {
  usedNames?: Set<string>;
}

export interface Team {
  id: string;
  memberIds: string[];
}

export interface RoundEvent {
  actorId: string;
  delta: number;
  teammateId: string;
  linkedDelta: number;
}

export interface RoundOptions extends RandomOptions {
  lockedPair?: [string, string] | null;
  lockedPairs?: readonly (readonly string[])[];
}

export interface PlayRoundResult {
  events: RoundEvent[];
  players: Player[];
  teams: Team[];
}

export interface VisibleScoreState {
  phase: number;
  playerCount: number;
  visibleIds: string[];
  changed: boolean;
}

export interface RankedPlayer extends Player {
  rank: number;
}

export interface ResultPlayer {
  id?: string;
  name: string;
  score: string;
  avatar: string;
  isSelf?: boolean;
}

export interface ResultRestPlayer extends ResultPlayer {
  rank: number;
}

export interface GameResult {
  ranking: RankedPlayer[];
  top3: {
    first: ResultPlayer;
    second: ResultPlayer;
    third: ResultPlayer;
  };
  rest: ResultRestPlayer[];
}

export interface CreatePlayersOptions extends RandomOptions {
  count?: number;
  selfAvatar?: string;
  selfName?: string;
  selfScore?: number;
}

export interface RoomState {
  roomId: string;
  stage: Stage;
  players: Player[];
}

function clonePlayer(player: Player): Player {
  return {...player};
}

function normalizeScore(score: unknown, random: RandomSource): number {
  if (typeof score === 'number') {
    return Math.max(0, Math.floor(score));
  }

  return randomInt(INITIAL_SCORE_RANGE.min, INITIAL_SCORE_RANGE.max, random);
}

function getAvatarBySeat(seat: number): string {
  return AVATAR_POOL[(seat - 1) % AVATAR_POOL.length];
}

function getUsedRobotNames(players: readonly Player[]): Set<string> {
  return new Set(players.filter((player) => player.isRobot).map((player) => player.name));
}

function getUsedHumanNames(players: readonly Player[]): Set<string> {
  return new Set(players.filter((player) => !player.isRobot && !player.isSelf).map((player) => player.name));
}

function pickNameFromPool(
  pool: readonly string[],
  usedNames: Set<string>,
  random: RandomSource,
  fallbackPrefix: string
): string {
  const options = pool.filter((name) => !usedNames.has(name));
  if (!options.length) {
    return `${fallbackPrefix}${usedNames.size + 1}`;
  }
  return options[randomInt(0, options.length - 1, random)];
}

function getAvailableRobotName(usedNames: Set<string>, random: RandomSource): string {
  return pickNameFromPool(ROBOT_NAMES, usedNames, random, '机器人');
}

function getAvailableHumanName(usedNames: Set<string>, random: RandomSource): string {
  return pickNameFromPool(HUMAN_NAMES, usedNames, random, '玩家');
}

function getNextSeat(players: readonly Player[]): number {
  return players.reduce((maxSeat, player) => Math.max(maxSeat, player.seat || 0), 0) + 1;
}

export function createSelfPlayer(overrides: PlayerOverrides = {}, options: RandomOptions = {}): Player {
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

export function createRobotPlayer(overrides: PlayerOverrides = {}, options: RandomOptions = {}): Player {
  const random = getRandom(options);
  const seat = overrides.seat || 1;
  const usedNames = overrides.usedNames || new Set<string>();
  const name = overrides.name || getAvailableRobotName(usedNames, random);

  return {
    id: String(overrides.id || `robot-${seat}-${Math.floor(random() * 100000)}`).replace(/^(?!robot-)/, 'robot-'),
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

export function createHumanPlayer(overrides: PlayerOverrides = {}, options: RandomOptions = {}): Player {
  const random = getRandom(options);
  const seat = overrides.seat || 1;
  const usedNames = overrides.usedNames || new Set<string>();
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

export function normalizePlayers(players: readonly Player[] | null | undefined): Player[] {
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

export function createInitialPlayers(options: CreatePlayersOptions = {}): Player[] {
  const random = getRandom(options);
  const desiredCount = clamp(options.count || MIN_PLAYERS, 1, MAX_PLAYERS);
  const selfOverrides: PlayerOverrides = {score: options.selfScore};
  if (options.selfAvatar) {
    selfOverrides.avatar = options.selfAvatar;
  }
  if (options.selfName) {
    selfOverrides.name = options.selfName;
  }
  const players = [createSelfPlayer(selfOverrides, options)];
  const usedNames = getUsedRobotNames(players);

  while (players.length < desiredCount) {
    const seat = players.length + 1;
    const robot = createRobotPlayer({seat, usedNames}, {random});
    usedNames.add(robot.name);
    players.push(robot);
  }

  return normalizePlayers(players);
}

export function ensureMinimumPlayers(players: readonly Player[], options: RandomOptions = {}): Player[] {
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

export function ensureEvenPlayers(players: readonly Player[], options: RandomOptions = {}): Player[] {
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

export function addInvitedHuman(players: readonly Player[], options: RandomOptions = {}): Player[] {
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

/**
 * 玩家手动锁定的队伍。只有两个 id 都还在场上、且互不相同才算数。
 * 没有它的时候，玩家点人组队只是画了条线，真实队伍仍然按座位号配对并每回合随机重排。
 */
export function normalizeLockedPair(
  players: readonly Player[],
  lockedPair?: readonly string[] | null
): [string, string] | null {
  if (!Array.isArray(lockedPair) || lockedPair.length !== 2) {
    return null;
  }
  const [firstId, secondId] = lockedPair;
  if (!firstId || !secondId || firstId === secondId) {
    return null;
  }
  const ids = new Set((players || []).filter((player) => !player.independent).map((player) => player.id));
  return ids.has(firstId) && ids.has(secondId) ? [firstId, secondId] : null;
}

function collectLockedPlayers(
  players: readonly Player[], lockedPair?: readonly string[] | null,
  lockedPairs: readonly (readonly string[])[] = []
): Player[] {
  const ids = new Set<string>();
  const locked: Player[] = [];
  for (const candidate of [lockedPair, ...lockedPairs]) {
    const pair = normalizeLockedPair(players, candidate);
    if (pair && pair.every((id) => !ids.has(id))) {
      pair.forEach((id) => { ids.add(id); locked.push(players.find((player) => player.id === id) as Player); });
    }
  }
  return locked;
}

function orderWithLockedPair(
  players: readonly Player[], lockedPair?: readonly string[] | null,
  lockedPairs: readonly (readonly string[])[] = []
): Player[] {
  const locked = collectLockedPlayers(players, lockedPair, lockedPairs);
  const ids = new Set(locked.map((player) => player.id));
  return [...locked, ...players.filter((player) => !ids.has(player.id))];
}

export function assignTeamsByOrder(playersInOrder: readonly Player[]): {players: Player[]; teams: Team[]} {
  const withTeams: Player[] = (playersInOrder || []).map((player) => ({...player, teamId: null}));
  const pairedPlayers = withTeams.filter((player) => !player.independent);
  const teams: Team[] = [];

  for (let index = 0; index < pairedPlayers.length; index += TEAM_SIZE) {
    const teamId = `team-${teams.length + 1}`;
    if (index + 1 < pairedPlayers.length) {
      const memberIds = [pairedPlayers[index].id, pairedPlayers[index + 1].id];
      pairedPlayers[index].teamId = teamId;
      pairedPlayers[index + 1].teamId = teamId;
      teams.push({id: teamId, memberIds});
    } else {
      pairedPlayers[index].teamId = teamId;
      teams.push({id: teamId, memberIds: [pairedPlayers[index].id]});
    }
  }

  return {
    players: normalizePlayers(withTeams),
    teams,
  };
}

export function pairPlayers(
  players: readonly Player[],
  options: RoundOptions = {}
): {players: Player[]; teams: Team[]} {
  const normalized = players.some((player) => player.independent)
    ? normalizePlayers(players) : ensureEvenPlayers(players, options);
  return assignTeamsByOrder(orderWithLockedPair(normalized, options.lockedPair, options.lockedPairs));
}

function maybeReshuffleTeams(
  players: readonly Player[],
  options: RoundOptions = {}
): {players: Player[]; teams: Team[]} {
  const random = getRandom(options);
  const base = pairPlayers(players, options);
  if (base.players.length < 4 || random() > TEAM_RESHUFFLE_PROBABILITY) {
    return base;
  }

  // 玩家手动锁定的队伍不参与重排，只打乱其余人。
  // 否则玩家刚组完队，下一回合就被拆散，组队这个动作等于没做。
  const lockedCount = collectLockedPlayers(base.players, options.lockedPair, options.lockedPairs).length;
  if (lockedCount) {
    const ordered = orderWithLockedPair(base.players, options.lockedPair, options.lockedPairs);
    const locked = ordered.slice(0, lockedCount);
    const others = ordered.slice(lockedCount).map(clonePlayer);
    shuffleInPlace(others, random);
    return assignTeamsByOrder([...locked.map(clonePlayer), ...others]);
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

export function buildTeammateMap(teams: readonly Team[] | null | undefined): Record<string, string> {
  return (teams || []).reduce<Record<string, string>>((map, team) => {
    if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
      return map;
    }

    map[team.memberIds[0]] = team.memberIds[1];
    map[team.memberIds[1]] = team.memberIds[0];
    return map;
  }, {});
}

// 队友联动比例。固定 50% 时，"和谁组队"在数值上完全等价——
// 加上机器人的落后追赶加成后，抱垫底的大腿反而最划算，和玩家直觉相反。
// 改成按队友当前分数在全场的相对位置取 25%~75%：抱大腿收益高，翻车也跟着大。
const LINK_RATIO_MIN = 0.25;
const LINK_RATIO_MAX = 0.75;

export function getScoreStrength(player: Player, players: readonly Player[]): number {
  const scores = (players || []).map((item) => Number(item.score) || 0);
  if (!scores.length) {
    return 0.5;
  }
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max <= min) {
    return 0.5;
  }
  return clamp(((Number(player && player.score) || 0) - min) / (max - min), 0, 1);
}

export function getLinkedDelta(delta: number, strength = 0.5): number {
  const ratio = LINK_RATIO_MIN + (LINK_RATIO_MAX - LINK_RATIO_MIN) * clamp(strength, 0, 1);
  const amount = Math.floor(Math.abs(delta) * ratio);
  if (delta > 0) {
    return Math.max(1, amount);
  }
  if (delta < 0) {
    return -amount;
  }
  return 0;
}

export function applyRoundEvents(
  players: readonly Player[],
  teams: readonly Team[],
  events: readonly RoundEvent[] | null | undefined
): Player[] {
  const normalized = normalizePlayers(players);
  const nextPlayers = normalized.map(clonePlayer);
  const indexMap = nextPlayers.reduce<Record<string, number>>((map, player, index) => {
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
    // 联动强度用回合开始时的分数算，保证同一回合内多个事件的口径一致
    const teammateDelta =
      typeof event.linkedDelta === 'number'
        ? event.linkedDelta
        : getLinkedDelta(event.delta, getScoreStrength(normalized[actorIndex], normalized));
    nextPlayers[teammateIndex].score = Math.max(0, nextPlayers[teammateIndex].score + teammateDelta);
  });

  return nextPlayers;
}

function pickDistinctPlayers(players: readonly Player[], count: number, random: RandomSource): string[] {
  const pool = players.map((player) => player.id);
  const picked: string[] = [];

  while (pool.length && picked.length < count) {
    const index = randomInt(0, pool.length - 1, random);
    picked.push(pool.splice(index, 1)[0]);
  }

  return picked;
}

function createScoreDelta(actor: Player, players: readonly Player[], random: RandomSource): number {
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

/**
 * 结算一个回合。旧版签名是 playRound(players, teams, options)，其中 teams 从未被读取
 * （队伍由 maybeReshuffleTeams 依据 players 重新配对），移植时删除该死参数。
 */
export function playRound(players: readonly Player[], options: RoundOptions = {}): PlayRoundResult {
  const random = getRandom(options);
  const normalizedPlayers = normalizePlayers(players);
  const paired = maybeReshuffleTeams(normalizedPlayers, options);
  const actorCount = randomInt(1, Math.min(3, paired.players.length), random);
  const actorIds = pickDistinctPlayers(paired.players, actorCount, random);
  const teammateMap = buildTeammateMap(paired.teams);
  // 联动值在这里一次算好并挂在事件上，store 的积分明细和播报文案直接读，
  // 不再各自重算一遍（重算时机不同会导致"显示 +30 实际加了 +28"）
  const events = actorIds.map((actorId) => {
    const actor = paired.players.find((player) => player.id === actorId) as Player;
    const delta = createScoreDelta(actor, paired.players, random);
    const teammateId = teammateMap[actorId] || '';
    return {
      actorId,
      delta,
      teammateId,
      linkedDelta: teammateId ? getLinkedDelta(delta, getScoreStrength(actor, paired.players)) : 0,
    };
  });

  return {
    events,
    players: applyRoundEvents(paired.players, paired.teams, events),
    teams: paired.teams,
  };
}

function getRevealCountByPlayerSize(totalPlayers: number): number {
  if (totalPlayers <= 4) {
    return 1;
  }
  if (totalPlayers <= 6) {
    return 2;
  }
  return 3;
}

function pickRandomIds(ids: readonly string[], count: number, random: RandomSource = Math.random): string[] {
  const pool = [...ids];
  const result: string[] = [];
  while (pool.length && result.length < count) {
    const index = randomInt(0, pool.length - 1, random);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

export function buildVisibleScoreState(
  players: readonly Player[] | null | undefined,
  timeLeft: number,
  duration: number,
  previous: VisibleScoreState | null = null,
  options: RandomOptions = {}
): VisibleScoreState {
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
  const totalDuration = Number(duration) || GAME_DURATION_SECONDS;
  const elapsed = Math.max(0, totalDuration - (Number(timeLeft) || 0));
  const phase = Math.floor(elapsed / 30);
  const playerCount = list.length;
  const samePhase = previous !== null && phase === previous.phase && playerCount === previous.playerCount;
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

export function buildRanking(players: readonly Player[]): RankedPlayer[] {
  return normalizePlayers(players)
    .sort((a, b) => b.score - a.score || a.seat - b.seat)
    .map((player, index) => ({...player, rank: index + 1}));
}

export function formatScore(score: unknown): string {
  return Number(score || 0).toLocaleString('en-US');
}

export function buildResult(players: readonly Player[]): GameResult {
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

function emptyResultPlayer(): ResultPlayer {
  return {
    name: '--',
    score: '0',
    avatar: AVATAR_POOL[0],
  };
}

function mapResultPlayer(player: Player): ResultPlayer {
  return {
    id: player.id,
    name: player.name,
    score: formatScore(player.score),
    avatar: player.avatar,
    isSelf: !!player.isSelf,
  };
}

export function createRoomId(options: RandomOptions = {}): string {
  const random = getRandom(options);
  return String(randomInt(1000, 9999, random));
}

export function chooseRoomPlayerCount(_options: RandomOptions = {}): number {
  return MIN_PLAYERS;
}

export function normalizeStage(stage: StageLike): Stage {
  if (!stage) {
    return {...DEFAULT_STAGE};
  }
  return resolveStage(stage);
}

export function createRoomState(
  stage: StageLike,
  options: CreatePlayersOptions & {roomSize?: number} = {}
): RoomState {
  const roomSize = clamp(options.roomSize || chooseRoomPlayerCount(options), MIN_PLAYERS, ROOM_UI_LIMIT);
  const players = createInitialPlayers({
    count: roomSize,
    random: getRandom(options),
    selfAvatar: options.selfAvatar,
    selfName: options.selfName,
    selfScore: options.selfScore,
  });
  return {
    roomId: createRoomId(options),
    stage: normalizeStage(stage),
    players,
  };
}
