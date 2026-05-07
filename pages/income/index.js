const {getNavLayout} = require('../../utils/nav');
const shopStore = require('../../utils/shop-store');
const {formatCurrency, formatDateTime} = require('../../utils/format');
const {playCue, playVibrate} = require('../../utils/audio');

function buildTypeLabel(type) {
  const map = {
    game_reward: '对局结算',
    purchase: '商城购买',
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

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
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
  syncRecords() {
    const state = shopStore.getStoreState();
    const records = shopStore.getCoinRecords();
    this.setData({
      balanceText: formatCurrency(state.coins),
      records: buildListView(records, state.coins),
    });
  },
  onBack() {
    playCue('tap', {volume: 0.75});
    playVibrate('light');
    wx.navigateBack({delta: 1});
  },
});
