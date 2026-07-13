const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const {DEFAULT_AVATAR, DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const playerStats = require('../../utils/player-stats');
const {playCue, playVoice, stopBgm, playVibrate} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');
const {buildExpProgress} = require('../../utils/progression');
const {formatNumber} = require('../../utils/format');
const {buildAchievementMedal} = require('../../utils/achievement-medals');
const runtimeConfig = require('../../utils/runtime-config');
const {enableShareMenu, buildShareAppMessage, buildShareTimeline} = require('../../utils/share-config');
const {createStageThemeData, loadStageTheme, saveStageTheme} = require('../../utils/stage-theme');
const guideStore = require('../../utils/guide-store');

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
    modeText: MATCH_MODE_TEXT,
    tabs: NAV_TABS,
    activeTab: 'history',
    stageName: DEFAULT_STAGE_THEME_DATA.stageName,
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
    resultId: '',
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
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    runtimeConfig.fetchRemoteConfig().finally(() => {
      enableShareMenu();
    });
  },
  async onShow() {
    this.syncUserProfile();
    stopBgm();
    await this.refreshResult();
    this.syncGuide();
    if (this.data.resultId && this.data.resultId !== this.lastPlayedResultId) {
      this.playResultVoice();
      this.playResultFirework();
      this.playKoiEffect();
      this.lastPlayedResultId = this.data.resultId;
    }
  },
  onHide() {
    this.stopResultFirework();
    this.closeKoiEffect({silent: true});
    this.clearResultVoiceTimer();
  },
  onUnload() {
    this.stopResultFirework();
    this.closeKoiEffect({silent: true});
    this.clearResultVoiceTimer();
    this.stopNumberAnimations();
  },
  onShareAppMessage() {
    return buildShareAppMessage('result', {
      extraQuery: `resultId=${encodeURIComponent(this.data.resultId || '')}`,
    });
  },
  onShareTimeline() {
    return buildShareTimeline('result', {
      extraQuery: `resultId=${encodeURIComponent(this.data.resultId || '')}`,
    });
  },
  syncGuide() {
    this.setData({
      guideVisible: guideStore.shouldShowStep(guideStore.GUIDE_STEPS.RESULT),
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

    const audio = wx.createInnerAudioContext();
    audio.autoplay = false;
    audio.loop = false;
    audio.volume = 0.8;
    audio.src = 'https://xcx.ukb88.com/assets/audio/result/yanhua.mp3';
    this.fireworkAudioPlayCount = (this.fireworkAudioPlayCount || 0) + 1;
    audio.onEnded(() => {
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
    });
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
    const steps = 30;
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
    // Try API first
    try {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      const sessionId = currentPage.options.sessionId;
      if (sessionId && api.isLoggedIn()) {
        const result = await api.get(`/games/${sessionId}/result`);
        if (result) {
          const achievementMedal = createResultMedal(result);
          const themePatch = buildSavedThemePatch(getStageFromResult(result));
          this.stopNumberAnimations();
          this.setData({
            top3: result.top3 || this.data.top3,
            rankList: result.ranking || [],
            gainText: '0',
            incomeText: '🐟锦鲤币 0',
            incomeAmountText: '0',
            achievementText: result.achievement || achievementMedal.achievement,
            achievementMedal,
            modeText: result.modeText || this.data.modeText,
            resultId: result.resultId || '',
            totalText: `总计 ${(result.ranking || []).length} 玩家`,
            expProgress: buildExpProgress(playerStats.getSummary().totalExp),
            isKoiWinner: findSelfRank(result) === 1,
            ...themePatch,
          });
          this.gainAnimTimer = this.animateNumber(result.gain || 0, formatNumber, 'gainText', 1200);
          this.incomeAnimTimer = this.animateNumber(result.coins || 0, formatNumber, 'incomeAmountText', 1500);
          return;
        }
      }
    } catch (err) {
      console.warn('[result] API error:', err);
    }

    // Fall back to local gameStore
    const state = gameStore.getState();
    if (state.status !== 'finished' || !state.result) {
      wx.reLaunch({url: '/pages/home/index'});
      return;
    }

    this.stopNumberAnimations();
    const achievementMedal = createResultMedal(state.result);
    const themePatch = buildSavedThemePatch(state.stage || getStageFromResult(state.result));

    this.setData({
      top3: state.result.top3,
      rankList: state.result.rest,
      gainText: '0',
      incomeText: '🐟锦鲤币 0',
      incomeAmountText: '0',
      achievementText: state.result.achievement || achievementMedal.achievement,
      achievementMedal,
      modeText: state.modeText || MATCH_MODE_TEXT,
      resultId: state.result.resultId || '',
      totalText: `总计 ${state.result.ranking.length} 玩家`,
      expProgress: buildExpProgress(playerStats.getSummary().totalExp),
      isKoiWinner: findSelfRank(state.result) === 1,
      ...themePatch,
    });

    // 播放数字滚动动画
    this.gainAnimTimer = this.animateNumber(state.result.gain, formatNumber, 'gainText', 1200);
    this.incomeAnimTimer = this.animateNumber(state.result.coins, formatNumber, 'incomeAmountText', 1500);
  },
  replay() {
    playCue('tap', {volume: 0.75});
    playVibrate('medium');
    gameStore.restartGame();
    wx.redirectTo({url: '/pages/arena/index'});
  },
  goHome() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.RESULT)) {
      guideStore.complete();
      this.setData({guideVisible: false});
    }
    gameStore.resetToHome();
    wx.reLaunch({url: '/pages/home/index'});
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
    const state = gameStore.getState();
    const breakdownMap = (state.result && state.result.scoreBreakdownMap) || {};
    const breakdown = breakdownMap[player.id] || {
      round: 0,
      teamBonus: 0,
      investment: 0,
      fortuneBag: 0,
    };

    this.setData({
      showScorePopup: true,
      selectedPlayer: player,
      scoreBreakdown: {
        round: formatSigned(breakdown.round),
        teamBonus: formatSigned(breakdown.teamBonus),
        investment: formatSigned(breakdown.investment),
        fortuneBag: formatSigned(breakdown.fortuneBag),
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
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/result/index') {
      return;
    }
    wx.redirectTo({url: page});
  },
});
