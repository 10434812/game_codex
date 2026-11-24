const {getNavLayout} = require('../../../utils/nav');
const {legalConfig, isReady} = require('../../../utils/legal-config');

Page({
  data: {
    nav: {statusBarHeight: 20, navHeight: 64, capsuleSpace: 120},
    legalReady: false,
    legal: {},
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout(), legalReady: isReady(), legal: legalConfig});
    } catch (_error) {}
  },
  onBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({url: '/pages/boot/index'}),
    });
  },
});
