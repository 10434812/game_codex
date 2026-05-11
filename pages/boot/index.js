const {createBootLoader, createImagePreloadTask, getBootAssetQueue} = require('../../utils/boot-loader');
const api = require('../../utils/api-client');
const userProfile = require('../../utils/user-profile');

const DEFAULT_MIN_MS = 2000;
const DEFAULT_MAX_MS = 2700;
const DEFAULT_HOLD_MS = 300;

const BOOT_VIDEOS = [
  'https://xcx.ukb88.com/assets/bg/开机动画1.mp4',
  'https://xcx.ukb88.com/assets/bg/开机动画2.mp4',
  'https://xcx.ukb88.com/assets/bg/开机动画3.mp4',
  'https://xcx.ukb88.com/assets/bg/开机动画4.mp4',
];

async function tryAutoLogin() {
  if (!api.isLoggedIn()) {
    await userProfile.login();
  }
}

Page({
  data: {
    bootVideoSrc: BOOT_VIDEOS[Math.floor(Math.random() * BOOT_VIDEOS.length)],
    progress: 0,
    loadingText: '正在加载资源',
  },
  onLoad() {
    this.startBoot();
  },
  onUnload() {
    this.isDestroyed = true;
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
    const holdMs = this._bootHoldMs || DEFAULT_HOLD_MS;
    this.holdTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      wx.reLaunch({url: '/pages/home/index'});
    }, holdMs);
  },
  startBoot() {
    if (this.bootStarted) return;
    this.bootStarted = true;

    const minMs = this._bootMinMs || DEFAULT_MIN_MS;
    const maxMs = this._bootMaxMs || DEFAULT_MAX_MS;

    const tasks = getBootAssetQueue().map((src) => createImagePreloadTask(src));
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
      await tryAutoLogin();
      this.finishBoot();
    });
  },
});
