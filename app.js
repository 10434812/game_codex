const audio = require('./utils/audio.js');
const gameStore = require('./utils/game-store');
const runtimeConfig = require('./utils/runtime-config');
const privacy = require('./utils/privacy-consent');

App({
  onLaunch(options = {}) {
    this.audio = audio;
    this._isInitialLaunch = true;
    this._maintenanceNotified = false;
    this.enforcePrivacyEntry(options);
  },
  onShow(options = {}) {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const current = pages[pages.length - 1];
    if (current && current.route) options = {path: current.route, query: current.options || {}};
    if (this.enforcePrivacyEntry(options)) return;
    this.checkMaintenance();
    if (this._isInitialLaunch) {
      this._isInitialLaunch = false;
      return;
    }
    if (this.audio && typeof this.audio.playStageBgm === 'function') {
      this.audio.playStageBgm(gameStore.getState().stage, {volume: 0.38});
    }
  },
  onHide() {
    // 切后台时暂停本地对局计时，避免后台跑完静默结算
    gameStore.pauseGame();
    // 退后台暂停 BGM，避免小程序在后台继续播放
    if (this.audio && typeof this.audio.stopBgm === 'function') {
      this.audio.stopBgm();
    }
  },
  enforcePrivacyEntry(options = {}) {
    if (privacy.canEnter()) return false;
    const route = String(options.path || '').replace(/^\//, '');
    if (route === 'pages/boot/index' || /^pages\/legal\/(privacy|agreement)\/index$/.test(route)) return true;
    if (!this._privacyRedirecting && typeof wx.reLaunch === 'function') {
      this._privacyRedirecting = true;
      wx.reLaunch({
        url: privacy.bootUrl(options),
        complete: () => { this._privacyRedirecting = false; },
      });
    }
    return true;
  },
  // 维护模式提示（每个会话只弹一次；首页检查时会跳过已提示）
  checkMaintenance() {
    if (this._maintenanceNotified) {
      return;
    }
    const features = runtimeConfig.getFeatures();
    const maintenance = features && features.maintenance;
    if (!maintenance || !maintenance.enabled) {
      return;
    }
    this._maintenanceNotified = true;
    if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
      wx.showModal({
        title: '系统维护中',
        content: maintenance.message || '锦鲤前程正在维护升级，请稍后再来～',
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },
  audio: null
});
