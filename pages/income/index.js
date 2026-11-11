const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const {formatCurrency, formatDateTime, formatNumber} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');
const pageHelpers = require('../../utils/page-helpers');
const privacyConsent = require('../../utils/privacy-consent');

function buildTypeLabel(type) {
  const map = {
    game_reward: '对局结算',
    daily_task: '每日任务',
    purchase: '商城购买',
    buy: '商城购买',
    fortune_bag: '福袋固定奖励',
  };
  return map[type] || '资金变动';
}

function buildListView(records = [], balance) {
  const fallbackBalance = Math.max(0, Number(balance) || 0);
  return (records || []).map((item) => ({
    ...item,
    typeText: buildTypeLabel(item.type),
    amountText: formatCurrency(item.amount, {showSign: true}),
    balanceText: formatCurrency(item.balanceAfter === null || item.balanceAfter === undefined
      ? fallbackBalance : item.balanceAfter),
    timeText: formatDateTime(item.createdAt),
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
    accountLabel: '游客本地体验账户',
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
      accountLabel: api.isLoggedIn() ? '服务器账号资产' : '游客本地体验账户',
      stageName: theme.stageName,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
    const token = api.getToken();
    if (token) {
      this.setData({balanceAmountText: '--', records: []});
      try {
        const [data, assets] = await Promise.all([
          api.get('/stats/coin-records', {page: 1, limit: 50}),
          shopStore.refreshInventory(),
        ]);
        if (requestId !== this.recordsRequestId) return;
        if (token !== api.getToken()) throw new Error('登录账号已变更，请重新打开明细');
        if (!data || !Array.isArray(data.records)) throw new Error('服务器流水数据无效');
        this.setData({
          balanceAmountText: formatNumber(assets.coins),
          records: buildListView(data.records, assets.coins),
        });
      } catch (error) {
        if (requestId !== this.recordsRequestId || token !== api.getToken()) return;
        this.setData({recordsStatusText: '账号流水同步失败，请点击重试'});
        wx.showToast({title: error.message || '账号流水同步失败，请稍后重试', icon: 'none'});
      }
      return;
    }
    // 只有进入页面时即为游客，才读取游客本地流水。
    const state = shopStore.getStoreState();
    const records = shopStore.getCoinRecords();
    this.setData({
      balanceAmountText: formatNumber(state.coins),
      records: buildListView(records, state.coins),
      stageName: theme.stageName,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
    });
  },
  onBack() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    wx.navigateBack({delta: 1});
  },
});
