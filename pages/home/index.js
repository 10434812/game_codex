const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS, STAGES} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const playerStats = require('../../utils/player-stats');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');
const {buildExpProgress} = require('../../utils/progression');
const {formatCurrency} = require('../../utils/format');

const MIN_VISIBLE_PROGRESS_PERCENT = 10;

function getProgressVisualPercent(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  if (normalized >= 100 || normalized <= 0) {
    return normalized === 0 ? MIN_VISIBLE_PROGRESS_PERCENT : 100;
  }
  return Math.max(normalized, MIN_VISIBLE_PROGRESS_PERCENT);
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    modeText: MATCH_MODE_TEXT,
    tabs: NAV_TABS,
    activeTab: 'explore',
    activeStage: 0,
    stages: STAGES,
    balanceText: '¥0',
    levelText: 'Lv.1',
    progressPercent: 0,
    progressVisualPercent: MIN_VISIBLE_PROGRESS_PERCENT,
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
  },
  onShow() {
    this.syncUserProfile();
    this.syncOverview();
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/home/index') {
      return;
    }

    if (page === '/pages/result/index') {
      const snapshot = gameStore.getState();
      if (snapshot.status !== 'finished' || !snapshot.result) {
        wx.showToast({title: '暂无历史结算', icon: 'none'});
        return;
      }
    }

    const stage = this.data.stages[this.data.activeStage] || DEFAULT_STAGE;
    if (page === '/pages/room/index') {
      gameStore.ensureRoom(stage);
      wx.redirectTo({url: page});
      return;
    }

    if (page === '/pages/arena/index') {
      gameStore.ensureRoom(stage);
      wx.redirectTo({url: '/pages/room/index'});
      return;
    }

    wx.redirectTo({url: page});
  },
  startGame() {
    playCue('tap', {volume: 0.75});
    const stage = this.data.stages[this.data.activeStage] || DEFAULT_STAGE;
    gameStore.createRoomFromStage(stage);
    wx.navigateTo({url: '/pages/room/index'});
  },
  onStageChange(e) {
    this.setData({
      activeStage: e.detail.current,
    });
  },
  syncUserProfile() {
    const cached = getCachedProfile();
    this.setData({
      userProfile: cached,
      userAuthorized: hasValidProfile(cached),
    });
  },
  syncOverview() {
    const shopState = shopStore.getStoreState();
    const summary = playerStats.getSummary();
    const progress = buildExpProgress(summary.totalExp);
    this.setData({
      balanceText: formatCurrency(shopState.coins),
      levelText: `Lv.${progress.level}`,
      progressPercent: progress.percent,
      progressVisualPercent: getProgressVisualPercent(progress.percent),
    });
  },
  onTapProfile() {
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapIncome() {
    playCue('tap', {volume: 0.75});
    wx.navigateTo({url: '/pages/income/index'});
  },
});
