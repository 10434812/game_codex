const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_STAGE, STAGES} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    tabs: [
      {key: 'explore', label: '探索', icon: '/assets/nav/explore.svg', iconActive: '/assets/nav/explore_active.svg', page: '/pages/home/index'},
      {key: 'social', label: '社交', icon: '/assets/nav/social.svg', iconActive: '/assets/nav/social_active.svg', page: '/pages/room/index'},
      {key: 'play', label: '游玩', icon: '/assets/nav/play.svg', iconActive: '/assets/nav/play_active.svg', page: '/pages/arena/index'},
      {key: 'history', label: '历史', icon: '/assets/nav/history.svg', iconActive: '/assets/nav/history_active.svg', page: '/pages/result/index'},
    ],
    activeTab: 'explore',
    activeStage: 0,
    stages: STAGES,
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
      wx.navigateTo({url: page});
      return;
    }

    if (page === '/pages/arena/index') {
      gameStore.createRoomFromStage(stage);
      gameStore.startGame();
      wx.navigateTo({url: page});
      return;
    }

    wx.navigateTo({url: page});
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
  onTapProfile() {
    wx.navigateTo({url: '/pages/profile/index'});
  },
});
