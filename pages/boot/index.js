const {createBootLoader, createImagePreloadTask, getBootAssetQueue} = require('../../utils/boot-loader');
const gameStore = require('../../utils/game-store');
const api = require('../../utils/api-client');
const userProfile = require('../../utils/user-profile');
const runtimeConfig = require('../../utils/runtime-config');
const {playVoice} = require('../../utils/audio');
const {getNavLayout} = require('../../utils/nav');
const legal = require('../../utils/legal-config');
const privacy = require('../../utils/privacy-consent');

const DEFAULT_MIN_MS = 2000;
// 慢网下 2.7s 硬超时会在预加载没跑完时就 reLaunch，首页拿到的是空图；
// 放宽到 4.2s 只影响弱网（快网仍由 MIN_MS 决定节奏）。
const DEFAULT_MAX_MS = 4200;
const DEFAULT_HOLD_MS = 300;

// 远程文件名含中文。经 wx 网络层发出时会自动按 RFC 3986 转义，此处保留原样便于和 CDN 对账。
const BOOT_VIDEOS = [
  'https://xcx.ukb88.com/assets/bg/开机动画1-compressed.mp4',
  'https://xcx.ukb88.com/assets/bg/开机动画2-compressed.mp4',
  'https://xcx.ukb88.com/assets/bg/开机动画3-compressed.mp4',
  'https://xcx.ukb88.com/assets/bg/开机动画4-compressed.mp4',
];

const BOOT_VIDEO_POSTER = 'https://xcx.ukb88.com/assets/bg/bg.png';

// 启动页网络阶段（拉配置 + 自动登录）共用的时间预算；超时即放行，避免弱网下启动页停留 30 秒以上（I-8）
const BOOT_NETWORK_BUDGET_MS = 4200;
const BOOT_LOGIN_MIN_MS = 1500;

function withBootTimeout(promise, ms) {
  let timer = null;
  const limit = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function tryAutoLogin() {
  if (privacy.isDevelopmentPreview()) return;
  privacy.assertAllowed();
  // 用户主动退出登录后不再自动换回同一账号；重新同意协议才视为登录意图（I-5）
  if (!api.isLoggedIn() && !userProfile.hasLogoutIntent() && runtimeConfig.getBoolean('wechat.login_enabled', true)) {
    await userProfile.login();
  }
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    bootVideoSrc: '',
    bootVideoPoster: BOOT_VIDEO_POSTER,
    progress: 0,
    loadingText: '正在加载资源',
    privacyRequired: false,
    privacyError: '',
    privacyChecking: false,
    legalReady: false,
    consentGranted: false,
    previewAvailable: false,
    developmentPreview: false,
  },
  onLoad(options = {}) {
    this.destination = privacy.restoreDestination(options.returnTo);
    this.setData({nav: getNavLayout(), previewAvailable: privacy.isDevelopmentPreviewAvailable()});
    this.isDestroyed = false;
    this.startBoot();
  },
  onUnload() {
    this.isDestroyed = true;
    if (!privacy.canEnter()) privacy.revoke();
    if (this.privacyResolver) {
      this.privacyResolver(false);
      this.privacyResolver = null;
    }
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.videoContext) {
      this.videoContext.stop();
    }
  },
  onReady() {
    this.videoContext = wx.createVideoContext('bootVideo');
  },
  onVideoEnded() {
  },
  updateProgress(progress) {
    if (this.isDestroyed) return;
    this.setData({
      progress,
      loadingText: progress >= 100 ? '加载完成' : '正在加载资源',
    });
  },
  finishBoot() {
    if (this.isDestroyed) return;
    this.setData({progress: 100, loadingText: '加载完成'});
    playVoice('bootReady', {debounceMs: 0});
    const holdMs = this._bootHoldMs || DEFAULT_HOLD_MS;
    this.holdTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      if (!privacy.canEnter()) return;
      wx.reLaunch({url: this.destination});
    }, holdMs);
  },
  openPrivacyPolicy() {
    wx.navigateTo({url: '/pages/legal/privacy/index'});
  },
  openUserAgreement() {
    wx.navigateTo({url: '/pages/legal/agreement/index'});
  },
  async onAgreePrivacy() {
    if (this.data.privacyChecking || !legal.isReady()) return;
    this.setData({privacyChecking: true, privacyError: ''});
    try {
      await privacy.authorize();
      if (this.isDestroyed) {
        privacy.revoke();
        return;
      }
      // 用户重新明确同意并发起授权，视为新的登录意图，清除此前的主动退出标记
      userProfile.clearLogoutIntent();
      this.completePrivacyConsent();
    } catch (_error) {
      if (!this.isDestroyed) this.setData({privacyError: '微信隐私授权未完成，请重试或退出小程序'});
    } finally {
      if (!this.isDestroyed) this.setData({privacyChecking: false});
    }
  },
  completePrivacyConsent() {
    this.setData({privacyRequired: false, consentGranted: true});
    if (this.privacyResolver) {
      this.privacyResolver(true);
      this.privacyResolver = null;
    } else if (!this.isDestroyed) {
      this.bootStarted = false;
      this.startBoot();
    }
  },
  onEnterDevelopmentPreview() {
    if (this.isDestroyed || !privacy.isDevelopmentPreviewAvailable()) return;
    privacy.beginDevelopmentPreview();
    this.setData({privacyRequired: false, developmentPreview: true, privacyError: ''});
    if (this.privacyResolver) {
      this.privacyResolver(true);
      this.privacyResolver = null;
    } else {
      this.bootStarted = false;
      this.startBoot();
    }
  },
  onRejectPrivacy() {
    privacy.revoke();
    if (this.privacyResolver) {
      this.privacyResolver(false);
      this.privacyResolver = null;
    }
    this.setData({privacyRequired: true, consentGranted: false, developmentPreview: false, privacyError: '你尚未同意，未登录或进入游戏。可重新授权或退出。'});
    if (typeof wx.exitMiniProgram === 'function') {
      wx.exitMiniProgram({
        fail: () => this.setData({privacyError: '未能自动退出，请点击右上角关闭小程序；也可重新打开后授权。'}),
      });
    } else {
      this.setData({privacyError: '请点击右上角关闭小程序。'});
    }
  },
  retryPrivacy() {
    if (this.privacyResolver) this.checkPrivacySetting();
    else {
      this.bootStarted = false;
      this.startBoot();
    }
  },
  async checkPrivacySetting() {
    this.setData({legalReady: legal.isReady(), privacyRequired: true, privacyError: '', privacyChecking: true});
    try {
      const allowed = await privacy.checkPlatformConsent();
      if (!this.isDestroyed && allowed) this.completePrivacyConsent();
    } catch (error) {
      if (!this.isDestroyed) this.setData({privacyError: this.data.previewAvailable && !this.data.legalReady
        ? '正式协议准备中，开发版可先进入本地预览。'
        : error.message || '无法获取微信隐私授权状态，请检查网络后重试。'});
    } finally {
      if (!this.isDestroyed) this.setData({privacyChecking: false});
    }
  },
  waitForPrivacyConsent() {
    return new Promise((resolve) => {
      this.privacyResolver = resolve;
      this.checkPrivacySetting();
    });
  },
  async startBoot() {
    if (this.bootStarted) return;
    this.bootStarted = true;
    const consented = privacy.canEnter() || await this.waitForPrivacyConsent();
    if (!consented || this.isDestroyed) return;
    this.setData({privacyRequired: false, consentGranted: privacy.isAllowed(), developmentPreview: privacy.isDevelopmentPreview()});
    this.setData({bootVideoSrc: BOOT_VIDEOS[Math.floor(Math.random() * BOOT_VIDEOS.length)]});
    playVoice('bootWelcome', {debounceMs: 0});

    const minMs = this._bootMinMs || DEFAULT_MIN_MS;
    const maxMs = this._bootMaxMs || DEFAULT_MAX_MS;

    // 优先预加载当前（上次游玩）景区背景，配合头像池/福袋图
    const currentStage = (gameStore.getState() || {}).stage || null;
    const tasks = getBootAssetQueue(currentStage).map((src) => createImagePreloadTask(src));
    const loader = createBootLoader(tasks, (progress) => {
      this.updateProgress(progress);
    });

    const loadingDone = loader.start();
    const minTimer = new Promise((r) => setTimeout(r, minMs));
    const maxTimer = new Promise((r) => setTimeout(r, maxMs));

    Promise.race([
      Promise.all([loadingDone, minTimer]),
      maxTimer,
    ]).then(async () => {
      if (!privacy.canEnter() || this.isDestroyed) return;
      const budgetEnd = Date.now() + BOOT_NETWORK_BUDGET_MS;
      await withBootTimeout(runtimeConfig.fetchRemoteConfig(), BOOT_NETWORK_BUDGET_MS);
      // 登录超时后放行进入游客态；登录仍在后台完成，资料与 token 由 userProfile 的修订号保护
      await withBootTimeout(tryAutoLogin(), Math.max(BOOT_LOGIN_MIN_MS, budgetEnd - Date.now()));
      this.finishBoot();
    }).catch(() => {
      if (this.isDestroyed) return;
      this.bootStarted = false;
      this.setData({privacyRequired: true, privacyError: '启动失败，请检查网络后重试。'});
    });
  },
});
