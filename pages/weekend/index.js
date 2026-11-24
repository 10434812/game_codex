const api = require('../../utils/api-client');
const {getNavLayout} = require('../../utils/nav');
const privacyConsent = require('../../utils/privacy-consent');
const {ensureLogin} = require('../../utils/user-profile');

Page({
  data: {nav: {}, activity: null, error: '', loading: false},
  onLoad() { this.setData({nav: getNavLayout()}); },
  onShow() {
    if (!privacyConsent.canEnter()) return;
    if (api.isLoggedIn()) this.load();
  },
  onHide() { this.request = null; this.setData({activity: null, loading: false}); },
  onUnload() { this.request = null; },
  back() { wx.navigateBack({fail: () => wx.redirectTo({url: '/pages/home/index'})}); },
  async load() {
    if (this.request) return;
    const request = this.request = {};
    this.setData({loading: true, error: ''});
    try {
      await ensureLogin();
      if (request !== this.request) return;
      const activity = await api.get('/weekend');
      if (request === this.request) this.setData({activity});
    } catch (error) {
      if (request === this.request) this.setData({error: error.message || '活动暂不可用'});
    } finally {
      if (request === this.request) { this.request = null; this.setData({loading: false}); }
    }
  }
});
