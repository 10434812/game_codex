const {getNavLayout} = require('../../utils/nav');
const {
  buildStageThemeStyle,
  DEFAULT_AVATAR,
  DEFAULT_STAGE,
  MATCH_MODE_TEXT,
  NAV_TABS,
  resolveStage,
} = require('../../utils/constants');
const {buildVisibleScoreState} = require('../../utils/game-engine');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const {playCue, playStageBgm, playVoice, playVibrate} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');
const api = require('../../utils/api-client');
const {
  BOARD_LAYOUT,
  applySelfDecorations,
  buildBoardPlayers,
  buildFortuneBagByPlayers,
} = require('../../utils/board-layout');
const {
  buildLinkStyle,
  buildTeamLinks,
  findSelfManualLink,
  findSelfTeamInfo,
  getMateIdFromPairKey,
  mergeTeamLinks,
} = require('../../utils/team-link');
const {buildOpportunity, buildOpportunityFromReality, getFortuneBagAsset, settlePosition} = require('../../utils/investment');
const {QUICK_EMOTES, chooseRemoteEmote, randomInt} = require('../../utils/emote');
const {saveStageTheme} = require('../../utils/stage-theme');
const guideStore = require('../../utils/guide-store');
const fortuneReality = require('../../utils/fortune-reality');

function formatTimeLeft(timeLeft) {
  return `${Math.max(0, Number(timeLeft) || 0)}s`;
}

function formatHoldTime(position) {
  if (!position || !position.buyAt) {
    return '0秒';
  }
  const holdSeconds = Math.max(0, Math.floor((Date.now() - Number(position.buyAt)) / 1000));
  return holdSeconds < 60 ? `${holdSeconds}秒` : `${Math.floor(holdSeconds / 60)}分${holdSeconds % 60}秒`;
}

function parseScoreText(scoreText) {
  const value = Number(String(scoreText || '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function buildPlayersSignature(players) {
  return JSON.stringify(players || []);
}

function buildLinksSignature(links) {
  return JSON.stringify(links || []);
}

function assignIfChanged(patch, currentData, key, value) {
  if (!currentData || currentData[key] !== value) {
    patch[key] = value;
  }
}

let arenaSessionId = '';

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    modeText: MATCH_MODE_TEXT,
    stageImage: DEFAULT_STAGE.image,
    stageVideo: DEFAULT_STAGE.video || '',
    stageThemeKey: DEFAULT_STAGE.theme.key,
    stageThemeStyle: buildStageThemeStyle(DEFAULT_STAGE),
    players: [],
    teamLinks: [],
    inviteLink: null,
    successLink: null,
    successToast: null,
    emotePanelVisible: false,
    quickEmotes: QUICK_EMOTES,
    quickReplyOptions: QUICK_EMOTES.slice(0, 3),
    chatMessages: [],
    messageCardCollapsed: true,
    fortuneBag: null,
    activeOpportunity: null,
    activePosition: null,
    activePositionHoldText: '0秒',
    timeText: '180s',
    hintText: '等待开始',
    actionHintText: '',
    fortunePanelVisible: false,
    fortunePanelPhase: 'closed',
    fortuneBagCountdownText: '10s',
    fortunePanelAsset: '',
    tabs: NAV_TABS,
    activeTab: 'play',
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    defaultAvatar: DEFAULT_AVATAR,
    shopDisplay: shopStore.getEquippedDisplay(),
    guideTeamVisible: false,
    guideBagVisible: false,
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
    this.visibleScoreState = {
      phase: -1,
      playerCount: 0,
      visibleIds: [],
    };
    this.lastPlayersSignature = '';
    this.lastTeamLinksSignature = '';
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    fortuneReality.fetchFortuneReality(true).catch(() => {});
  },
  onShow() {
    this.syncUserProfile();
    this.syncShopDisplay();
    this.syncStageMusic();

    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    arenaSessionId = (currentPage.options || {}).sessionId || '';

    if (arenaSessionId) {
      this.startArenaPolling(arenaSessionId);
    } else {
      // Local mode: subscribe to gameStore for state updates
      this.localMode = true;
      this.unsubscribeStore();
      this.storeUnsubscribe = gameStore.subscribe((state) => {
        if (state.status === 'playing') {
          this.syncArena(state);
        } else if (state.status === 'finished') {
          guideStore.advanceTo(guideStore.GUIDE_STEPS.RESULT);
          this.clearBagTimers();
          this.clearEmoteTimers();
          wx.redirectTo({url: '/pages/result/index'});
        }
      });
      const snapshot = gameStore.getState();
      if (snapshot.status === 'playing') {
        this.syncArena(snapshot);
      }
    }

    this.scheduleNextBagDrop();
    this.scheduleRemoteEmote();
    this.syncGuide();
    fortuneReality.fetchFortuneReality(false).catch(() => {});
  },
  onHide() {
    this.clearArenaPolling();
    this.clearInviteTimers();
    this.clearBagTimers();
    this.clearFortunePanelTimers();
    this.clearEmoteTimers();
    this.setData({
      fortuneBag: null,
      activeOpportunity: null,
      fortunePanelVisible: false,
      fortunePanelPhase: 'closed',
      fortunePanelAsset: '',
      emotePanelVisible: false,
      fortuneBagCountdownText: '10s',
    });
    this.unsubscribeStore();
  },
  onUnload() {
    this.clearArenaPolling();
    this.clearInviteTimers();
    this.clearBagTimers();
    this.clearFortunePanelTimers();
    this.clearEmoteTimers();
    this.clearRemoteEmoteTimer();
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
  syncStageMusic() {
    const snapshot = gameStore.getState();
    playStageBgm(snapshot.stage || DEFAULT_STAGE, {volume: 0.38});
  },
  syncGuide() {
    this.setData({
      guideTeamVisible: guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ARENA_TEAM),
      guideBagVisible: guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ARENA_BAG) && !!this.data.fortuneBag,
    });
  },
  onGuideTeamPrimary() {
    guideStore.advanceTo(guideStore.GUIDE_STEPS.ARENA_BAG);
    this.setData({
      guideTeamVisible: false,
      guideBagVisible: !!this.data.fortuneBag,
    });
  },
  onGuideBagPrimary() {
    this.onTapFortuneBag();
  },
  startArenaPolling(sessionId) {
    this.clearArenaPolling();
    this.fetchArenaState(sessionId);
    this.arenaPollTimer = setInterval(() => {
      this.fetchArenaState(sessionId);
    }, 1000);
  },
  async fetchArenaState(sessionId) {
    if (!sessionId) {
      return;
    }
    try {
      const state = await api.get(`/games/${sessionId}`);
      if (String(sessionId) !== String(arenaSessionId)) {
        return;
      }
      if (state && state.status === 'finished') {
        guideStore.advanceTo(guideStore.GUIDE_STEPS.RESULT);
        this.clearBagTimers();
        this.clearEmoteTimers();
        this.clearArenaPolling();
        wx.redirectTo({url: `/pages/result/index?sessionId=${sessionId}`});
        return;
      }
      if (state && Array.isArray(state.players) && Array.isArray(state.teams)) {
        this.syncArena(state);
      }
    } catch (err) {
      console.warn('[arena] poll state error:', err);
    }
  },
  clearArenaPolling() {
    if (this.arenaPollTimer) {
      clearInterval(this.arenaPollTimer);
      this.arenaPollTimer = null;
    }
  },
  sendEmoteToBackend(emoteId) {
    if (!arenaSessionId || !emoteId) {
      return;
    }
    api.post(`/games/${arenaSessionId}/emotes`, {emoteId}).catch(() => {});
  },
  onTapProfile() {
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapShop() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
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

    if (snapshot.status === 'idle') {
      gameStore.ensureRoom(snapshot.stage || DEFAULT_STAGE);
    }

    wx.redirectTo({url: '/pages/room/index'});
    return null;
  },
  syncArena(state) {
    const stage = resolveStage(state.stage || gameStore.getState().stage || DEFAULT_STAGE);
    const theme = saveStageTheme(stage);
    const selfTeamInfo = findSelfTeamInfo(state);
    this.selfId = selfTeamInfo.selfId;
    this.selfStateTeammateId = selfTeamInfo.teammateId;
    if (selfTeamInfo.pairKey !== this.selfStatePairKey) {
      this.selfStatePairKey = selfTeamInfo.pairKey;
      this.selfTeamDissolved = false;
      this.hiddenStatePairKeys.clear();
    }

    const nextVisibleState = buildVisibleScoreState(
      state.players,
      state.timeLeft,
      state.duration,
      this.visibleScoreState
    );
    if (nextVisibleState.changed) {
      this.visibleScoreIdSet = new Set(nextVisibleState.visibleIds);
    }
    this.visibleScoreState = {
      phase: nextVisibleState.phase,
      playerCount: nextVisibleState.playerCount,
      visibleIds: nextVisibleState.visibleIds,
    };

    const boardPlayers = buildBoardPlayers(state.players, this.emoteMap, this.visibleScoreIdSet);
    const decoratedPlayers = applySelfDecorations(boardPlayers, this.data.shopDisplay);
    const stateTeamLinks = buildTeamLinks(boardPlayers, state.teams);
    this.latestStateTeamLinks = stateTeamLinks;
    const mergedLinks = mergeTeamLinks(stateTeamLinks, this.manualTeamLinkMap, this.hiddenStatePairKeys);
    const currentKeySet = new Set(stateTeamLinks.map((link) => link.pairKey));
    const previousKeySet = this.prevStateTeamKeySet || new Set();
    const newRemoteLinks = previousKeySet.size > 0
      ? stateTeamLinks.filter((link) => !previousKeySet.has(link.pairKey))
      : [];

    const nextPatch = {};
    assignIfChanged(nextPatch, this.data, 'timeText', formatTimeLeft(state.timeLeft));
    assignIfChanged(nextPatch, this.data, 'stageImage', theme.stageImage);
    assignIfChanged(nextPatch, this.data, 'stageVideo', theme.stageVideo);
    assignIfChanged(nextPatch, this.data, 'stageThemeKey', theme.stageThemeKey);
    assignIfChanged(nextPatch, this.data, 'stageThemeStyle', theme.stageThemeStyle);
    assignIfChanged(
      nextPatch,
      this.data,
      'hintText',
      state.feedText || `等待下一轮事件（${state.modeText || MATCH_MODE_TEXT}）`
    );
    assignIfChanged(nextPatch, this.data, 'modeText', state.modeText || MATCH_MODE_TEXT);
    assignIfChanged(
      nextPatch,
      this.data,
      'activePositionHoldText',
      formatHoldTime(this.data.activePosition)
    );

    const nextPlayersSignature = buildPlayersSignature(decoratedPlayers);
    if (nextPlayersSignature !== this.lastPlayersSignature) {
      nextPatch.players = decoratedPlayers;
      this.lastPlayersSignature = nextPlayersSignature;
    }

    const nextTeamLinksSignature = buildLinksSignature(mergedLinks);
    if (nextTeamLinksSignature !== this.lastTeamLinksSignature) {
      nextPatch.teamLinks = mergedLinks;
      this.lastTeamLinksSignature = nextTeamLinksSignature;
    }

    if (Object.keys(nextPatch).length) {
      this.setData(nextPatch);
    }

    if (newRemoteLinks.length) {
      this.playRemoteTeamAnimation(newRemoteLinks[0]);
    }
    this.playRoundAudio(state);
    this.prevStateTeamKeySet = currentKeySet;
  },
  playRoundAudio(state) {
    if (!state || state.status !== 'playing') {
      return;
    }
    if (this.lastRound === -1) {
      this.lastRound = state.round;
      playCue('gameStart', {volume: 0.78});
      playVoice('arenaStart', {debounceMs: 0});
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
    playVibrate('light');
    this.setData({emotePanelVisible: !this.data.emotePanelVisible});
  },
  onToggleMessageCard() {
    playCue('tap', {volume: 0.72});
    playVibrate('light');
    this.setData({
      messageCardCollapsed: !this.data.messageCardCollapsed,
    });
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
    playVibrate('light');
    this.setPlayerEmote(selfPlayer.id, option.text);
    this.sendEmoteToBackend(option.key);
    this.setData({
      emotePanelVisible: false,
      actionHintText: `你发送了消息：${option.label}`,
    });
  },
  setPlayerEmote(playerId, text) {
    if (!playerId) {
      return;
    }
    this.emoteMap[playerId] = text || '';
    if (this.emoteMap[playerId]) {
      this.appendChatMessage(playerId, this.emoteMap[playerId]);
    }
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
  appendChatMessage(playerId, text) {
    const content = String(text || '').trim();
    if (!content) {
      return;
    }
    const players = this.data.players || [];
    const sender = players.find((player) => player.id === playerId);
    const senderName = sender ? (sender.isSelf ? '我' : sender.name) : '队友';
    const nextMessage = {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      sender: senderName,
      text: content,
      isSelf: !!(sender && sender.isSelf),
    };
    const current = Array.isArray(this.data.chatMessages) ? this.data.chatMessages : [];
    this.setData({
      chatMessages: [...current, nextMessage].slice(-8),
    });
  },
  scheduleRemoteEmote() {
    this.clearRemoteEmoteTimer();
    const state = gameStore.getState();
    if (!state || state.status !== 'playing') {
      return;
    }
    const delay = randomInt(8000, 14000);
    this.remoteEmoteTimer = setTimeout(() => {
      const picked = chooseRemoteEmote(this.data.players, this.data.quickEmotes || QUICK_EMOTES);
      if (picked) {
        this.setPlayerEmote(picked.playerId, picked.text);
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
    playVibrate('light');
    const targetId = e.currentTarget.dataset.playerId;
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ARENA_TEAM)) {
      guideStore.advanceTo(guideStore.GUIDE_STEPS.ARENA_BAG);
      this.setData({guideTeamVisible: false});
    }
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
      playVoice('actionUnavailable');
      this.setData({actionHintText: '该玩家已公开分数，暂不可发起组队'});
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
        title: '组队调整',
        content: `当前已与${currentMateName}组队，是否解除后向${nextTargetName}发起邀请？`,
        confirmText: '继续',
        cancelText: '暂不',
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
          const nextTargetPlayer = latestPlayers.find((player) => player.id === nextTargetId) || targetPlayer;
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
        cancelText: '保留',
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
  dissolveCurrentTeam({mateName, manualLink}) {
    const stateMateId = this.selfTeamDissolved ? '' : this.selfStateTeammateId;
    if (manualLink) {
      delete this.manualTeamLinkMap[manualLink.pairKey];
    } else if (stateMateId && this.selfStatePairKey) {
      this.selfTeamDissolved = true;
      this.hiddenStatePairKeys.add(this.selfStatePairKey);
    }
    playCue('remoteDissolve', {volume: 0.68});
    playVoice('teamDissolved');
    this.setData({
      actionHintText: `已解除与${mateName || '队友'}的组队关系`,
      teamLinks: mergeTeamLinks(this.latestStateTeamLinks, this.manualTeamLinkMap, this.hiddenStatePairKeys),
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
      playVoice('actionUnavailable');
      this.setData({actionHintText: '该玩家已公开分数，暂不可发起组队'});
      return;
    }
    const pairKey = [selfPlayer.id, targetPlayer.id].sort().join('::');
    if (this.manualTeamLinkMap && this.manualTeamLinkMap[pairKey]) {
      delete this.manualTeamLinkMap[pairKey];
      playCue('remoteDissolve', {volume: 0.68});
      playVoice('teamDissolved');
      this.setData({
        actionHintText: `已取消向${targetPlayer.name}发起的组队`,
        teamLinks: mergeTeamLinks(this.latestStateTeamLinks, this.manualTeamLinkMap, this.hiddenStatePairKeys),
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
      inviteText: `向${targetPlayer.name}发起组队邀请...`,
      successText: `${selfPlayer.name} 与 ${targetPlayer.name} 组队成功`,
      persistOnSuccess: true,
    });
  },
  onTapFortuneBag() {
    playCue('tap', {volume: 0.76});
    playVibrate('medium');
    const bag = this.data.fortuneBag;
    const players = this.data.players || [];
    if (!bag || !players.length) {
      return;
    }
    const selfPlayer = players.find((player) => player.isSelf) || players[0];
    const selfScore = parseScoreText(selfPlayer ? selfPlayer.score : 0);
    const opportunity = this.data.activePosition
      ? null
      : (bag.opportunity || this.data.activeOpportunity || this.buildNextOpportunity(selfScore));
    const panelAsset = this.data.activePosition
      ? (this.data.activePosition.asset || getFortuneBagAsset(this.data.activePosition.category))
      : (opportunity && opportunity.asset) || bag.asset || getFortuneBagAsset(opportunity && opportunity.category);
    this.showFortunePanel({
      activeOpportunity: opportunity,
      fortunePanelAsset: panelAsset,
      activePositionHoldText: formatHoldTime(this.data.activePosition),
      emotePanelVisible: false,
      actionHintText: this.data.activePosition
        ? `当前持仓可卖出：${this.data.activePosition.name}`
        : `检测到新机会：${opportunity.category}`,
    });
  },
  onCloseOpportunity() {
    this.hideFortunePanel({
      actionHintText: '',
    });
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

    const cost = Number(opportunity.cost || 0);
    if (cost <= 0) {
      return;
    }
    const debitResult = shopStore.applyCoinsDelta(-cost, {
      type: 'trade_buy',
      title: `买入${opportunity.name}`,
    });
    if (!debitResult.ok) {
      playCue('actionFail', {volume: 0.74});
      playVoice('actionUnavailable');
      wx.showToast({title: debitResult.message || '账户余额不足', icon: 'none'});
      return;
    }
    gameStore.applyPlayerScoreDelta(selfPlayer.id, -cost, {
      feedText: `买入(${opportunity.name}) -${cost}`,
      scoreType: 'investment',
    });
    playCue('pairOther', {volume: 0.68});
    playVoice('buySuccess');
    const position = {
      id: `pos-${Date.now()}`,
      ownerId: selfPlayer.id,
      category: opportunity.category,
      name: opportunity.name,
      riskLevel: opportunity.riskLevel,
      riskText: opportunity.riskText,
      cost,
      buyAt: Date.now(),
      asset: opportunity.asset,
    };
    this.showFortunePanel({
      activeOpportunity: null,
      activePosition: position,
      fortunePanelAsset: position.asset,
      activePositionHoldText: formatHoldTime(position),
      actionHintText: `已买入${opportunity.name}，当前可直接卖出`,
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
  },
  onSellPosition() {
    const position = this.data.activePosition;
    if (!position) {
      return;
    }
    const result = settlePosition(position);
    shopStore.applyCoinsDelta(result.proceeds, {
      type: 'trade_sell',
      title: `卖出${position.name}`,
    });
    gameStore.applyPlayerScoreDelta(position.ownerId, result.proceeds, {
      feedText: `卖出(${position.name}) +${result.proceeds}，净${result.pnlText}`,
      scoreType: 'investment',
    });
    if (result.pnl >= 0) {
      playCue('pairSelf', {volume: 0.78});
      playVoice('sellProfit');
    } else {
      playCue('actionFail', {volume: 0.74});
      playVoice('sellLoss');
    }
    this.hideFortunePanel({
      actionHintText: `卖出完成，净收益 ${result.pnlText}`,
      successToast: {
        text: `卖出${result.pnlText}`,
        x: BOARD_LAYOUT.centerX,
        y: BOARD_LAYOUT.centerY,
      },
    }, {
      activePosition: null,
      activeOpportunity: null,
      fortunePanelAsset: '',
      actionHintText: `卖出完成，净收益 ${result.pnlText}`,
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
    this.clearBagTimers();
    this.setData({fortuneBag: null, fortuneBagCountdownText: '10s'});
    this.scheduleNextBagDrop();
  },
  buildNextOpportunity(selfScore) {
    const realityOpportunity = fortuneReality.pickOpportunity();
    return realityOpportunity
      ? buildOpportunityFromReality(selfScore, realityOpportunity)
      : buildOpportunity(selfScore);
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
      const selfPlayer = (this.data.players || []).find((player) => player.isSelf) || (this.data.players || [])[0];
      const selfScore = parseScoreText(selfPlayer ? selfPlayer.score : 0);
      const opportunity = this.buildNextOpportunity(selfScore);
      const bag = buildFortuneBagByPlayers(this.data.timeText || 't', this.data.players || [], opportunity);
      this.fortuneBagExpiresAt = Date.now() + 10000;
      this.setData({
        fortuneBag: bag,
        fortuneBagCountdownText: formatTimeLeft(10),
      });
      this.syncGuide();
      playCue('invite', {volume: 0.58});
      playVoice('fortuneBag', {debounceMs: 3000});
      this.startFortuneBagCountdown();
      this.bagExpireTimer = setTimeout(() => {
        const hasActivePosition = !!this.data.activePosition;
        this.clearBagTimers();
        const expirePatch = {
          fortuneBag: null,
          fortunePanelAsset: '',
          fortuneBagCountdownText: '10s',
          actionHintText: hasActivePosition ? '当前持仓已保留，等待下一次红包' : '本次红包已结束',
        };
        if (this.data.fortunePanelVisible) {
          this.hideFortunePanel(expirePatch, {
            ...expirePatch,
            activeOpportunity: null,
          });
        } else {
          this.setData({
            ...expirePatch,
            activeOpportunity: null,
          });
        }
        this.syncGuide();
        this.scheduleNextBagDrop();
      }, 10000);
      this.bagSpawnTimer = null;
    }, delay);
  },
  startFortuneBagCountdown() {
    if (this.bagCountdownTimer) {
      clearInterval(this.bagCountdownTimer);
    }
    this.bagCountdownTimer = setInterval(() => {
      const expiresAt = Number(this.fortuneBagExpiresAt || 0);
      if (!expiresAt || !this.data.fortuneBag) {
        this.clearFortuneBagCountdown();
        return;
      }
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (remaining <= 0) {
        this.setData({fortuneBagCountdownText: '0s'});
        this.clearFortuneBagCountdown();
        return;
      }
      this.setData({fortuneBagCountdownText: formatTimeLeft(remaining)});
    }, 1000);
  },
  clearFortuneBagCountdown() {
    if (this.bagCountdownTimer) {
      clearInterval(this.bagCountdownTimer);
      this.bagCountdownTimer = null;
    }
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
    this.clearFortuneBagCountdown();
    this.fortuneBagExpiresAt = 0;
  },
  showFortunePanel(patch = {}) {
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ARENA_BAG)) {
      guideStore.advanceTo(guideStore.GUIDE_STEPS.RESULT);
      patch.guideBagVisible = false;
    }
    this.clearFortunePanelTimers();
    this.setData({
      ...patch,
      fortunePanelVisible: true,
      fortunePanelPhase: 'opening',
    });
    this.fortunePanelPhaseTimer = setTimeout(() => {
      this.fortunePanelPhaseTimer = null;
      if (!this.data.fortunePanelVisible) {
        return;
      }
      this.setData({fortunePanelPhase: 'open'});
    }, 420);
  },
  hideFortunePanel(patch = {}, afterClosePatch) {
    const closePatch = {
      ...(afterClosePatch || patch),
      fortunePanelVisible: false,
      fortunePanelPhase: 'closed',
    };
    if (!this.data.fortunePanelVisible) {
      this.clearFortunePanelTimers();
      this.setData(closePatch);
      return;
    }
    this.clearFortunePanelTimers();
    this.setData({
      ...patch,
      fortunePanelPhase: 'closing',
    });
    this.fortunePanelCloseTimer = setTimeout(() => {
      this.fortunePanelCloseTimer = null;
      this.setData(closePatch);
    }, 340);
  },
  clearFortunePanelTimers() {
    if (this.fortunePanelPhaseTimer) {
      clearTimeout(this.fortunePanelPhaseTimer);
      this.fortunePanelPhaseTimer = null;
    }
    if (this.fortunePanelCloseTimer) {
      clearTimeout(this.fortunePanelCloseTimer);
      this.fortunePanelCloseTimer = null;
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
      voice: false,
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
    const shouldPlayVoice = options.voice !== false;

    this.setData({
      actionHintText: inviteText,
      inviteLink: {style: link.style},
      successLink: null,
      successToast: null,
    });
    playCue('invite', {volume: 0.65});
    if (shouldPlayVoice) {
      playVoice('teamInvite');
    }

    const handshakeDelay = randomInt(480, 980);
    this.inviteTimer = setTimeout(() => {
      if (persistOnSuccess) {
        this.manualTeamLinkMap[link.pairKey] = link;
        playCue('pairSelf', {volume: 0.78});
      } else {
        playCue('pairOther', {volume: 0.74});
      }
      if (shouldPlayVoice) {
        playVoice('teamSuccess');
      }

      this.setData({
        teamLinks: mergeTeamLinks(this.latestStateTeamLinks, this.manualTeamLinkMap, this.hiddenStatePairKeys),
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
    }, handshakeDelay);
  },
  extractMidpoint(styleText) {
    const leftMatch = /left:([\d.]+)rpx/.exec(styleText || '');
    const topMatch = /top:([\d.]+)rpx/.exec(styleText || '');
    return {
      x: leftMatch ? Number(leftMatch[1]) : BOARD_LAYOUT.centerX,
      y: topMatch ? Number(topMatch[1]) : BOARD_LAYOUT.centerY,
    };
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
    if (typeof this.storeUnsubscribe === 'function') {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
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
    playVibrate('light');
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
