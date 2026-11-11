const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_AVATAR, DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS, STAGES} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const playerStats = require('../../utils/player-stats');
const {playCue, playStageBgm, playVoice, playVibrate, getStageVoiceName} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');
const {buildExpProgress} = require('../../utils/progression');
const {formatNumber} = require('../../utils/format');
const runtimeConfig = require('../../utils/runtime-config');
const api = require('../../utils/api-client');
const {enableShareMenu, buildShareAppMessage, buildShareTimeline} = require('../../utils/share-config');
const {createStageThemeData, saveStageTheme} = require('../../utils/stage-theme');
const guideStore = require('../../utils/guide-store');
const pageHelpers = require('../../utils/page-helpers');
const privacyConsent = require('../../utils/privacy-consent');

const DEFAULT_STAGE_THEME_DATA = createStageThemeData(DEFAULT_STAGE);

function getProgressVisualPercent(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  return normalized;
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
    balanceAmountText: '¥0',
    levelText: 'Lv.1',
    progressPercent: 0,
    progressVisualPercent: 0,
    experienceText: '0 / 120 经验',
    showProfileCard: false,
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    defaultAvatar: DEFAULT_AVATAR,
    guideVisible: false,
    shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true),
    announcements: [],
    announcementVisible: false,
    activeAnnouncement: null,
    activeSessionId: '',
  },
  onLoad(options = {}) {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    if (!privacyConsent.canEnter()) return;
    if (options && options.scene === 'room' && (options.backendRoomId || options.roomId)) {
      const query = [
        options.backendRoomId ? `backendRoomId=${encodeURIComponent(options.backendRoomId)}` : '',
        options.roomId ? `roomId=${encodeURIComponent(options.roomId)}` : '',
        'scene=room',
      ].filter(Boolean).join('&');
      wx.redirectTo({url: `/pages/room/index?${query}`});
      return;
    }
    this.syncStageTheme();
    return runtimeConfig.fetchRemoteConfig().then(() => {
      this.setData({shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true)});
      enableShareMenu();
      this.checkMaintenance();
      this.fetchAnnouncements();
      void this.syncOnlineGame();
    });
  },
  fetchAnnouncements() {
    if (privacyConsent.isDevelopmentPreview() || !runtimeConfig.isApiSupported('announcements')) return;
    return api.get('/announcements', {limit: 10}).then((records) => {
      const list = Array.isArray(records) ? records : [];
      const announcements = list.map((item) => ({
        id: item.id,
        title: item.title || '',
        content: item.content || '',
        type: item.type || 'system',
        priority: item.priority || 'normal',
        publishedAt: item.publishedAt || item.published_at || '',
      }));
      this.setData({announcements});
    }).catch((error) => {
      console.warn('[home] fetchAnnouncements error:', error);
    });
  },
  openAnnouncement(e) {
    playVibrate('light');
    const index = Number(e.currentTarget.dataset.index || 0) || 0;
    const item = this.data.announcements[index];
    if (!item) {
      return;
    }
    this.setData({activeAnnouncement: item, announcementVisible: true});
  },
  onSelectAnnouncement(e) {
    const index = Number(e.currentTarget.dataset.index || 0) || 0;
    const item = this.data.announcements[index];
    if (item) {
      this.setData({activeAnnouncement: item});
    }
  },
  closeAnnouncement() {
    this.setData({announcementVisible: false});
  },
  onAnnouncementNoop() {},
  // 维护模式提示（app.js 全局已提示过则跳过，避免重复弹窗）
  checkMaintenance() {
    if (this._maintenanceChecked) {
      return;
    }
    this._maintenanceChecked = true;
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && app._maintenanceNotified) {
        return;
      }
    } catch (error) {}
    const features = runtimeConfig.getFeatures();
    const maintenance = features && features.maintenance;
    if (!maintenance || !maintenance.enabled) {
      return;
    }
    if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
      wx.showModal({
        title: '系统维护中',
        content: maintenance.message || '锦鲤前程正在维护升级，请稍后再来～',
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },
  onHide() {
    pageHelpers.pauseBackdropVideo(this);
  },
  onShow() {
    if (!privacyConsent.canEnter()) return;
    pageHelpers.resumeBackdropVideo(this);
    this.syncUserProfile();
    this.syncOverview();
    void this.syncOnlineGame();
    if (api.isLoggedIn()) {
      this.syncServerSummary();
      const pending = shopStore.refreshInventory();
      this.syncOverview();
      pending.catch((error) => {
        wx.showToast({title: '账号资产同步失败，请在商城重试', icon: 'none'});
      }).finally(() => this.syncOverview());
    }
    this.syncStageMusic();
    this.playActiveStageVideo();
    this.syncGuide();
    if (!this.homeGuideVoicePlayed) {
      playVoice('homeGuide', {debounceMs: 0});
      this.homeGuideVoicePlayed = true;
    }
  },
  async syncOnlineGame() {
    if (!api.isLoggedIn()) {
      this.setData({activeSessionId: ''});
      return '';
    }
    await runtimeConfig.fetchRemoteConfig();
    if (!runtimeConfig.isApiSupported('currentGame') || !runtimeConfig.isApiSupported('onlineArena')) {
      this.setData({activeSessionId: ''});
      return '';
    }
    if (!this.onlineGameRequest) {
      this.onlineGameRequest = api.get('/games/current').then((session) => {
        const activeSessionId = session?.sessionId ? String(session.sessionId) : '';
        this.setData({activeSessionId});
        return activeSessionId;
      }).catch(() => {
        wx.showToast({title: '联机对局查询失败，请重试', icon: 'none'});
        return this.data.activeSessionId || null;
      }).finally(() => {this.onlineGameRequest = null;});
    }
    return this.onlineGameRequest;
  },
  syncGuide() {
    this.setData({
      guideVisible: guideStore.shouldShowStep(guideStore.GUIDE_STEPS.HOME),
    });
  },
  onGuidePrimary() {
    guideStore.advanceTo(guideStore.GUIDE_STEPS.ROOM);
    this.setData({guideVisible: false});
    this.startGame();
  },
  async switchTab(e) {
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
    if (['/pages/room/index', '/pages/arena/index'].includes(page)) {
      const sessionId = await this.syncOnlineGame();
      if (sessionId === null) return;
      if (sessionId) {
        wx.redirectTo({url: `/pages/arena/index?sessionId=${encodeURIComponent(sessionId)}`});
        return;
      }
    }
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
  async startGame() {
    // 防重：快速双击会连续 navigateTo 两次，导致栈内出现两个房间页（I-9）
    if (this.enteringGame) return;
    this.enteringGame = true;
    try {
      await this.enterGame();
    } finally {
      setTimeout(() => { this.enteringGame = false; }, 800);
    }
  },
  async enterGame() {
    playCue('tap', {volume: 0.75});
    playVibrate('medium');
    const sessionId = this.data.activeSessionId || await this.syncOnlineGame();
    if (sessionId === null) return;
    if (sessionId) {
      wx.navigateTo({url: `/pages/arena/index?sessionId=${encodeURIComponent(sessionId)}`});
      return;
    }
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.HOME)) {
      guideStore.advanceTo(guideStore.GUIDE_STEPS.ROOM);
      this.setData({guideVisible: false});
    }
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
    const voiceName = getStageVoiceName(stage);
    if (voiceName) {
      playVoice(voiceName, {debounceMs: 1800});
    }
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
  async syncServerSummary() {
    const token = api.getToken();
    const summary = await playerStats.fetchSummary();
    // 账号已切换或已退出时丢弃过期结果
    if (token !== api.getToken() || !api.isLoggedIn()) return;
    this.serverSummary = summary;
    this.syncOverview();
  },
  syncOverview() {
    const shopState = shopStore.getStoreState();
    // 登录账号以服务端累计经验为准（I-6）；游客才使用设备本地统计
    const summary = (api.isLoggedIn() && this.serverSummary) || playerStats.getSummary();
    const progress = buildExpProgress(summary.totalExp);
    this.setData({
      balanceAmountText: shopState.assetSource === 'server' && shopState.syncStatus !== 'ready'
        ? '--' : formatNumber(shopState.coins),
      levelText: `Lv.${progress.level}`,
      experienceText: `${progress.current} / ${progress.required} 经验`,
      progressPercent: progress.percent,
      progressVisualPercent: getProgressVisualPercent(progress.percent),
    });
  },
  onTapProfile() {
    playVibrate('light');
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapTasks() { wx.navigateTo({url: '/pages/tasks/index'}); },
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
