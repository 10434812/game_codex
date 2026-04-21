const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_STAGE} = require('../../utils/constants');
const {formatScore} = require('../../utils/game-engine');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');

const BOARD_LAYOUT = {
  centerX: 360,
  centerY: 370,
  radius: 270,
  startAngle: -90,
};

const BAG_SPAWN_BOUNDS = {
  minX: 120,
  maxX: 600,
  minY: 170,
  maxY: 610,
};
const BAG_SAFE_RADIUS = 152;

function buildBoardPlayers(players, emoteMap = {}) {
  return buildBoardPlayersWithVisibility(players, emoteMap, new Set());
}

function buildBoardPlayersWithVisibility(players, emoteMap = {}, visibleScoreIdSet = new Set()) {
  const list = players || [];
  if (!list.length) {
    return [];
  }

  const step = 360 / list.length;
  const maxScore = Math.max(
    ...list.map((player) => {
      const score = Number(player.score);
      return Number.isFinite(score) ? score : 0;
    }),
    1
  );

  return list.map((player, index) => ({
    ...(() => {
      const x =
        BOARD_LAYOUT.centerX +
        BOARD_LAYOUT.radius * Math.cos(((BOARD_LAYOUT.startAngle + step * index) * Math.PI) / 180);
      let namePos = 'center';
      if (x < 150) {
        namePos = 'right';
      } else if (x > 570) {
        namePos = 'left';
      }
      return {
        x: Math.round(x),
        namePos,
      };
    })(),
    ...player,
    emoteText: emoteMap[player.id] || '',
    score: formatScore(player.score),
    revealHpPercent: Math.max(18, Math.min(100, Math.round(((Number(player.score) || 0) / maxScore) * 100))),
    showScore: !!player.isSelf || visibleScoreIdSet.has(player.id),
    scoreLabel:
      !!player.isSelf || visibleScoreIdSet.has(player.id)
        ? `${player.name} · ${formatScore(player.score)}`
        : player.name,
    y: Math.round(
      BOARD_LAYOUT.centerY +
        BOARD_LAYOUT.radius * Math.sin(((BOARD_LAYOUT.startAngle + step * index) * Math.PI) / 180)
    ),
  }));
}

function applySelfDecorations(players, display) {
  return (players || []).map((player) => {
    if (!player.isSelf) {
      return {
        ...player,
        skinClass: '',
        petIcon: '',
        petLabel: '',
      };
    }
    return {
      ...player,
      skinClass: display && display.skinClass ? display.skinClass : 'skin-default',
      petIcon: display && display.petIcon ? display.petIcon : '',
      petLabel: display && display.petLabel ? display.petLabel : '',
    };
  });
}

function formatTimeLeft(timeLeft) {
  return `${Math.max(0, Number(timeLeft) || 0)}s`;
}

function getNodeCenter(player) {
  return {
    x: Number(player.x) || 0,
    y: (Number(player.y) || 0) + 60,
  };
}

function buildLinkStyle(fromPlayer, toPlayer) {
  const from = getNodeCenter(fromPlayer);
  const to = getNodeCenter(toPlayer);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const centerX = (from.x + to.x) / 2;
  const centerY = (from.y + to.y) / 2;
  return `left:${centerX}rpx;top:${centerY}rpx;width:${length}rpx;transform:translate(-50%, -50%) rotate(${angle}deg);`;
}

function buildTeamLinks(players, teams) {
  const playerMap = (players || []).reduce((map, player) => {
    map[player.id] = player;
    return map;
  }, {});

  return (teams || [])
    .map((team) => {
      if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
        return null;
      }
      const from = playerMap[team.memberIds[0]];
      const to = playerMap[team.memberIds[1]];
      if (!from || !to) {
        return null;
      }
      return {
        id: team.id,
        pairKey: [from.id, to.id].sort().join('::'),
        fromName: from.name,
        toName: to.name,
        style: buildLinkStyle(from, to),
      };
    })
    .filter(Boolean);
}

function findSelfTeamInfo(state) {
  const players = (state && state.players) || [];
  const teams = (state && state.teams) || [];
  const self = players.find((player) => player.isSelf);
  if (!self) {
    return {selfId: '', teammateId: '', pairKey: ''};
  }
  const team = teams.find(
    (item) => item && Array.isArray(item.memberIds) && item.memberIds.includes(self.id)
  );
  if (!team || !Array.isArray(team.memberIds) || team.memberIds.length !== 2) {
    return {selfId: self.id, teammateId: '', pairKey: ''};
  }
  const teammateId = team.memberIds.find((id) => id !== self.id) || '';
  return {
    selfId: self.id,
    teammateId,
    pairKey: [self.id, teammateId].sort().join('::'),
  };
}

function findSelfManualLink(selfId, manualMap) {
  if (!selfId || !manualMap) {
    return null;
  }
  return (
    Object.values(manualMap).find((link) => {
      const key = String(link && link.pairKey ? link.pairKey : '');
      return key.includes(`${selfId}::`) || key.includes(`::${selfId}`);
    }) || null
  );
}

function getMateIdFromPairKey(pairKey, selfId) {
  if (!pairKey || !selfId) {
    return '';
  }
  return (
    String(pairKey)
      .split('::')
      .find((id) => id && id !== selfId) || ''
  );
}

const FORTUNE_BAG_ASSETS = [
  '/assets/iocns/2657.png_300.png',
  '/assets/iocns/2657.png_30012.png',
];

const INVESTMENT_POOL = [
  {category: '股票', name: '新能源龙头'},
  {category: '股票', name: '芯片指数ETF'},
  {category: '房产', name: '核心商圈写字楼'},
  {category: '房产', name: '地铁口租赁公寓'},
  {category: '比特币', name: 'BTC 波段机会'},
  {category: '比特币', name: '矿企联动仓位'},
];

const QUICK_EMOTES = [
  {key: 'cheer', label: '冲呀', text: '冲呀!'},
  {key: 'ok', label: '收到', text: '收到~'},
  {key: 'laugh', label: '哈哈', text: '哈哈哈'},
  {key: 'cool', label: '稳住', text: '稳住别慌'},
  {key: 'heart', label: '点赞', text: '太棒了'},
  {key: 'help', label: '求带', text: '求带飞'},
];

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomPick(list) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  return list[randomInt(0, list.length - 1)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function pickRandomIds(ids, count) {
  const pool = [...ids];
  const result = [];
  while (pool.length && result.length < count) {
    const index = randomInt(0, pool.length - 1);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

function buildFortuneBag(idSeed) {
  return buildFortuneBagByPlayers(idSeed, []);
}

function isBagOverlappingPlayers(x, y, players = []) {
  if (!Array.isArray(players) || !players.length) {
    return false;
  }
  return players.some((player) => {
    const px = Number(player.x) || 0;
    const py = (Number(player.y) || 0) + 60;
    const dx = x - px;
    const dy = y - py;
    return Math.sqrt(dx * dx + dy * dy) < BAG_SAFE_RADIUS;
  });
}

function buildFortuneBagByPlayers(idSeed, players = []) {
  const id = `bag-${idSeed}-${Date.now()}`;
  const asset = randomPick(FORTUNE_BAG_ASSETS);
  const maxTry = 24;
  for (let i = 0; i < maxTry; i += 1) {
    const x = randomInt(BAG_SPAWN_BOUNDS.minX, BAG_SPAWN_BOUNDS.maxX);
    const y = randomInt(BAG_SPAWN_BOUNDS.minY, BAG_SPAWN_BOUNDS.maxY);
    if (!isBagOverlappingPlayers(x, y, players)) {
      return {id, x, y, asset};
    }
  }

  const fallbackX = BOARD_LAYOUT.centerX;
  const fallbackY = BOARD_LAYOUT.centerY + 38;
  return {id, x: fallbackX, y: fallbackY, asset};
}

function parseScoreText(scoreText) {
  const value = Number(String(scoreText || '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function buildOpportunity(selfScore) {
  const item = randomPick(INVESTMENT_POOL) || {category: '股票', name: '随机机会'};
  const riskLevel = selfScore < 250 ? 'high' : selfScore < 520 ? 'mid' : 'low';
  const costMin = selfScore < 250 ? 50 : 80;
  const costMax = selfScore < 250 ? 210 : selfScore < 520 ? 280 : 360;
  const cost = randomInt(costMin, costMax);
  const rangeMap = {
    high: {min: -0.55, max: 1.1, label: '高波动'},
    mid: {min: -0.35, max: 0.75, label: '中波动'},
    low: {min: -0.2, max: 0.45, label: '稳健'},
  };
  const range = rangeMap[riskLevel] || rangeMap.mid;
  return {
    ...item,
    cost,
    riskLevel,
    riskText: range.label,
    floatRangeText: `${Math.round(range.min * 100)}% ~ +${Math.round(range.max * 100)}%`,
    summary: '买入后需等待时机卖出，卖出时才最终结算盈亏。',
  };
}

function settlePosition(position) {
  const risk = position && position.riskLevel ? position.riskLevel : 'mid';
  const cost = Math.max(1, Number(position && position.cost ? position.cost : 1));
  const buyAt = Number(position && position.buyAt ? position.buyAt : Date.now());
  const holdSeconds = Math.max(0, Math.round((Date.now() - buyAt) / 1000));
  const rangeMap = {
    high: {min: 0.42, max: 1.95},
    mid: {min: 0.66, max: 1.58},
    low: {min: 0.84, max: 1.33},
  };
  const range = rangeMap[risk] || rangeMap.mid;
  const holdBonus = clamp(holdSeconds / 180, 0, 0.16);
  const randomBase = range.min + (range.max - range.min) * Math.random();
  const multiplier = clamp(randomBase + holdBonus, range.min, range.max + 0.16);
  const proceeds = Math.max(0, Math.round(cost * multiplier));
  const pnl = proceeds - cost;
  const pnlSign = pnl >= 0 ? '+' : '';
  return {
    proceeds,
    pnl,
    pnlText: `${pnlSign}${pnl}`,
    multiplierText: `${Math.round(multiplier * 100)}%`,
  };
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    players: [],
    teamLinks: [],
    inviteLink: null,
    successLink: null,
    successToast: null,
    emotePanelVisible: false,
    quickEmotes: QUICK_EMOTES,
    fortuneBag: null,
    activeOpportunity: null,
    activePosition: null,
    timeText: '180s',
    hintText: '等待开始',
    actionHintText: '',
    tabs: [
      {key: 'explore', label: '探索', icon: '/assets/nav/explore.svg', iconActive: '/assets/nav/explore_active.svg', page: '/pages/home/index'},
      {key: 'social', label: '社交', icon: '/assets/nav/social.svg', iconActive: '/assets/nav/social_active.svg', page: '/pages/room/index'},
      {key: 'play', label: '游玩', icon: '/assets/nav/play.svg', iconActive: '/assets/nav/play_active.svg', page: '/pages/arena/index'},
      {key: 'history', label: '历史', icon: '/assets/nav/history.svg', iconActive: '/assets/nav/history_active.svg', page: '/pages/result/index'},
    ],
    activeTab: 'play',
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    shopDisplay: shopStore.getEquippedDisplay(),
  },
  onLoad() {
    this.prevStateTeamKeySet = new Set();
    this.manualTeamLinkMap = {};
    this.latestStateTeamLinks = [];
    this.hiddenStatePairKeys = new Set();
    this.selfTeamDissolved = false;
    this.selfStatePairKey = '';
    this.selfId = '';
    this.selfStateTeammateId = '';
    this.lastRound = -1;
    this.lastEventSign = '';
    this.emoteMap = {};
    this.emoteTimerMap = {};
    this.visibleScoreIdSet = new Set();
    this.scoreRevealPhase = -1;
    this.scoreRevealPlayerCount = 0;
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
  },
  onShow() {
    this.syncUserProfile();
    this.syncShopDisplay();
    const state = this.ensureArenaState();
    if (!state) {
      return;
    }

    this.syncArena(state);
    this.unsubscribeStore();
    this.unsubscribe = gameStore.subscribe((nextState) => {
      if (nextState.status === 'finished') {
        this.clearBagTimers();
        this.clearEmoteTimers();
        this.unsubscribeStore();
        wx.redirectTo({url: '/pages/result/index'});
        return;
      }
      this.syncArena(nextState);
    });
    this.scheduleNextBagDrop();
    this.scheduleRemoteEmote();
  },
  onHide() {
    this.clearInviteTimers();
    this.clearBagTimers();
    this.clearEmoteTimers();
    this.setData({
      fortuneBag: null,
      activeOpportunity: null,
      emotePanelVisible: false,
    });
    this.unsubscribeStore();
  },
  onUnload() {
    this.clearInviteTimers();
    this.clearBagTimers();
    this.clearEmoteTimers();
    this.unsubscribeStore();
  },
  syncUserProfile() {
    const cached = getCachedProfile();
    this.setData({
      userProfile: cached,
      userAuthorized: hasValidProfile(cached),
    });
  },
  syncShopDisplay() {
    this.setData({
      shopDisplay: shopStore.getEquippedDisplay(),
    });
  },
  onTapProfile() {
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapShop() {
    playCue('tap', {volume: 0.75});
    wx.navigateTo({url: '/pages/shop/index'});
  },
  ensureArenaState() {
    const snapshot = gameStore.getState();
    if (snapshot.status === 'finished') {
      wx.redirectTo({url: '/pages/result/index'});
      return null;
    }

    if (snapshot.status === 'playing') {
      return snapshot;
    }

    if (snapshot.status === 'room') {
      return gameStore.startGame();
    }

    gameStore.createRoomFromStage(snapshot.stage || DEFAULT_STAGE);
    return gameStore.startGame();
  },
  syncArena(state) {
    const selfTeamInfo = findSelfTeamInfo(state);
    this.selfId = selfTeamInfo.selfId;
    this.selfStateTeammateId = selfTeamInfo.teammateId;
    if (selfTeamInfo.pairKey !== this.selfStatePairKey) {
      this.selfStatePairKey = selfTeamInfo.pairKey;
      this.selfTeamDissolved = false;
      this.hiddenStatePairKeys.clear();
    }

    this.refreshVisibleScores(state.players, state.timeLeft, state.duration);
    const boardPlayers = buildBoardPlayersWithVisibility(
      state.players,
      this.emoteMap,
      this.visibleScoreIdSet
    );
    const decoratedPlayers = applySelfDecorations(boardPlayers, this.data.shopDisplay);
    const stateTeamLinks = buildTeamLinks(boardPlayers, state.teams);
    this.latestStateTeamLinks = stateTeamLinks;
    const mergedLinks = this.mergeTeamLinks(stateTeamLinks);
    const currentKeySet = new Set(stateTeamLinks.map((link) => link.pairKey));
    const previousKeySet = this.prevStateTeamKeySet || new Set();
    const newRemoteLinks =
      previousKeySet.size > 0
        ? stateTeamLinks.filter((link) => !previousKeySet.has(link.pairKey))
        : [];

    this.setData({
      players: decoratedPlayers,
      teamLinks: mergedLinks,
      timeText: formatTimeLeft(state.timeLeft),
      hintText: state.feedText || '等待下一轮事件',
    });

    if (newRemoteLinks.length) {
      this.playRemoteTeamAnimation(newRemoteLinks[0]);
    }
    this.playRoundAudio(state);
    this.prevStateTeamKeySet = currentKeySet;
  },
  refreshVisibleScores(players, timeLeft, duration) {
    const list = Array.isArray(players) ? players : [];
    if (!list.length) {
      this.visibleScoreIdSet = new Set();
      this.scoreRevealPhase = -1;
      this.scoreRevealPlayerCount = 0;
      return;
    }
    const totalDuration = Number(duration) || 180;
    const elapsed = Math.max(0, totalDuration - (Number(timeLeft) || 0));
    const phase = Math.floor(elapsed / 30);
    const playerCount = list.length;
    if (phase === this.scoreRevealPhase && playerCount === this.scoreRevealPlayerCount) {
      return;
    }

    const others = list.filter((player) => !player.isSelf).map((player) => player.id);
    const revealCount = Math.min(getRevealCountByPlayerSize(playerCount), others.length);
    this.visibleScoreIdSet = new Set(pickRandomIds(others, revealCount));
    this.scoreRevealPhase = phase;
    this.scoreRevealPlayerCount = playerCount;
  },
  playRoundAudio(state) {
    if (!state || state.status !== 'playing') {
      return;
    }
    if (this.lastRound === -1) {
      this.lastRound = state.round;
      playCue('gameStart', {volume: 0.78});
      return;
    }
    if (state.round === this.lastRound) {
      return;
    }
    this.lastRound = state.round;
    const topEvent = Array.isArray(state.lastEvents) && state.lastEvents.length ? state.lastEvents[0] : null;
    if (!topEvent || typeof topEvent.delta !== 'number') {
      return;
    }
    const sign = topEvent.delta >= 0 ? 'pos' : 'neg';
    if (this.lastEventSign === sign && sign === 'pos') {
      playCue('pairOther', {volume: 0.6});
    } else if (sign === 'pos') {
      playCue('pairSelf', {volume: 0.72});
    } else {
      playCue('actionFail', {volume: 0.7});
    }
    this.lastEventSign = sign;
  },
  onToggleEmotePanel() {
    playCue('tap', {volume: 0.72});
    this.setData({emotePanelVisible: !this.data.emotePanelVisible});
  },
  onSendQuickEmote(e) {
    const key = e.currentTarget.dataset.key;
    const option = (this.data.quickEmotes || []).find((item) => item.key === key);
    if (!option) {
      return;
    }
    const selfPlayer = (this.data.players || []).find((player) => player.isSelf);
    if (!selfPlayer) {
      return;
    }
    playCue('tap', {volume: 0.72});
    this.setPlayerEmote(selfPlayer.id, option.text);
    this.setData({
      emotePanelVisible: false,
      actionHintText: `你发送了互动：${option.label}`,
    });
  },
  setPlayerEmote(playerId, text) {
    if (!playerId) {
      return;
    }
    this.emoteMap[playerId] = text || '';
    const players = (this.data.players || []).map((player) =>
      player.id === playerId ? {...player, emoteText: this.emoteMap[playerId]} : player
    );
    this.setData({players});
    if (this.emoteTimerMap[playerId]) {
      clearTimeout(this.emoteTimerMap[playerId]);
    }
    this.emoteTimerMap[playerId] = setTimeout(() => {
      delete this.emoteMap[playerId];
      delete this.emoteTimerMap[playerId];
      const nextPlayers = (this.data.players || []).map((player) =>
        player.id === playerId ? {...player, emoteText: ''} : player
      );
      this.setData({players: nextPlayers});
    }, 2200);
  },
  scheduleRemoteEmote() {
    this.clearRemoteEmoteTimer();
    const state = gameStore.getState();
    if (!state || state.status !== 'playing') {
      return;
    }
    const delay = randomInt(8000, 14000);
    this.remoteEmoteTimer = setTimeout(() => {
      const players = this.data.players || [];
      const options = players.filter((player) => !player.isSelf);
      if (options.length) {
        const target = randomPick(options);
        const emote = randomPick(this.data.quickEmotes || QUICK_EMOTES);
        if (target && emote) {
          this.setPlayerEmote(target.id, emote.text);
        }
      }
      this.remoteEmoteTimer = null;
      this.scheduleRemoteEmote();
    }, delay);
  },
  clearRemoteEmoteTimer() {
    if (this.remoteEmoteTimer) {
      clearTimeout(this.remoteEmoteTimer);
      this.remoteEmoteTimer = null;
    }
  },
  clearEmoteTimers() {
    this.clearRemoteEmoteTimer();
    Object.keys(this.emoteTimerMap || {}).forEach((playerId) => {
      clearTimeout(this.emoteTimerMap[playerId]);
    });
    this.emoteTimerMap = {};
    this.emoteMap = {};
    if (Array.isArray(this.data.players) && this.data.players.length) {
      this.setData({
        players: this.data.players.map((player) => ({...player, emoteText: ''})),
      });
    }
  },
  onPlayerTap(e) {
    playCue('tap', {volume: 0.75});
    const targetId = e.currentTarget.dataset.playerId;
    const players = this.data.players || [];
    if (!players.length || !targetId) {
      return;
    }

    const selfPlayer = players.find((player) => player.isSelf) || players[0];
    const targetPlayer = players.find((player) => player.id === targetId);
    if (!selfPlayer || !targetPlayer || selfPlayer.id === targetPlayer.id) {
      return;
    }
    if (targetPlayer.showScore) {
      playCue('actionFail', {volume: 0.72});
      this.setData({actionHintText: '该玩家分数已暴露，不能发起组队'});
      return;
    }

    const selfManualLink = findSelfManualLink(selfPlayer.id, this.manualTeamLinkMap);
    const manualMateId = selfManualLink
      ? getMateIdFromPairKey(selfManualLink.pairKey, selfPlayer.id)
      : '';
    const stateMateId = this.selfTeamDissolved ? '' : this.selfStateTeammateId;
    const currentMateId = manualMateId || stateMateId;

    if (currentMateId && targetPlayer.id !== currentMateId) {
      const currentMate = players.find((player) => player.id === currentMateId);
      const currentMateName = currentMate ? currentMate.name : '当前队友';
      const nextTargetId = targetPlayer.id;
      const nextTargetName = targetPlayer.name;
      wx.showModal({
        title: '切换组队',
        content: `当前已与${currentMateName}组队，是否先解除并向${nextTargetName}发起邀请？`,
        confirmText: '确认切换',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) {
            return;
          }
          this.dissolveCurrentTeam({
            selfPlayer,
            mateId: currentMateId,
            mateName: currentMateName,
            manualLink: selfManualLink,
          });
          const latestPlayers = this.data.players || [];
          const nextTargetPlayer =
            latestPlayers.find((player) => player.id === nextTargetId) || targetPlayer;
          this.startManualInvite(selfPlayer, nextTargetPlayer);
        },
      });
      return;
    }

    if (currentMateId && targetPlayer.id === currentMateId) {
      wx.showModal({
        title: '解除组队',
        content: `确定解除与${targetPlayer.name}的组队吗？`,
        confirmText: '解除',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) {
            return;
          }
          this.dissolveCurrentTeam({
            selfPlayer,
            mateId: currentMateId,
            mateName: targetPlayer.name,
            manualLink: selfManualLink,
          });
        },
      });
      return;
    }

    this.startManualInvite(selfPlayer, targetPlayer);
  },
  dissolveCurrentTeam({selfPlayer, mateId, mateName, manualLink}) {
    const stateMateId = this.selfTeamDissolved ? '' : this.selfStateTeammateId;
    if (manualLink) {
      delete this.manualTeamLinkMap[manualLink.pairKey];
    } else if (stateMateId && this.selfStatePairKey) {
      this.selfTeamDissolved = true;
      this.hiddenStatePairKeys.add(this.selfStatePairKey);
    }
    playCue('remoteDissolve', {volume: 0.68});
    this.setData({
      actionHintText: `已解除与 ${mateName || '队友'} 的组队`,
      teamLinks: this.mergeTeamLinks(this.latestStateTeamLinks),
      inviteLink: null,
      successLink: null,
      successToast: null,
    });
  },
  startManualInvite(selfPlayer, targetPlayer) {
    if (!selfPlayer || !targetPlayer) {
      return;
    }
    if (targetPlayer.showScore) {
      playCue('actionFail', {volume: 0.72});
      this.setData({actionHintText: '该玩家分数已暴露，不能发起组队'});
      return;
    }
    const pairKey = [selfPlayer.id, targetPlayer.id].sort().join('::');
    if (this.manualTeamLinkMap && this.manualTeamLinkMap[pairKey]) {
      delete this.manualTeamLinkMap[pairKey];
      playCue('remoteDissolve', {volume: 0.68});
      this.setData({
        actionHintText: `已取消与 ${targetPlayer.name} 的组队`,
        teamLinks: this.mergeTeamLinks(this.latestStateTeamLinks),
        inviteLink: null,
        successLink: null,
        successToast: null,
      });
      return;
    }
    const manualLink = {
      id: `manual-${pairKey}`,
      pairKey,
      fromName: selfPlayer.name,
      toName: targetPlayer.name,
      style: buildLinkStyle(selfPlayer, targetPlayer),
    };
    this.playInviteAnimation(manualLink, {
      inviteText: `向 ${targetPlayer.name} 发起组队邀请...`,
      successText: `${selfPlayer.name} 与 ${targetPlayer.name} 组队成功`,
      persistOnSuccess: true,
    });
  },
  onTapFortuneBag() {
    playCue('tap', {volume: 0.76});
    const bag = this.data.fortuneBag;
    const players = this.data.players || [];
    if (!bag || !players.length) {
      return;
    }

    if (this.data.activePosition) {
      const position = this.data.activePosition;
      this.clearBagTimers();
      this.setData({
        fortuneBag: null,
        emotePanelVisible: false,
        actionHintText: `发现卖出机会：${position.name}`,
      });
      this.onSellPosition();
      return;
    }

    const selfPlayer = players.find((player) => player.isSelf) || players[0];
    const selfScore = parseScoreText(selfPlayer ? selfPlayer.score : 0);
    const opportunity = buildOpportunity(selfScore);
    this.clearBagTimers();
    this.setData({
      fortuneBag: null,
      activeOpportunity: opportunity,
      emotePanelVisible: false,
      actionHintText: `发现福袋机会：${opportunity.category}`,
    });
  },
  onCloseOpportunity() {
    this.setData({activeOpportunity: null, actionHintText: ''});
    this.scheduleNextBagDrop();
  },
  onConfirmOpportunity() {
    const opportunity = this.data.activeOpportunity;
    if (!opportunity) {
      return;
    }

    const rawPlayers = gameStore.getState().players || [];
    const selfPlayer = rawPlayers.find((player) => player.isSelf) || rawPlayers[0];
    if (!selfPlayer) {
      this.onCloseOpportunity();
      return;
    }

    const currentScore = Number(selfPlayer.score || 0);
    const cost = Number(opportunity.cost || 0);
    if (cost <= 0) {
      return;
    }
    if (currentScore < cost) {
      playCue('actionFail', {volume: 0.74});
      wx.showToast({title: '分数不足，无法买入', icon: 'none'});
      return;
    }
    gameStore.applyPlayerScoreDelta(selfPlayer.id, -cost, {
      feedText: `买入(${opportunity.name}) -${cost}`,
    });
    playCue('pairOther', {volume: 0.68});
    const position = {
      id: `pos-${Date.now()}`,
      ownerId: selfPlayer.id,
      category: opportunity.category,
      name: opportunity.name,
      riskLevel: opportunity.riskLevel,
      riskText: opportunity.riskText,
      cost,
      buyAt: Date.now(),
    };
    this.setData({
      activeOpportunity: null,
      activePosition: position,
      actionHintText: `已买入${opportunity.name}，等待下次福袋出现后卖出`,
      successToast: {
        text: `买入-${cost}`,
        x: BOARD_LAYOUT.centerX,
        y: BOARD_LAYOUT.centerY,
      },
    });
    this.successTimer = setTimeout(() => {
      this.setData({successToast: null, actionHintText: ''});
      this.successTimer = null;
    }, 1300);
    this.scheduleNextBagDrop();
  },
  onSellPosition() {
    const position = this.data.activePosition;
    if (!position) {
      return;
    }
    const result = settlePosition(position);
    gameStore.applyPlayerScoreDelta(position.ownerId, result.proceeds, {
      feedText: `卖出(${position.name}) +${result.proceeds}，净${result.pnlText}`,
    });
    if (result.pnl >= 0) {
      playCue('pairSelf', {volume: 0.78});
    } else {
      playCue('actionFail', {volume: 0.74});
    }
    this.setData({
      activePosition: null,
      actionHintText: `卖出已结算，净收益 ${result.pnlText}`,
      successToast: {
        text: `卖出${result.pnlText}`,
        x: BOARD_LAYOUT.centerX,
        y: BOARD_LAYOUT.centerY,
      },
    });
    this.successTimer = setTimeout(() => {
      this.setData({successToast: null, actionHintText: ''});
      this.successTimer = null;
    }, 1400);
    this.scheduleNextBagDrop();
  },
  scheduleNextBagDrop() {
    this.clearBagTimers();
    const state = gameStore.getState();
    if (!state || state.status !== 'playing' || this.data.activeOpportunity) {
      return;
    }
    const delay = randomInt(5000, 9000);
    this.bagSpawnTimer = setTimeout(() => {
      const nextState = gameStore.getState();
      if (!nextState || nextState.status !== 'playing') {
        return;
      }
      const bag = buildFortuneBagByPlayers(this.data.timeText || 't', this.data.players || []);
      this.setData({fortuneBag: bag});
      playCue('invite', {volume: 0.58});
      this.bagExpireTimer = setTimeout(() => {
        this.setData({fortuneBag: null});
        this.bagExpireTimer = null;
        this.scheduleNextBagDrop();
      }, 8000);
      this.bagSpawnTimer = null;
    }, delay);
  },
  clearBagTimers() {
    if (this.bagSpawnTimer) {
      clearTimeout(this.bagSpawnTimer);
      this.bagSpawnTimer = null;
    }
    if (this.bagExpireTimer) {
      clearTimeout(this.bagExpireTimer);
      this.bagExpireTimer = null;
    }
  },
  playRemoteTeamAnimation(link) {
    if (!link) {
      return;
    }
    this.playInviteAnimation(link, {
      inviteText: `${link.fromName} 向 ${link.toName} 发起组队邀请...`,
      successText: `${link.fromName} 与 ${link.toName} 组队成功`,
      persistOnSuccess: false,
    });
  },
  playInviteAnimation(link, options = {}) {
    if (!link) {
      return;
    }

    this.clearInviteTimers();
    const inviteText = options.inviteText || '发起组队邀请...';
    const successText = options.successText || '组队成功';
    const persistOnSuccess = options.persistOnSuccess === true;

    this.setData({
      actionHintText: inviteText,
      inviteLink: {style: link.style},
      successLink: null,
      successToast: null,
    });
    playCue('invite', {volume: 0.65});

    this.inviteTimer = setTimeout(() => {
      if (persistOnSuccess) {
        this.manualTeamLinkMap[link.pairKey] = link;
        playCue('pairSelf', {volume: 0.78});
      } else {
        playCue('pairOther', {volume: 0.74});
      }

      this.setData({
        teamLinks: this.mergeTeamLinks(this.latestStateTeamLinks),
        actionHintText: successText,
        inviteLink: null,
        successLink: {style: link.style},
        successToast: {
          text: '组队成功',
          x: Math.round((this.extractMidpoint(link.style).x || BOARD_LAYOUT.centerX)),
          y: Math.round((this.extractMidpoint(link.style).y || BOARD_LAYOUT.centerY)),
        },
      });
      this.successTimer = setTimeout(() => {
        this.setData({
          actionHintText: '',
          successLink: null,
          successToast: null,
        });
        this.successTimer = null;
      }, 1400);
      this.inviteTimer = null;
    }, 700);
  },
  extractMidpoint(styleText) {
    const leftMatch = /left:([\d.]+)rpx/.exec(styleText || '');
    const topMatch = /top:([\d.]+)rpx/.exec(styleText || '');
    return {
      x: leftMatch ? Number(leftMatch[1]) : BOARD_LAYOUT.centerX,
      y: topMatch ? Number(topMatch[1]) : BOARD_LAYOUT.centerY,
    };
  },
  mergeTeamLinks(stateTeamLinks) {
    const hiddenKeys = this.hiddenStatePairKeys || new Set();
    const base = (stateTeamLinks || []).filter((link) => !hiddenKeys.has(link.pairKey));
    const stateKeys = new Set(base.map((link) => link.pairKey));
    const manual = Object.values(this.manualTeamLinkMap || {}).filter(
      (link) => !stateKeys.has(link.pairKey)
    );
    return [...base, ...manual];
  },
  clearInviteTimers() {
    if (this.inviteTimer) {
      clearTimeout(this.inviteTimer);
      this.inviteTimer = null;
    }
    if (this.successTimer) {
      clearTimeout(this.successTimer);
      this.successTimer = null;
    }
  },
  unsubscribeStore() {
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  },
  toResult() {
    playCue('tap', {volume: 0.75});
    playCue('resultWin', {volume: 0.82});
    gameStore.finishGame();
    wx.redirectTo({url: '/pages/result/index'});
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/arena/index') {
      return;
    }

    if (page === '/pages/result/index') {
      const snapshot = gameStore.getState();
      if (snapshot.status !== 'finished') {
        playCue('resultWin', {volume: 0.82});
        gameStore.finishGame();
      }
      wx.redirectTo({url: page});
      return;
    }

    wx.redirectTo({url: page});
  },
});
