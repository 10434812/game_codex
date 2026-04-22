const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS, STAGES} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');

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
    coinText: '0',
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
    this.syncCoins();
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/home/index') {
      return;
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
  syncCoins() {
    const state = shopStore.getStoreState();
    this.setData({
      coinText: Number(state.coins || 0).toLocaleString('en-US'),
    });
  },
  onTapProfile() {
    wx.navigateTo({url: '/pages/profile/index'});
  },
});
