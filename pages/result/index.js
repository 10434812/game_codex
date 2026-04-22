const {getNavLayout} = require('../../utils/nav');
const {MATCH_MODE_TEXT, NAV_TABS} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');

const RESULT_FIREWORK_MS = 8000;
const RESULT_FIREWORK_STEP_MS = 1800;

function createEmptyTop3() {
  return {
    first: {
      name: '--',
      score: '0',
      avatar: '/assets/bg/avatars/avatar_01.png',
    },
    second: {
      name: '--',
      score: '0',
      avatar: '/assets/bg/avatars/avatar_02.png',
    },
    third: {
      name: '--',
      score: '0',
      avatar: '/assets/bg/avatars/avatar_03.png',
    },
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
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
    resultId: '',
    gainText: '0',
    coinText: '0',
    achievementText: '--',
    totalText: '总计 0 玩家',
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    showScorePopup: false,
    selectedPlayer: null,
    scoreBreakdown: {
      round: '0',
      teamBonus: '0',
      investment: '0',
      fortuneBag: '0',
    },
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    this.refreshResult();
  },
  onShow() {
    this.syncUserProfile();
    this.refreshResult();
    if (this.data.resultId && this.data.resultId !== this.lastPlayedResultId) {
      this.playResultFirework();
      this.lastPlayedResultId = this.data.resultId;
    }
  },
  onHide() {
    this.stopResultFirework();
  },
  onUnload() {
    this.stopResultFirework();
  },
  playResultFirework() {
    this.stopResultFirework();
    playCue('resultWin', {volume: 0.8});
    this.resultWinInterval = setInterval(() => {
      playCue('resultWin', {volume: 0.8});
    }, RESULT_FIREWORK_STEP_MS);
    this.resultWinTimer = setTimeout(() => {
      this.stopResultFirework();
    }, RESULT_FIREWORK_MS);
  },
  stopResultFirework() {
    if (this.resultWinTimer) {
      clearTimeout(this.resultWinTimer);
      this.resultWinTimer = null;
    }
    if (this.resultWinInterval) {
      clearInterval(this.resultWinInterval);
      this.resultWinInterval = null;
    }
  },
  refreshResult() {
    const state = gameStore.getState();
    if (state.status !== 'finished' || !state.result) {
      wx.reLaunch({url: '/pages/home/index'});
      return;
    }

    this.setData({
      top3: state.result.top3,
      rankList: state.result.rest,
      gainText: formatNumber(state.result.gain),
      coinText: formatNumber(state.result.coins),
      achievementText: state.result.achievement,
      modeText: state.modeText || MATCH_MODE_TEXT,
      resultId: state.result.resultId || '',
      totalText: `总计 ${state.result.ranking.length} 玩家`,
    });
  },
  replay() {
    playCue('tap', {volume: 0.75});
    gameStore.restartGame();
    wx.redirectTo({url: '/pages/arena/index'});
  },
  goHome() {
    playCue('tap', {volume: 0.75});
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
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapPlayer(e) {
    const player = e.currentTarget.dataset.player;
    if (!player || player.name === '--') return;

    playCue('tap', {volume: 0.75});
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
    this.setData({
      showScorePopup: false,
    });
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/result/index') {
      return;
    }
    wx.redirectTo({url: page});
  },
});
