/**
 * 全局对局状态（原 utils/game-store.js）。
 *
 * 单例模块：持有房间/对局的完整状态、1 秒 tick 定时器、订阅者与持久化。
 * - 状态整体不可变替换，emit 直接传引用（监听方自行拷贝），避免每 tick 深拷贝；
 * - 持久化节流：tick 期间每 5s 写一次，开局/暂停/结算等关键节点立即写；
 * - 恢复时只接受可继续游玩的有效中间态，残缺态一律重置，避免"playing 但 0 玩家"的僵尸对局。
 */

import {
  DEFAULT_STAGE,
  GAME_DURATION_SECONDS,
  MATCH_MODE_TEXT,
  MAX_PLAYERS,
  PLAYER_STATUS_SELF_READY,
  PLAYER_STATUS_SELF_WAITING,
  ROOM_UI_LIMIT,
  ROUND_INTERVAL_SECONDS,
  type Stage,
  type StageLike,
} from './Constants';
import * as engine from './GameEngine';
import * as runArena from './RunArena';
import type {RunWorld, RunStats} from './RunArena';
import type {GameResult, Player, Team} from './GameEngine';
import {buildAchievement, buildAchievementMedal, type AchievementMedal} from './AchievementMedals';
import * as playerStats from './PlayerStats';
import * as shopStore from './ShopStore';
import {getCachedProfile} from './UserProfile';
import {readJson, removeKey, writeJson} from '../platform/storage';

const GAME_STATE_KEY = 'game_codex_game_state_v1';
// 持久化节流：对局 tick 期间每 5s 写一次存储（关键节点：开局/暂停/结算 立即写）
const PERSIST_INTERVAL_SECONDS = 5;

export type GameStatus = 'idle' | 'room' | 'playing' | 'finished';

export interface ScoreLogEntry {
  type: string;
  delta: number;
  round: number;
  timestamp: number;
}

/**
 * 最近一轮事件。tick 写入的是引擎完整事件，手动加减分只写入 actorId/delta，
 * 因此后两个字段是可选的。
 */
export interface LastEvent {
  actorId: string;
  delta: number;
  teammateId?: string;
  linkedDelta?: number;
}

export interface ScoreBreakdown {
  round: number;
  teamBonus: number;
  investment: number;
  fortuneBag: number;
  total: number;
}

export interface FinishedResult extends GameResult {
  resultId: string;
  gain: number;
  coins: number;
  achievement: string;
  achievementMedal: AchievementMedal;
  scoreBreakdownMap: Record<string, ScoreBreakdown>;
  performanceMap?: Record<string, RunStats>;
  rewardNotice?: string;
}

export interface GameState {
  runWorld?: RunWorld | null;
  roomId: string;
  stage: Stage;
  modeText: string;
  status: GameStatus;
  guestAssets: boolean;
  duration: number;
  timeLeft: number;
  awaitingStart?: boolean;
  needsStartAck?: boolean;
  round: number;
  players: Player[];
  teams: Team[];
  result: FinishedResult | null;
  initialScores: Record<string, number>;
  scoreLog: Record<string, ScoreLogEntry[]>;
  lastEvents: LastEvent[];
  /** 玩家手动组队锁定的 [selfId, mateId]；为空时队伍按引擎默认规则每回合随机重排。 */
  lockedPair: [string, string] | null;
  feedText: string;
}

export interface PersistedGameState {
  runWorld?: RunWorld | null;
  initialScores?: Record<string, number>;
  scoreLog?: Record<string, ScoreLogEntry[]>;
  duration?: number;
  roomId: string;
  stage: Stage;
  status: GameStatus;
  timeLeft: number;
  round: number;
  players: Player[];
  teams: Team[];
  lockedPair: [string, string] | null;
  guestAssets: boolean;
}

export interface GameStoreOptions {
  random?: () => number;
  autoStartTimer?: boolean;
  roomSize?: number;
  selfAvatar?: string;
  selfName?: string;
  selfScore?: number;
  lockedPair?: [string, string] | null;
}

type Listener = (state: GameState) => void;

let state: GameState = createEmptyState();
const listeners = new Set<Listener>();
let timer: number | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyState(): GameState {
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
    lockedPair: null,
    runWorld: null,
    feedText: `等待开局（${MATCH_MODE_TEXT}）`,
  };
}

function buildInitialScores(players: readonly Player[]): Record<string, number> {
  return players.reduce<Record<string, number>>((scores, player) => {
    scores[player.id] = player.score;
    return scores;
  }, {});
}

function createScoreLog(players: readonly Player[]): Record<string, ScoreLogEntry[]> {
  return (players || []).reduce<Record<string, ScoreLogEntry[]>>((map, player) => {
    map[player.id] = [];
    return map;
  }, {});
}

function loadPersistedState(): unknown {
  return readJson<unknown>(GAME_STATE_KEY);
}

function savePersistedState(): void {
  const payload: PersistedGameState = {
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
  writeJson(GAME_STATE_KEY, payload);
}

function clearPersistedState(): void {
  removeKey(GAME_STATE_KEY);
}

function asPersisted(raw: unknown): Partial<PersistedGameState> | null {
  return raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw)) : null;
}

// 恢复完整性校验：只接受可继续游玩的有效中间态（room/playing + 非空 players）
// 任何无效/残缺中间态一律重置为初始状态并清理存储，避免出现"playing 但 0 玩家"的僵尸对局
export function isValidPersistedState(raw: unknown): boolean {
  const persisted = asPersisted(raw);
  if (!persisted) {
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

function restorePersistedState(): void {
  const raw = loadPersistedState();
  const persisted = asPersisted(raw);
  if (isValidPersistedState(persisted)) {
    const source = persisted as PersistedGameState;
    state = {
      ...state,
      roomId: source.roomId || state.roomId,
      stage: source.stage || state.stage,
      status: source.status,
      timeLeft: typeof source.timeLeft === 'number' ? source.timeLeft : state.timeLeft,
      // 旧版进行中存档来自 180 秒对局；新对局会保存明确时长。
      duration: Number(source.duration) || (source.status === 'playing' ? 180 : GAME_DURATION_SECONDS),
      round: typeof source.round === 'number' ? source.round : state.round,
      players: source.players,
      teams: source.teams || [],
      lockedPair: Array.isArray(source.lockedPair) ? source.lockedPair : null,
      runWorld: source.status === 'playing' ? runArena.restoreRunWorld(source.runWorld, source.players, source.teams || [], ((Number(source.duration) || 180) - source.timeLeft) * 1000) : null,
      guestAssets: source.guestAssets !== false,
      initialScores: source.initialScores || buildInitialScores(source.players),
      scoreLog: source.scoreLog || createScoreLog(source.players),
      feedText:
        source.status === 'playing'
          ? `对局已恢复（${MATCH_MODE_TEXT}），剩余 ${source.timeLeft}s`
          : `房间已恢复（${MATCH_MODE_TEXT}）`,
    };
  } else if (persisted) {
    // 无效/残缺中间态：清掉并回到初始状态
    clearPersistedState();
  }
}

restorePersistedState();

function emit(): void {
  // state 每次更新都是整体替换（不可变更新），直接传引用即可；
  // 监听方按需自行拷贝，避免每 tick 一次全状态 JSON 深拷贝（局末可达 78KB）
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.warn('[game-store] emit listener error:', error);
    }
  });
}

function stopTimer(): void {
  if (timer === null) {
    return;
  }
  clearInterval(timer);
  timer = null;
}

function startTimer(): void {
  if (timer !== null) {
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
}

export function getState(): GameState {
  return clone(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensureScoreLogPlayers(
  baseLog: Record<string, ScoreLogEntry[]> | undefined,
  players: readonly Player[]
): Record<string, ScoreLogEntry[]> {
  const next = {...(baseLog || {})};
  (players || []).forEach((player) => {
    if (!next[player.id]) {
      next[player.id] = [];
    }
  });
  return next;
}

function appendScoreLogEntries(
  baseLog: Record<string, ScoreLogEntry[]> | undefined,
  players: readonly Player[],
  entries: {playerId: string; type?: string; delta: number; round?: number}[] = []
): Record<string, ScoreLogEntry[]> {
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

function buildTeammateMap(teams: readonly Team[] | undefined): Record<string, string> {
  return (teams || []).reduce<Record<string, string>>((map, team) => {
    if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
      return map;
    }
    map[team.memberIds[0]] = team.memberIds[1];
    map[team.memberIds[1]] = team.memberIds[0];
    return map;
  }, {});
}

function buildScoreBreakdownMap(
  scoreLog: Record<string, ScoreLogEntry[]> | undefined,
  players: readonly Player[]
): Record<string, ScoreBreakdown> {
  const ids = (players || []).map((player) => player.id);
  return ids.reduce<Record<string, ScoreBreakdown>>((map, playerId) => {
    const entries = Array.isArray(scoreLog && scoreLog[playerId]) ? (scoreLog as Record<string, ScoreLogEntry[]>)[playerId] : [];
    const breakdown: ScoreBreakdown = {
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

function buildFinishedResult(currentState: GameState): FinishedResult {
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

export function createRoomFromStage(stage: StageLike = DEFAULT_STAGE, options: GameStoreOptions = {}): GameState {
  stopTimer();
  clearPersistedState();
  const cachedProfile = getCachedProfile();
  const mergedOptions = {
    ...options,
    selfAvatar: options.selfAvatar || cachedProfile.avatarUrl || '',
    selfName:
      options.selfName ||
      (cachedProfile.nickName && cachedProfile.nickName !== '微信用户' ? cachedProfile.nickName : ''),
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

export function ensureRoom(stage: StageLike = DEFAULT_STAGE, options: GameStoreOptions = {}): GameState {
  if (state.status === 'room' || state.status === 'playing') {
    return getState();
  }
  return createRoomFromStage(stage, options);
}

export function inviteHumanPlayer(options: GameStoreOptions = {}): GameState {
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

export function startGame(options: GameStoreOptions = {}): GameState {
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

export function finishGame(): GameState {
  if (state.status === 'finished') {
    return getState();
  }
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

function findPlayerMap(players: readonly Player[]): Record<string, Player> {
  return (players || []).reduce<Record<string, Player>>((map, player) => {
    map[player.id] = player;
    return map;
  }, {});
}

function buildRoundFeed(
  events: readonly LastEvent[] | undefined,
  players: readonly Player[],
  teams: readonly Team[]
): string {
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
      const linked = typeof event.linkedDelta === 'number' ? event.linkedDelta : engine.getLinkedDelta(event.delta);
      const actorPart = `${actor.name}${event.delta >= 0 ? '+' : ''}${event.delta}`;
      const text =
        mate && linked ? `${actorPart}（${mate.name}${linked >= 0 ? '+' : ''}${linked}）` : actorPart;
      return {
        text,
        involvesSelf: !!actor.isSelf || !!(mate && mate.isSelf),
      };
    })
    .filter((line): line is {text: string; involvesSelf: boolean} => line !== null);

  if (!lines.length) {
    return '本轮结算完成';
  }

  return lines
    .sort((a, b) => Number(b.involvesSelf) - Number(a.involvesSelf))
    .map((line) => line.text)
    .join(' · ');
}

export function tick(options: GameStoreOptions = {}): GameState {
  if (state.runWorld) return advanceRunFrame(1000, options);
  if (state.status !== 'playing') {
    return state;
  }

  const nextTimeLeft = Math.max(0, state.timeLeft - 1);
  let nextPlayers = state.players;
  let nextTeams = state.teams;
  let nextRound = state.round;
  let nextEvents: LastEvent[] = [];
  let nextFeedText = state.feedText;
  let nextScoreLog = ensureScoreLogPlayers(state.scoreLog, nextPlayers);

  if (nextTimeLeft > 0 && (state.duration - nextTimeLeft) % ROUND_INTERVAL_SECONDS === 0) {
    // tick 由 setInterval 无参调用，锁定队伍要在这里从 state 注入，否则引擎每回合照样重排
    const roundOptions = state.lockedPair ? {...options, lockedPair: state.lockedPair} : options;
    const roundResult = engine.playRound(state.players, roundOptions);
    nextPlayers = roundResult.players;
    nextTeams = roundResult.teams;
    nextRound += 1;
    nextEvents = roundResult.events;
    const teammateMap = buildTeammateMap(nextTeams);
    const scoreEntries: {playerId: string; type: string; delta: number; round: number}[] = [];
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
      const linkedDelta =
        typeof event.linkedDelta === 'number' ? event.linkedDelta : engine.getLinkedDelta(event.delta);
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

export function applyPlayerScoreDelta(
  playerId: string,
  delta: unknown,
  options: {feedText?: string; scoreType?: string} = {}
): GameState {
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
  const feedText = options.feedText || `${target ? target.name : '玩家'} 积分${sign}${amount}`;

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
export function setSelfTeam(mateId: string): GameState {
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

  const lockedPair: [string, string] = [selfPlayer.id, mateId];
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
export function clearSelfTeam(): GameState {
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

export function setSelfReady(ready: unknown): GameState {
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

export function restartGame(options: GameStoreOptions = {}): GameState {
  const stage = state.stage || DEFAULT_STAGE;
  createRoomFromStage(stage, {
    ...options,
    roomSize: options.roomSize || ROOM_UI_LIMIT,
  });
  return startGame(options);
}

/**
 * 暂停对局：停止 1s tick 定时器并持久化当前快照。
 * 离开对局页（onHide/onUnload/切后台）时调用，防止幽灵对局在后台跑完并静默结算。
 */
export function pauseGame(): GameState {
  if (state.runWorld) state.runWorld.runners.forEach((r) => runArena.setRunInput(state.runWorld!, r.id, 0, 0));
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
export function resumeGame(): GameState {
  if (state.status !== 'playing' || timer !== null) {
    return getState();
  }
  startTimer();
  return getState();
}

export function setRunDirection(dx: number, dy: number): void {
  if (state.status !== 'playing' || !state.runWorld) return;
  const self = state.players.find((p) => p.isSelf);
  if (self) runArena.setRunInput(state.runWorld, self.id, dx, dy);
}

export function advanceRunFrame(deltaMs: number, options: GameStoreOptions = {}): GameState {
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

export function resetToHome(): GameState {
  stopTimer();
  clearPersistedState();
  state = createEmptyState();
  emit();
  return getState();
}

/** @private 仅测试使用 - 生产代码不要调用 */
export function __resetForTests(): void {
  stopTimer();
  listeners.clear();
  state = createEmptyState();
}
