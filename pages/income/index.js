const {getNavLayout} = require('../../utils/nav');
const api = require('../../utils/api-client');
const gameStore = require('../../utils/game-store');
const shopStore = require('../../utils/shop-store');
const {formatCurrency, formatDateTime} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');
const {createStageThemeData, resolveAmbientStage, saveStageTheme} = require('../../utils/stage-theme');

function buildTypeLabel(type) {
  const map = {
    game_reward: '对局结算',
    purchase: '商城购买',
    buy: '商城购买',
    trade_buy: '机会买入',
    trade_sell: '机会卖出',
  };
  return map[type] || '资金变动';
}

function buildListView(records = [], balance) {
  const fallbackBalance = Math.max(0, Number(balance) || 0);
  return (records || []).map((item) => ({
    ...item,
    typeText: buildTypeLabel(item.type),
    amountText: formatCurrency(item.amount, {showSign: true}),
    balanceText: formatCurrency(item.balanceAfter || fallbackBalance),
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
    balanceText: '¥0',
    records: [],
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
  },
  onShow() {
    this.syncRecords();
  },
  async syncRecords() {
    const gameState = gameStore.getState();
    const theme = saveStageTheme(resolveAmbientStage(gameState));
    try {
      if (api.isLoggedIn()) {
        const data = await api.get('/stats/coin-records', { page: 1, limit: 50 });
        if (data && data.records) {
          const userData = await api.get('/user/profile');
          this.setData({
            balanceText: formatCurrency(userData.coins || 0),
            records: buildListView(data.records, userData.coins),
            stageName: theme.stageName,
            stageImage: theme.stageImage,
            stageVideo: theme.stageVideo,
            stageThemeKey: theme.stageThemeKey,
            stageThemeStyle: theme.stageThemeStyle,
          });
          return;
        }
      }
    } catch (err) {
      console.warn('[income] API error:', err);
    }
    // Fallback to local
    const state = shopStore.getStoreState();
    const records = shopStore.getCoinRecords();
    this.setData({
      balanceText: formatCurrency(state.coins),
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
