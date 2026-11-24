const analytics = require('../../utils/analytics');
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
const {latestResultUrl} = require('../../utils/online-navigation');

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
    modeText: '好友对战',
    tabs: NAV_TABS,
    activeTab: 'explore', navExpanded: false,
    activeStage: 0,
    pageVisible: false,
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
    summaryError: '',
    showProfileCard: false,
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    defaultAvatar: DEFAULT_AVATAR,
    guideVisible: false,
    onlineAvailable: false,
    quickMatchAvailable: false,
    entryRefreshing: false,
    shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true),
    announcements: [],
    announcementVisible: false,
    activeAnnouncement: null,
    activeSessionId: '',
    challengePending: false,
  },
  onLoad(options = {}) {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    if (!privacyConsent.canEnter()) return;
    this.challengeCode = typeof options.challenge === 'string' ? options.challenge : '';
    if (this.challengeCode) this.setData({challengePending: true});
    if (options && options.scene === 'room' && (options.backendRoomId || options.roomId)) {
      const query = [
        options.backendRoomId ? `backendRoomId=${encodeURIComponent(options.backendRoomId)}` : '',
        options.roomId ? `roomId=${encodeURIComponent(options.roomId)}` : '',
        'scene=room',
      ].filter(Boolean).join('&');
      wx.redirectTo({url: `/pages/room/index?${query}`});
      return;
    }
    const recommendedStage = STAGES.findIndex((stage) => stage.id === Number(options?.stageId));
    if (recommendedStage >= 0) this.setData({activeStage: recommendedStage});
    this.syncStageTheme();
    return runtimeConfig.fetchRemoteConfig().then(() => {
      this.setData({shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true)});
      this.syncGuide();
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
    this.homeActive = false;
    this.pauseActiveStageVideo();
    this.setData({pageVisible: false});
  },
  onUnload() {
    this.homeActive = false;
    this.pauseActiveStageVideo();
    this.summaryRequestId = (this.summaryRequestId || 0) + 1;
  },
  onShow() {
    this.homeActive = true;
    if (!privacyConsent.canEnter()) return;
    this.setData({pageVisible: true});
    analytics.track('home_view');
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
    await runtimeConfig.fetchRemoteConfig();
    if (this.homeActive === false) return null;
    if (!api.isLoggedIn()) {
      this.setData({activeSessionId: ''});
      this.syncGuide();
      return '';
    }
    if (!runtimeConfig.isApiSupported('currentGame') || !runtimeConfig.isApiSupported('onlineArena')) {
      this.setData({activeSessionId: ''});
      this.syncGuide();
      return '';
    }
    if (!this.onlineGameRequest) {
      this.onlineGameRequest = api.get('/games/current').then((session) => {
        const activeSessionId = session?.sessionId ? String(session.sessionId) : '';
        this.setData({activeSessionId});
        this.syncGuide();
        return activeSessionId;
      }).catch(() => {
        this.syncGuide();
        wx.showToast({title: '联机对局查询失败，请重试', icon: 'none'});
        return this.data.activeSessionId || null;
      }).finally(() => {this.onlineGameRequest = null;});
    }
    return this.onlineGameRequest;
  },
  syncGuide() {
    const onlineAvailable = runtimeConfig.isApiSupported('onlineArena');
    this.setData({
      onlineAvailable,
      quickMatchAvailable: onlineAvailable && runtimeConfig.isApiSupported('quickMatch'),
      guideVisible: onlineAvailable && !this.data.activeSessionId && guideStore.shouldShowStep(guideStore.GUIDE_STEPS.HOME),
    });
  },
  onGuidePrimary() {
    return this.onPrimaryEntry();
  },
  onPrimaryEntry() {
    if (this.data.activeSessionId) return this.startGame();
    if (this.challengeCode && this.data.quickMatchAvailable) return this.startGame({quick: true, challengeCode: this.challengeCode});
    if (this.data.quickMatchAvailable) return this.quickStart();
    if (this.data.onlineAvailable) return this.startGame();
    return this.refreshEntryCapabilities();
  },
  async refreshEntryCapabilities() {
    if (this.data.entryRefreshing) return;
    this.setData({entryRefreshing: true});
    try {
      await runtimeConfig.fetchRemoteConfig(true);
      if (this.homeActive === false) return;
      this.syncGuide();
      if (!this.data.onlineAvailable) wx.showToast({title: '对战服务暂时不可用，请稍后重试', icon: 'none'});
    } finally {
      this.setData({entryRefreshing: false});
    }
  },
  toggleNav() {
    playVibrate('light');
    this.setData({navExpanded: !this.data.navExpanded});
  },
  async switchTab(e) {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    const page = e.currentTarget.dataset.page;
    if (!page || page === '/pages/home/index') return;
    if (page === '/pages/result/index') {
      try { wx.redirectTo({url: await latestResultUrl()}); }
      catch (error) { wx.showToast({title: error.message || '对局记录加载失败', icon: 'none'}); }
      return;
    }
    if (['/pages/room/index', '/pages/arena/index'].includes(page)) return this.startGame({replace: true});
    wx.redirectTo({url: page});
  },
  quickStart() {return this.startGame({quick: true});},
  async startGame(options = {}) {
    // 防重：快速双击会连续 navigateTo 两次，导致栈内出现两个房间页（I-9）
    if (this.enteringGame) return;
    this.enteringGame = true;
    try {
      await this.enterGame(options);
    } catch (error) {
      if (options.challengeCode && (error.statusCode === 404 || error.statusCode === 409)) {
        this.challengeCode = '';
        this.setData({challengePending: false});
      }
      wx.showToast({title: error.message || '连接失败，请重试', icon: 'none'});
    } finally {
      setTimeout(() => { this.enteringGame = false; }, 800);
    }
  },
  async enterGame(options = {}) {
    playCue('tap', {volume: 0.75});
    playVibrate('medium');
    await require('../../utils/user-profile').ensureLogin();
    const sessionId = await this.syncOnlineGame();
    if (sessionId === null) return;
    if (sessionId) {
      wx[options.replace ? 'redirectTo' : 'navigateTo']({url: `/pages/arena/index?sessionId=${encodeURIComponent(sessionId)}`});
      return;
    }
    if (!runtimeConfig.isApiSupported('onlineArena')) throw new Error('对战服务暂时不可用，请稍后重试');
    let stage = this.data.stages[this.data.activeStage] || DEFAULT_STAGE;
    if (options.quick && !runtimeConfig.isApiSupported('quickMatch')) throw new Error('快速匹配升级中，请稍后重试');
    const token = api.getToken();
    if (options.challengeCode) {
      const challenge = await api.get(`/matchmaking/challenge/${encodeURIComponent(options.challengeCode)}`);
      if (this.homeActive === false || (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return;
      stage = this.data.stages.find((item) => Number(item.id) === Number(challenge.stageId)) || DEFAULT_STAGE;
    }
    const attempt = options.quick ? analytics.playFlow.begin(stage.id) : null;
    let payload;
    try {
      const roomRequest = {stageId: stage.id};
      if (options.challengeCode) roomRequest.challengeCode = options.challengeCode;
      else if (options.quick) roomRequest.createFriendRoomIfEmpty = true;
      payload = await api.post(options.quick ? '/matchmaking' : '/rooms', roomRequest);
    }
    catch (error) {if (attempt) analytics.playFlow.failed(attempt, error); throw error;}
    if (this.homeActive === false || (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return;
    const room = payload && (payload.room || payload);
    if (!room || !room.id) {
      const error = new Error('房间创建失败，请重试');
      if (attempt) analytics.playFlow.failed(attempt, error);
      throw error;
    }
    if (attempt) analytics.playFlow.queued(attempt, String(room.id));
    if (options.challengeCode) {
      this.challengeCode = '';
      this.setData({challengePending: false});
    }
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.HOME)) {
      guideStore.advanceTo(guideStore.GUIDE_STEPS.ROOM);
      this.setData({guideVisible: false});
    }
    const navigation = {url: `/pages/room/index?backendRoomId=${encodeURIComponent(room.id)}`};
    if (options.quick && payload.autoCreatedFriendRoom === true) {
      navigation.success = () => wx.showToast({
        title: '当前在线玩家较少，已为您自动创建房间',
        icon: 'none',
        duration: 3000,
      });
    }
    wx[options.replace ? 'redirectTo' : 'navigateTo'](navigation);
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
    this.pauseActiveStageVideo();
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
    if (this.homeActive === false || !stage.video || typeof wx === 'undefined' || typeof wx.createVideoContext !== 'function') {
      return;
    }

    const play = () => {
      if (this.homeActive === false || stageIndex !== this.data.activeStage) return;
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
  pauseActiveStageVideo() {
    try {
      if (typeof wx !== 'undefined' && typeof wx.createVideoContext === 'function') {
        wx.createVideoContext(`stage-video-${Number(this.data.activeStage) || 0}`, this)?.pause?.();
      }
    } catch (_) {}
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
    if (!token) return;
    const requestId = this.summaryRequestId = (this.summaryRequestId || 0) + 1;
    const summary = await playerStats.fetchSummary();
    // 账号已切换或已退出时丢弃过期结果
    if (requestId !== this.summaryRequestId || !api.isLoggedIn()
      || (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return;
    if (summary) {
      this.serverSummary = summary;
      this.serverSummaryToken = api.getToken();
    }
    this.setData({summaryError: summary ? '' : '账号经验同步失败，请点击重试'});
    this.syncOverview();
  },
  syncOverview() {
    const shopState = shopStore.getStoreState();
    // 登录账号以服务端累计经验为准（I-6）；游客才使用设备本地统计
    const loggedIn = api.isLoggedIn();
    const summary = loggedIn && this.serverSummaryToken === api.getToken() ? this.serverSummary : null;
    const progress = summary ? buildExpProgress(summary.totalExp) : null;
    this.setData({
      balanceAmountText: shopState.assetSource === 'server' && shopState.syncStatus !== 'ready'
        ? '--' : loggedIn ? formatNumber(shopState.coins) : '--',
      levelText: progress ? `Lv.${progress.level}` : '--',
      experienceText: progress ? `${progress.current} / ${progress.required} 经验` : loggedIn ? '账号经验待同步' : '微信登录后查看等级与经验',
      progressPercent: progress ? progress.percent : 0,
      progressVisualPercent: progress ? getProgressVisualPercent(progress.percent) : 0,
      summaryError: loggedIn ? this.data.summaryError : '',
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
    analytics.track('share_click');
    return buildShareAppMessage('home');
  },
  onShareTimeline() {
    return buildShareTimeline('home');
  },
});
