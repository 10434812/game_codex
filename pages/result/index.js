const {prepareResultImage} = require('../../utils/result-share-image');
const {resultCard, resultShareTitle} = require('../../utils/result-share-card');
const analytics = require('../../utils/analytics');
const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const privacyConsent = require('../../utils/privacy-consent');
const {DEFAULT_AVATAR, DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS, resolveStage} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const playerStats = require('../../utils/player-stats');
const {playCue, playVoice, stopBgm, playVibrate, createEffectAudio} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');
const {buildExpProgress} = require('../../utils/progression');
const {formatNumber} = require('../../utils/format');
const {buildAchievementMedal} = require('../../utils/achievement-medals');
const runtimeConfig = require('../../utils/runtime-config');
const {enableShareMenu, buildShareAppMessage, buildShareTimeline} = require('../../utils/share-config');
const {createStageThemeData, loadStageTheme, saveStageTheme} = require('../../utils/stage-theme');
const guideStore = require('../../utils/guide-store');
const {performanceFeedback} = require('../../utils/arena-feedback');
const {selectGrowthGoal} = require('../../utils/growth-goal');

// 烟花颜色配置
const FIREWORK_COLORS = [
  '#FFD700', // 金色
  '#FF6B6B', // 红色
  '#4ECDC4', // 青色
  '#45B7D1', // 蓝色
  '#96CEB4', // 绿色
  '#FFEAA7', // 黄色
  '#DDA0DD', // 粉紫
  '#FF8C00', // 橙色
];

const FIREWORK_MAX_AUDIO_BURSTS = 3;
const DEFAULT_STAGE_THEME_DATA = createStageThemeData(DEFAULT_STAGE);

// 生成单个烟花
function createFirework(index) {
  const particleCount = 8 + Math.floor(Math.random() * 5);
  const particles = [];
  const baseAngle = (360 / particleCount);

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      angle: baseAngle * i + Math.random() * 20 - 10,
      color: FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)],
      size: 8 + Math.random() * 8,
      pDelay: Math.random() * 100,
    });
  }

  return {
    id: `fw_${Date.now()}_${index}`,
    left: 100 + Math.random() * 550,
    top: 100 + Math.random() * 300,
    delay: index * 300 + Math.random() * 200,
    particles,
  };
}

// 生成一批烟花
function generateFireworks(count) {
  const fireworks = [];
  for (let i = 0; i < count; i++) {
    fireworks.push(createFirework(i));
  }
  return fireworks;
}

function generateKoiBlessings() {
  return [
    {id: 'coin_1', label: '福', left: 76, delay: 0},
    {id: 'coin_2', label: '喜', left: 198, delay: 160},
    {id: 'coin_3', label: '运', left: 512, delay: 80},
    {id: 'coin_4', label: '鲤', left: 636, delay: 240},
    {id: 'coin_5', label: '财', left: 332, delay: 320},
  ];
}

function findSelfRank(payload = {}) {
  if (Number(payload.rank) > 0) {
    return Number(payload.rank);
  }

  const ranking = Array.isArray(payload.ranking) ? payload.ranking : [];
  const rankedSelf = ranking.find((player) => player && player.isSelf);
  if (rankedSelf && Number(rankedSelf.rank) > 0) {
    return Number(rankedSelf.rank);
  }

  if (payload.top3 && payload.top3.first && payload.top3.first.isSelf) {
    return 1;
  }

  return 0;
}

function createEmptyTop3() {
  return {
    first: {
      name: '--',
      score: '0',
      avatar: 'https://xcx.ukb88.com/assets/bg/avatars/avatar_01.png',
    },
    second: {
      name: '--',
      score: '0',
      avatar: 'https://xcx.ukb88.com/assets/bg/avatars/avatar_02.png',
    },
    third: {
      name: '--',
      score: '0',
      avatar: 'https://xcx.ukb88.com/assets/bg/avatars/avatar_03.png',
    },
  };
}

function formatSigned(value) {
  const amount = Number(value || 0);
  if (amount > 0) {
    return `+${formatNumber(amount)}`;
  }
  if (amount < 0) {
    return `-${formatNumber(Math.abs(amount))}`;
  }
  return '0';
}

function createDefaultMedal() {
  return buildAchievementMedal({
    stageName: '万里长城',
    achievement: '长城守望者',
    gain: 0,
    rank: 0,
  });
}

function createResultMedal(result = {}) {
  if (result.achievementMedal) {
    return result.achievementMedal;
  }
  return buildAchievementMedal({
    stage: result.stage,
    stageName: result.stageName,
    achievement: result.achievement,
    gain: result.gain,
    rank: result.rank,
  });
}

function getStageFromResult(payload = {}) {
  if (payload.stage) {
    return payload.stage;
  }
  if (payload.stageId || payload.stageName) {
    return {
      id: payload.stageId,
      name: payload.stageName,
    };
  }
  return null;
}

function getFallbackStage() {
  const state = gameStore.getState();
  return loadStageTheme((state && state.stage) || DEFAULT_STAGE);
}

function buildSavedThemePatch(stage) {
  const theme = saveStageTheme(stage || getFallbackStage());
  return {
    stageName: theme.stageName,
    stageImage: theme.stageImage,
    stageVideo: theme.stageVideo,
    stageThemeKey: theme.stageThemeKey,
    stageThemeStyle: theme.stageThemeStyle,
  };
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    top3: createEmptyTop3(),
    rankList: [],
    modeText: '对局结算',
    tabs: NAV_TABS,
    activeTab: 'history', navExpanded: false,
    stageName: DEFAULT_STAGE_THEME_DATA.stageName,
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
    resultId: '',
    interrupted: false,
    resultTitle: '本局结算',
    selfRank: 0,
    resultReason: '',
    performance: null,
    replayPending: false,
    replayError: '',
    replayNewRoom: false,
    matchmaking: false,
    growthGoal: null,
    passport: null,
    expError: '',
    gainText: '0',
    incomeText: '🐟锦鲤币 0',
    incomeAmountText: '0',
    achievementText: '--',
    achievementMedal: createDefaultMedal(),
    totalText: '总计 0 玩家',
    expProgress: {
      level: 1,
      current: 0,
      required: 120,
      left: 120,
      percent: 0,
    },
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    defaultAvatar: DEFAULT_AVATAR,
    showScorePopup: false,
    selectedPlayer: null,
    selectedPerformance: null,
    hasScoreBreakdown: false,
    scoreBreakdown: {
      round: '0',
      teamBonus: '0',
      investment: '0',
      fortuneBag: '0',
    },
    showFireworks: false,
    fireworkParticles: [],
    showKoiEffect: false,
    koiCtaVisible: false,
    isKoiWinner: false,
    koiBlessings: generateKoiBlessings(),
    guideVisible: false,
  },
  onLoad(options = {}) {
    this.pageActive = true;
    this.onlineSessionId = String(options.sessionId || '');
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    if (!privacyConsent.canEnter()) return;
    runtimeConfig.fetchRemoteConfig().finally(() => {
      enableShareMenu();
    });
  },
  async onShow() {
    this.pageActive = true;
    this.setData({replayPending: false});
    if (!privacyConsent.canEnter()) return;
    this.syncUserProfile();
    stopBgm();
    await this.refreshResult();
    this.syncGuide();
    if (!this.data.interrupted && this.data.resultId && this.data.resultId !== this.lastPlayedResultId) {
      this.playResultVoice();
      this.playResultFirework();
      this.playKoiEffect();
      this.lastPlayedResultId = this.data.resultId;
    }
  },
  onReady() {if (this.shareResult && this.shareResultOwner === api.getToken()) this.sharePreparation = prepareResultImage(this, this.shareResult, this.data.stageName);},
  onHide() {
    this.shareRevision = (this.shareRevision || 0) + 1; this.shareCardPath = '';
    this.pageActive = false;
    this.replayGeneration = (this.replayGeneration || 0) + 1;
    this.stopResultFirework();
    this.closeKoiEffect({silent: true});
    this.clearResultVoiceTimer();
    this.stopNumberAnimations();
  },
  onUnload() {
    this.shareRevision = (this.shareRevision || 0) + 1; this.shareCardPath = '';
    this.pageActive = false;
    this.replayGeneration = (this.replayGeneration || 0) + 1;
    this.resultRequestId = (this.resultRequestId || 0) + 1;
    this.stopResultFirework();
    this.closeKoiEffect({silent: true});
    this.clearResultVoiceTimer();
    this.stopNumberAnimations();
  },
  onShareAppMessage() {
    analytics.track('share_click');
    const payload = buildShareAppMessage('result');
    const owner = api.getToken();
    const card = this.shareResultOwner === owner ? resultCard(this.shareResult, this.data.stageName) : null;
    const fallback = {...payload, path: '/pages/home/index?from=result_share'};
    if (!card) return fallback;
    const share = {...fallback, title: resultShareTitle(card)};
    if (this.shareResult.challengeCode) share.path += `&challenge=${encodeURIComponent(this.shareResult.challengeCode)}`;
    if (this.shareCardOwner === owner && this.shareCardPath) return {...share, imageUrl: this.shareCardPath};
    if (!this.sharePreparation) return share;
    const revision = this.shareRevision;
    return {...share, promise: this.sharePreparation.then((path) => {
      if (owner !== api.getToken() || revision !== this.shareRevision) return fallback;
      return path ? {...share, imageUrl: path} : share;
    })};
  },
  onShareTimeline() {
    return buildShareTimeline('result', {
      extraQuery: 'from=result_share',
    });
  },
  syncGuide() {
    this.setData({
      guideVisible: !this.data.interrupted && guideStore.shouldShowStep(guideStore.GUIDE_STEPS.RESULT),
    });
  },
  finishGuide() {
    guideStore.complete();
    this.setData({guideVisible: false});
  },
  stopNumberAnimations() {
    if (this.gainAnimTimer) {
      clearInterval(this.gainAnimTimer);
      this.gainAnimTimer = null;
    }
    if (this.incomeAnimTimer) {
      clearInterval(this.incomeAnimTimer);
      this.incomeAnimTimer = null;
    }
  },
  playResultWinAudio() {
    if (!this.resultFireworkActive) {
      return;
    }
    if ((this.fireworkAudioPlayCount || 0) >= FIREWORK_MAX_AUDIO_BURSTS) {
      this.stopResultFirework();
      return;
    }

    if (this.resultWinAudio) {
      try {
        this.resultWinAudio.stop();
        this.resultWinAudio.destroy();
      } catch (error) {}
      this.resultWinAudio = null;
    }

    const audio = createEffectAudio?.('resultWin', {volume: .8});
    this.fireworkAudioPlayCount = (this.fireworkAudioPlayCount || 0) + 1;
    const ended = () => {
      if (!this.resultFireworkActive) {
        return;
      }
      if ((this.fireworkAudioPlayCount || 0) >= FIREWORK_MAX_AUDIO_BURSTS) {
        this.stopResultFirework();
        return;
      }
      this.setData({
        fireworkParticles: generateFireworks(3),
      });
      playVibrate('medium');
      this.playResultWinAudio();
    };
    if (!audio) {
      // Keep the celebration visible when effects are muted.
      this.silentFireworkTimer = setTimeout(ended, 1800);
      return;
    }
    audio.onEnded(ended);
    audio.onError(() => {
      if (this.resultWinAudio === audio) {
        this.resultWinAudio = null;
      }
    });
    this.resultWinAudio = audio;

    try {
      audio.play();
    } catch (error) {}
  },
  animateNumber(targetValue, formatFn, stateKey, duration = 1200) {
    // 降步数：7 步 × 2 个数字并行滚动 = 14 次 setData（≤15），避免 JS 高频驱动动画
    const steps = 7;
    const stepTime = duration / steps;
    let currentStep = 0;
    const startValue = 0;
    const diff = targetValue - startValue;

    const timer = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps;
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentValue = Math.floor(startValue + diff * easeProgress);

      this.setData({
        [stateKey]: formatFn(currentValue)
      });

      if (currentStep >= steps) {
        clearInterval(timer);
        this.setData({
          [stateKey]: formatFn(targetValue)
        });
      }
    }, stepTime);
    
    return timer;
  },
  playResultFirework() {
    this.stopResultFirework();
    this.resultFireworkActive = true;
    this.fireworkAudioPlayCount = 0;
    // 显示烟花特效
    this.setData({
      showFireworks: true,
      fireworkParticles: generateFireworks(4),
    });
    playVibrate('heavy');
    this.playResultWinAudio();
  },
  playResultVoice() {
    this.clearResultVoiceTimer();
    playVoice('resultComplete', {debounceMs: 0});
    this.resultVoiceTimer = setTimeout(() => {
      this.resultVoiceTimer = null;
      playVoice(this.data.isKoiWinner ? 'resultFirst' : 'resultNormal', {debounceMs: 0});
    }, 700);
  },
  clearResultVoiceTimer() {
    if (this.resultVoiceTimer) {
      clearTimeout(this.resultVoiceTimer);
      this.resultVoiceTimer = null;
    }
  },
  stopResultFirework() {
    clearTimeout(this.silentFireworkTimer); this.silentFireworkTimer = null;
    this.resultFireworkActive = false;
    this.fireworkAudioPlayCount = 0;
    if (this.resultWinAudio) {
      try {
        this.resultWinAudio.stop();
        this.resultWinAudio.destroy();
      } catch (error) {}
      this.resultWinAudio = null;
    }
    // 隐藏烟花
    this.setData({
      showFireworks: false,
      fireworkParticles: [],
    });
  },
  playKoiEffect() {
    if (!this.data.isKoiWinner || this.data.resultId === this.lastPlayedKoiResultId) {
      return;
    }

    this.lastPlayedKoiResultId = this.data.resultId;
    if (this.koiCtaTimer) {
      clearTimeout(this.koiCtaTimer);
    }

    this.setData({
      showKoiEffect: true,
      koiCtaVisible: false,
      koiBlessings: generateKoiBlessings(),
    });

    playCue('resultWin', {volume: 0.86});
    playVoice('resultKoi', {debounceMs: 0});
    playVibrate('heavy');
    this.koiCtaTimer = setTimeout(() => {
      this.setData({koiCtaVisible: true});
    }, 1400);
  },
  closeKoiEffect(options = {}) {
    if (this.koiCtaTimer) {
      clearTimeout(this.koiCtaTimer);
      this.koiCtaTimer = null;
    }
    if (!options.silent) {
      playCue('tap', {volume: 0.68});
      playVibrate('light');
    }
    if (this.data.showKoiEffect || this.data.koiCtaVisible) {
      this.setData({
        showKoiEffect: false,
        koiCtaVisible: false,
      });
    }
  },
  async refreshResult() {
    this.setData({growthGoal: null, passport: null});
    this.setData({challengeComparison: null, canShareChallenge: false});
    this.shareRevision = (this.shareRevision || 0) + 1;
    this.shareResult = null; this.shareResultOwner = ''; this.shareCardPath = ''; this.shareCardOwner = ''; this.sharePreparation = null;
    const requestId = (this.resultRequestId || 0) + 1;
    this.resultRequestId = requestId;
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    const sessionId = currentPage && currentPage.options && currentPage.options.sessionId;
    const token = api.getToken();
    try {
      if (sessionId) {
        if (!token) throw new Error('请重新登录后查看服务器结算');
        const result = await api.get(`/games/${sessionId}/result`);
        if (requestId !== this.resultRequestId) return;
        if (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken())) throw new Error('登录账号已变更，请重新查看结算');
        if (result) {
          if (this.trackedFinishedSession !== String(sessionId) && result.title !== '对局已中断') {
            const self = result.ranking?.find((p) => p.isSelf);
            analytics.track('game_finish', {sessionId: String(sessionId), rank: self?.rank || result.selfRank || 0, score: self?.score || 0});
            this.trackedFinishedSession = String(sessionId);
          }
          this.shareResult = result; this.shareResultOwner = api.getToken();
          this.sharePreparation = prepareResultImage(this, result, getStageFromResult(result)?.name || this.data.stageName);
          this.resultPerformanceMap = result.performanceMap || {};
          this.resultBreakdownMap = result.scoreBreakdownMap || {};
          this.onlineSessionId = String(sessionId);
          this.onlineRoomId = result.roomId ? String(result.roomId) : '';
          this.replayStage = getStageFromResult(result);
          const achievementMedal = createResultMedal(result);
          const themePatch = buildSavedThemePatch(getStageFromResult(result));
          const comparison = result.challengeComparison;
          this.stopNumberAnimations();
          this.setData({
            matchmaking: !!result.matchmaking,
            top3: result.top3 || this.data.top3,
            rankList: result.ranking || [],
            gainText: '0',
            incomeText: '🐟锦鲤币 0',
            incomeAmountText: '0',
            achievementText: result.achievement || achievementMedal.achievement,
            achievementMedal,
            modeText: result.modeText || this.data.modeText,
            resultId: result.resultId || '',
            canShareChallenge: !!result.challengeCode,
            challengeComparison: comparison ? {...comparison, outcome: comparison.selfScore === comparison.friendScore ? '平局' : comparison.selfScore > comparison.friendScore ? '挑战成功' : '好友领先'} : null,
            interrupted: !!result.interrupted,
            resultTitle: result.interrupted ? (result.title || '对局已中断') : '本局结算',
            selfRank: result.interrupted ? 0 : findSelfRank(result),
            resultReason: result.interrupted ? (result.reason || '本局未完成，未发放奖励，可重新开局') : '',
            performance: result.interrupted ? null : performanceFeedback(result),
            totalText: `总计 ${(result.ranking || []).length} 玩家`,
            expProgress: null,
            expError: '',
            isKoiWinner: !result.interrupted && findSelfRank(result) === 1,
            ...themePatch,
          });
          this.gainAnimTimer = this.animateNumber(result.gain || 0, formatNumber, 'gainText', 1200);
          this.incomeAnimTimer = this.animateNumber(result.coins || 0, formatNumber, 'incomeAmountText', 1500);
          if (!result.interrupted) void this.loadGrowthGoal(requestId, token);
          await this.syncResultExperience();
          return;
        }
        throw new Error('服务器结算尚未确认，请稍后重试');
      }
    } catch (err) {
      console.warn('[result] API error:', err);
      if (requestId !== this.resultRequestId) return;
      this.stopNumberAnimations();
      this.setData({incomeAmountText: '--', gainText: '--'});
      wx.showToast({title: err.message || '结算同步失败，请稍后重试', icon: 'none'});
      return;
    }

    try {
      const url = await require('../../utils/online-navigation').latestResultUrl();
      wx.redirectTo({url});
    } catch (error) {
      this.setData({interrupted: true, resultTitle: '暂无对局记录', resultReason: error.message || '完成一局后可查看结算', incomeAmountText: '--', gainText: '--'});
    }
  },
  async syncResultExperience() {
    const requestId = this.resultRequestId;
    const token = api.getToken();
    if (!token) return;
    const summary = await playerStats.fetchSummary();
    if (requestId !== this.resultRequestId || (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return;
    this.setData({
      expProgress: summary ? buildExpProgress(summary.totalExp) : null,
      expError: summary ? '' : '账号经验同步失败，点击重试',
    });
  },
  async loadGrowthGoal(requestId = this.resultRequestId, token = api.getToken()) {
    if (!token || !runtimeConfig.isApiSupported('retention')) return;
    try {
      const summary = await api.get('/retention', {sessionId: this.onlineSessionId});
      if (this.pageActive === false || requestId !== this.resultRequestId ||
        (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return;
      this.setData({growthGoal: selectGrowthGoal(summary), passport: summary?.passport || null});
    } catch (_) { /* Optional progress never blocks confirmed results or replay. */ }
  },
  openGrowthGoal() {
    wx.navigateTo({url: '/pages/tasks/index'});
  },
  async replay() {
    if (this.data.replayPending) return;
    const stageId = resolveStage(this.replayStage || {name: this.data.stageName}).id;
    const attempt = analytics.playFlow.begin(stageId, this.data.matchmaking, String(this.onlineSessionId || ''));
    const generation = this.replayGeneration || 0;
    const current = () => this.pageActive !== false && generation === (this.replayGeneration || 0);
    playCue('tap', {volume: 0.75});
    playVibrate('medium');
    {
      this.setData({replayPending: true, replayError: ''});
      try {
        await require('../../utils/online-navigation').requireOnlineAccount();
        if (!current()) return;
        const token = api.getToken();
        const newRoom = this.data.replayNewRoom;
        if (!newRoom && !this.onlineSessionId) throw new Error('请先同步本局结算后重试');
        if (this.data.matchmaking && !runtimeConfig.isApiSupported('quickMatch')) throw new Error('快速匹配升级中，请稍后重试');
        if (!this.data.matchmaking && !newRoom && !runtimeConfig.isApiSupported('roomRematch')) throw new Error('续玩服务升级中，请稍后重试');
        const payload = this.data.matchmaking
          ? await api.post('/matchmaking', {stageId: resolveStage(this.replayStage || {name: this.data.stageName}).id})
          : newRoom
          ? await api.post('/rooms', {stageId: resolveStage(this.replayStage || {name: this.data.stageName}).id})
          : await api.post(`/games/${encodeURIComponent(this.onlineSessionId)}/rematch`);
        if (!current() || (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return;
        const roomId = (payload.room || payload).id;
        if (!roomId) throw new Error('房间信息未确认，请重试');
        analytics.playFlow.queued(attempt, String(roomId));
        wx.redirectTo({url: `/pages/room/index?backendRoomId=${encodeURIComponent(roomId)}`});
      } catch (error) {
        analytics.playFlow.failed(attempt, error);
        if (current()) {
          this.setData({replayError: error.message || '再来一局失败，请重试', ...(error.statusCode === 410 ? {replayNewRoom: true} : {})});
          wx.showToast({title: error.message || '再来一局失败，请重试', icon: 'none'});
        }
      } finally {if (current()) this.setData({replayPending: false});}
      return;
    }

  },
  openPassportStage() {
    const stage = this.data.passport?.nextStage;
    if (stage) return this.leaveForHome(`/pages/home/index?stageId=${encodeURIComponent(stage.id)}`);
  },
  goHome() {
    return this.leaveForHome('/pages/home/index');
  },
  async leaveForHome(url) {
    if (this.data.replayPending) return;
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.RESULT)) {
      guideStore.complete();
      this.setData({guideVisible: false});
    }
    if (this.onlineRoomId) {
      try {await api.post(`/rooms/${encodeURIComponent(this.onlineRoomId)}/leave`);}
      catch (error) {
        if (![400, 404].includes(error.statusCode)) {
          this.setData({replayError: error.message || '离开房间失败，请重试'});
          return;
        }
      }
    }
    gameStore.resetToHome();
    wx.reLaunch({url});
  },
  syncUserProfile() {
    const cached = getCachedProfile();
    this.setData({
      userProfile: cached,
      userAuthorized: hasValidProfile(cached),
    });
  },
  onTapProfile() {
    playVibrate('light');
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapPlayer(e) {
    const player = e.currentTarget.dataset.player;
    if (!player || player.name === '--') return;

    playCue('tap', {volume: 0.75});
    playVibrate('light');
    const breakdown = (this.resultBreakdownMap || {})[player.id];
    const performance = (this.resultPerformanceMap || {})[player.id] || null;

    this.setData({
      showScorePopup: true,
      selectedPlayer: player,
      selectedPerformance: performance,
      hasScoreBreakdown: !!breakdown,
      scoreBreakdown: {
        round: formatSigned(breakdown?.round),
        teamBonus: formatSigned(breakdown?.teamBonus),
        investment: formatSigned(breakdown?.investment),
        fortuneBag: formatSigned(breakdown?.fortuneBag),
      },
    });
  },
  closeScorePopup() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    this.setData({
      showScorePopup: false,
    });
  },
  toggleNav() {
    playVibrate('light');
    this.setData({navExpanded: !this.data.navExpanded});
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/result/index') {
      return;
    }
    if (page === '/pages/arena/index' || page === '/pages/room/index') {
      return this.playAgain();
    }
    if (page === '/pages/home/index') {
      return this.goHome();
    }
    wx.redirectTo({url: page});
  },
});
