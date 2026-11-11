const engine = require('../game-engine/game-engine');
const runArena = require('../game-engine/run-arena');
const {GAME_DURATION_SECONDS} = require('../game-engine/constants');
const { buildOpportunity } = require('../game-engine/investment');

function reject(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

function requirePlayer(game, userId) {
  const player = game && game.players.find((item) => String(item.id) === String(userId) && !item.isRobot);
  if (!player) reject('对局不存在', 404);
  return player;
}

function requirePlaying(game, userId) {
  const player = requirePlayer(game, userId);
  if (game.status !== 'playing' || game.timeLeft <= 0 || game.settlementDone) reject('本局已进入结算');
  if (game.awaitingStartIds?.length) reject('等待所有玩家开始对局');
  return player;
}

function personalState(game, userId) {
  requirePlayer(game, userId);
  game.actionStates ||= new Map();
  const id = String(userId);
  if (!game.actionStates.has(id)) game.actionStates.set(id, { nextAt: 5 + Math.floor(Math.random() * 5), sequence: 0 });
  return game.actionStates.get(id);
}

function elapsed(game) { return Math.max(0, (game.duration || GAME_DURATION_SECONDS) - game.timeLeft); }

function ready(game, userId) {
  requirePlayer(game, userId);
  if (game.status !== 'playing' || game.timeLeft <= 0 || game.settlementDone) reject('本局已进入结算');
  game.awaitingStartIds = (game.awaitingStartIds || []).filter((id) => String(id) !== String(userId));
  game.stateVersion = (game.stateVersion || 0) + 1;
}

function getView(game, userId) {
  if (game.runWorld) {requirePlayer(game, userId); return {visibleScoreIds: game.players.map((p) => p.id), fortuneBag: null};}
  const player = requirePlayer(game, userId);
  const state = personalState(game, userId);
  const now = elapsed(game);
  const players = game.players.map((item) => ({ ...item, isSelf: String(item.id) === String(userId) }));
  state.visible = engine.buildVisibleScoreState(players, game.timeLeft, game.duration, state.visible);
  if (state.offer && now >= state.offer.expiresAt) {
    state.offer = null;
    state.nextAt = now + 5 + Math.floor(Math.random() * 5);
  }
  if (game.status === 'playing' && game.timeLeft > 0 && !game.settlementDone && !state.offer && now >= state.nextAt) {
    state.sequence++;
    state.offer = {
      id: `${game.sessionId}-${userId}-${state.sequence}`,
      expiresAt: now + 10,
      opportunity: buildOpportunity(player.score),
    };
  }
  return {
    visibleScoreIds: state.visible.visibleIds,
    fortuneBag: state.offer ? { ...state.offer, remainingSeconds: Math.max(0, state.offer.expiresAt - now) } : null,
  };
}

function setTeam(game, userId, targetId) {
  const self = requirePlaying(game, userId);
  if (game.runWorld) {
    if (targetId !== null && typeof targetId !== 'string') reject('请选择在场玩家');
    if (!runArena.selectRunTarget(game.runWorld, self.id, targetId)) reject('请选择独立的在场玩家，或先退出当前队伍');
    const next = runArena.advanceRunArena(game.runWorld, game.players, 0);
    game.runWorld = next.world; game.players = next.players; game.teams = next.teams;
    game.stateVersion = (game.stateVersion || 0) + 1;
    return;
  }
  const mateId = targetId === null ? null : String(targetId || '');
  if (mateId) {
    const target = game.players.find((item) => item.id === mateId);
    if (!target || target.id === self.id) reject('请选择其他在场玩家');
    if (getView(game, userId).visibleScoreIds.includes(mateId)) reject('请选择尚未亮分的玩家');
  }
  const pairs = (game.lockedPairs || []).filter((pair) => !pair.includes(self.id) && (!mateId || !pair.includes(mateId)));
  if (mateId) pairs.push([self.id, mateId]);
  const players = game.players.map((player) => player.id === self.id
    ? {...player, independent: !mateId}
    : player.id === mateId ? {...player, independent: false} : player);
  const paired = engine.pairPlayers(players, { lockedPairs: pairs });
  game.lockedPairs = pairs;
  game.players = paired.players;
  game.teams = paired.teams;
  game.feedText = mateId ? '队伍已更新' : '已保持独立，按个人积分结算';
  game.stateVersion = (game.stateVersion || 0) + 1;
}

function claimFortuneBag(game, userId, offerId) {
  const player = requirePlaying(game, userId);
  if (game.runWorld) reject('跑动接住福袋即可获得积分');
  const state = personalState(game, userId);
  if (state.lastClaim === offerId && typeof offerId === 'string') return;
  const view = getView(game, userId);
  if (!view.fortuneBag || typeof offerId !== 'string' || view.fortuneBag.id !== offerId) reject('福袋已结束，请领取下一份');
  const bonus = view.fortuneBag.opportunity.bonus;
  game.players = game.players.map((item) => item.id === player.id ? { ...item, score: item.score + bonus } : item);
  game.scoreLog ||= {};
  game.scoreLog[player.id] ||= [];
  game.scoreLog[player.id].push({ type: 'fortune_bag', delta: bonus, round: game.round, timestamp: Date.now() });
  game.lastEvents = [{ actorId: player.id, delta: bonus }];
  game.feedText = `${player.name}领取福袋 +${bonus}`;
  state.lastClaim = offerId;
  state.offer = null;
  state.nextAt = elapsed(game) + 5 + Math.floor(Math.random() * 5);
  game.stateVersion = (game.stateVersion || 0) + 1;
}

function acceptEmote(game, userId, emoteId) {
  requirePlaying(game, userId);
  if (!['cheer', 'ok', 'laugh', 'cool', 'heart', 'help'].includes(emoteId)) reject('请选择快捷表情');
  const state = personalState(game, userId);
  if (state.emoteAt && Date.now() - state.emoteAt < 1000) reject('请稍后再发送', 429);
  state.emoteAt = Date.now();
}

function move(game, userId, body) {
  const player = requirePlaying(game, userId);
  if (!game.runWorld || !runArena.setRunInput(game.runWorld, player.id, body.dx, body.dy)) reject('请发送有效的移动方向');
}

module.exports = { getView, setTeam, ready, claimFortuneBag, acceptEmote, move };
