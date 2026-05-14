const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_AVATAR, DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS, STAGES} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const playerStats = require('../../utils/player-stats');
const {playCue, playStageBgm, playVibrate} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');
const {buildExpProgress} = require('../../utils/progression');
const {formatCurrency} = require('../../utils/format');
const runtimeConfig = require('../../utils/runtime-config');
const {enableShareMenu, buildShareAppMessage, buildShareTimeline} = require('../../utils/share-config');
const {createStageThemeData, saveStageTheme} = require('../../utils/stage-theme');

const MIN_VISIBLE_PROGRESS_PERCENT = 10;
const DEFAULT_STAGE_THEME_DATA = createStageThemeData(DEFAULT_STAGE);

function getProgressVisualPercent(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  if (normalized >= 100 || normalized <= 0) {
    return normalized === 0 ? MIN_VISIBLE_PROGRESS_PERCENT : 100;
  }
  return Math.max(normalized, MIN_VISIBLE_PROGRESS_PERCENT);
}

function normalizeStageIndex(index, total) {
  const count = Math.max(1, Number(total) || 1);
  return ((Number(index) || 0) % count + count) % count;
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
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
    balanceText: '¥0',
    levelText: 'Lv.1',
    progressPercent: 0,
    progressVisualPercent: MIN_VISIBLE_PROGRESS_PERCENT,
    showProfileCard: false,
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    defaultAvatar: DEFAULT_AVATAR,
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    this.syncStageTheme();
    runtimeConfig.fetchRemoteConfig().finally(() => {
      enableShareMenu();
    });
  },
  onShow() {
    this.syncUserProfile();
    this.syncOverview();
    this.syncStageMusic();
    this.playActiveStageVideo();
  },
  onReady() {
    this.playActiveStageVideo();
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
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
    playVibrate('medium');
    const stage = this.data.stages[this.data.activeStage] || DEFAULT_STAGE;
    gameStore.createRoomFromStage(stage);
    wx.navigateTo({url: '/pages/room/index'});
  },
  onStageChange(e) {
    playVibrate('light');
    const activeStage = Number((e.detail && e.detail.current) || 0) || 0;
    this.applyActiveStage(activeStage);
  },
  onPrevStage() {
    this.shiftStage(-1);
  },
  onNextStage() {
    this.shiftStage(1);
  },
  shiftStage(offset) {
    playCue('tap', {volume: 0.72});
    playVibrate('light');
    this.applyActiveStage((Number(this.data.activeStage) || 0) + offset);
  },
  applyActiveStage(nextStage) {
    const activeStage = normalizeStageIndex(nextStage, this.data.stages.length);
    const stage = this.data.stages[activeStage] || DEFAULT_STAGE;
    const theme = saveStageTheme(stage);
    this.setData({
      activeStage,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
    this.syncStageMusic(stage);
    this.playActiveStageVideo();
  },
  onStageVideoReady(e) {
    const stageIndex = Number(e.currentTarget.dataset.stageIndex);
    if (stageIndex === this.data.activeStage) {
      this.playActiveStageVideo();
    }
  },
  playActiveStageVideo() {
    const stageIndex = Number(this.data.activeStage) || 0;
    const stage = this.getActiveStage();
    if (!stage.video || typeof wx === 'undefined' || typeof wx.createVideoContext !== 'function') {
      return;
    }

    const play = () => {
      try {
        const video = wx.createVideoContext(`stage-video-${stageIndex}`, this);
        if (video && typeof video.play === 'function') {
          video.play();
        }
      } catch (error) {}
    };

    if (typeof wx.nextTick === 'function') {
      wx.nextTick(play);
      return;
    }
    play();
  },
  getActiveStage() {
    return this.data.stages[Number(this.data.activeStage) || 0] || DEFAULT_STAGE;
  },
  syncStageTheme(stage = this.getActiveStage()) {
    const theme = saveStageTheme(stage);
    this.setData({
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
  },
  syncStageMusic(stage = this.getActiveStage()) {
    playStageBgm(stage, {volume: 0.38});
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
    playVibrate('light');
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapIncome() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    wx.navigateTo({url: '/pages/income/index'});
  },
  toggleProfileCard() {
    this.setData({showProfileCard: !this.data.showProfileCard});
  },
  onShareAppMessage() {
    return buildShareAppMessage('home');
  },
  onShareTimeline() {
    return buildShareTimeline('home');
  },
});
