const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const {formatCurrency, formatDateTime, formatNumber} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');
const pageHelpers = require('../../utils/page-helpers');
const privacyConsent = require('../../utils/privacy-consent');
const {ensureLogin} = require('../../utils/user-profile');

function buildTypeLabel(type) {
  const map = {
    game_reward: '对局结算',
    daily_task: '每日任务',
    daily_checkin: '每日签到',
    growth_reward: '成长奖励',
    purchase: '商城购买',
    buy: '商城购买',
    fortune_bag: '福袋固定奖励',
  };
  return map[type] || '资金变动';
}

function buildListView(records = []) {
  return (records || []).map((item) => ({
    ...item,
    typeText: buildTypeLabel(item.type),
    amountText: formatCurrency(item.amount, {showSign: true}),
    balanceText: item.balanceAfter === null || item.balanceAfter === undefined ? '--' : formatCurrency(item.balanceAfter),
    timeText: (() => {
      const timestamp = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.parse(item.createdAt);
      return timestamp > 0 && Number.isFinite(timestamp) ? formatDateTime(timestamp) : '时间未知';
    })(),
  }));
}

const DEFAULT_STAGE_THEME_DATA = createStageThemeData();

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    stageName: DEFAULT_STAGE_THEME_DATA.stageName,
    stageImage: DEFAULT_STAGE_THEME_DATA.stageImage,
    stageVideo: DEFAULT_STAGE_THEME_DATA.stageVideo,
    stageThemeKey: DEFAULT_STAGE_THEME_DATA.stageThemeKey,
    stageThemeStyle: DEFAULT_STAGE_THEME_DATA.stageThemeStyle,
    balanceAmountText: '0',
    records: [],
    recordsStatusText: '',
    loading: false,
    loadingMore: false,
    hasMore: false,
    page: 0,
    moreError: '',
    recordsLoginRequired: false,
    loginPending: false,
    accountLabel: '账号资产',
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    if (!privacyConsent.canEnter()) return;
  },
  onHide() {
    pageHelpers.pauseBackdropVideo(this);
  },
  onUnload() {
    this.recordsUnloaded = true;
    this.recordsLoginEpoch = (this.recordsLoginEpoch || 0) + 1;
    this.recordsRequestId = (this.recordsRequestId || 0) + 1;
    this.recordsToken = '';
  },
  onShow() {
    if (!privacyConsent.canEnter()) return;
    pageHelpers.resumeBackdropVideo(this);
    this.syncRecords();
  },
  async syncRecords() {
    const requestId = (this.recordsRequestId || 0) + 1;
    this.recordsRequestId = requestId;
    const gameState = gameStore.getState();
    const theme = saveStageTheme(resolveAmbientStage(gameState));
    this.setData({
      recordsStatusText: '',
      loading: true,
      loadingMore: false,
      moreError: '',
      hasMore: false,
      page: 0,
      recordsLoginRequired: false,
      accountLabel: '账号资产',
      stageName: theme.stageName,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
    const token = api.getToken();
    this.recordsToken = token;
    if (token) {
      this.setData({balanceAmountText: '--', accountLabel: '余额同步中…', records: []});
      await Promise.all([this.loadFirstPage(requestId, token), this.syncBalance(requestId, token)]);
      return;
    }
    this.setData({balanceAmountText: '--', records: [], loading: false, recordsLoginRequired: true,
      recordsStatusText: '微信登录后查看锦鲤币和资金明细'});
  },
  async loadFirstPage(requestId, token) {
    try {
      const data = await api.get('/stats/coin-records', {page: 1, limit: 50});
      if (!this.isCurrentRecordsRequest(requestId, token)) return;
      if (!data || !Array.isArray(data.records)) throw new Error('服务器流水数据无效');
      this.recordsToken = api.getToken();
      this.setData({records: buildListView(data.records), page: 1,
        hasMore: data.records.length > 0 && data.records.length < Number(data.total)});
    } catch (error) {
      if (this.showExpiredRecordsLogin(requestId)) return;
      if (!this.isCurrentRecordsRequest(requestId, token)) return;
      this.setData({recordsStatusText: '账号流水同步失败，请点击重试'});
    } finally {
      if (this.isCurrentRecordsRequest(requestId, token)) this.setData({loading: false});
    }
  },
  async syncBalance(requestId, token) {
    try {
      const assets = await shopStore.refreshInventory();
      if (this.isCurrentRecordsRequest(requestId, token)) {
        this.setData({balanceAmountText: formatNumber(assets.coins), accountLabel: '账号资产'});
      }
    } catch (error) {
      if (this.showExpiredRecordsLogin(requestId)) return;
      if (this.isCurrentRecordsRequest(requestId, token)) this.setData({accountLabel: '余额暂未同步'});
    }
  },
  showExpiredRecordsLogin(requestId) {
    if (requestId !== this.recordsRequestId || api.getToken()) return false;
    this.recordsToken = '';
    this.setData({recordsLoginRequired: true, recordsStatusText: '登录已失效，请微信登录后继续查看',
      balanceAmountText: '--', accountLabel: '账号资产', records: [], loading: false, loadingMore: false, hasMore: false, page: 0});
    return true;
  },
  isCurrentRecordsRequest(requestId, token) {
    return requestId === this.recordsRequestId && (token === api.getToken() || api.isRecoveredToken(token, api.getToken()));
  },
  async loginAndSyncRecords() {
    if (this.data.loginPending) return;
    const epoch = this.recordsLoginEpoch || 0;
    this.setData({loginPending: true});
    try {
      await ensureLogin();
      if (epoch === (this.recordsLoginEpoch || 0)) await this.syncRecords();
    } catch (error) {
      if (epoch === (this.recordsLoginEpoch || 0)) this.setData({recordsStatusText: error.message || '微信登录失败，请重试'});
    } finally {
      if (!this.recordsUnloaded) this.setData({loginPending: false});
    }
  },
  async loadMoreRecords() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    const token = api.getToken();
    if (!token || (token !== this.recordsToken && !api.isRecoveredToken(this.recordsToken, token))) return;
    const requestId = this.recordsRequestId;
    const nextPage = this.data.page + 1;
    this.setData({loadingMore: true, moreError: ''});
    try {
      const data = await api.get('/stats/coin-records', {page: nextPage, limit: 50});
      if (!this.isCurrentRecordsRequest(requestId, token)) return;
      if (!data || !Array.isArray(data.records)) throw new Error('流水数据无效');
      const ids = new Set(this.data.records.map((record) => String(record.id)));
      const added = data.records.filter((record) => {
        const id = String(record.id);
        if (ids.has(id)) return false;
        ids.add(id);
        return true;
      });
      const records = [...this.data.records, ...buildListView(added)];
      this.setData({records, page: nextPage, hasMore: data.records.length > 0 && records.length < Number(data.total)});
      this.recordsToken = api.getToken();
    } catch (error) {
      if (this.showExpiredRecordsLogin(requestId)) return;
      if (this.isCurrentRecordsRequest(requestId, token)) {
        this.setData({moreError: '更多流水加载失败，点击重试'});
      }
    } finally {
      if (this.isCurrentRecordsRequest(requestId, token)) this.setData({loadingMore: false});
    }
  },
  onBack() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    wx.navigateBack({delta: 1});
  },
});
