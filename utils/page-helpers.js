/**
 * Shared page helper functions to reduce code duplication.
 * Each function takes a Page's `this` context (or the page instance)
 * and performs common sync operations.
 */

const gameStore = require('./game-store');
const audio = require('./audio');
const { getCachedProfile, hasValidProfile } = require('./user-profile');
const { DEFAULT_STAGE } = require('./constants');
const shopStore = require('./shop-store');

function syncUserProfile(page) {
  var cached = getCachedProfile();
  var current = page.data.userProfile || {};
  if (current.nickName === cached.nickName && current.avatarUrl === cached.avatarUrl) {
    return;
  }
  page.setData({ userProfile: cached });
}

function syncStageMusic(page) {
  var snapshot = gameStore.getState();
  audio.playStageBgm(snapshot.stage || DEFAULT_STAGE, {volume: 0.38});
}

function syncShopDisplay(page) {
  var display = shopStore.getEquippedDisplay();
  var current = page.data.shopDisplay || {};
  if (current.skinClass === display.skinClass && current.petIcon === display.petIcon) {
    return;
  }
  page.setData({ shopDisplay: display });
}

// 每个页面都挂着一路远程循环视频当背景。navigateTo 不会销毁上一个页面，
// 它的视频会继续在后台缓冲+播放，叠加起来就是同时拉好几路流。
// 离开页面时暂停、回来时续播，画面不变但只留当前页在跑。
var BACKDROP_VIDEO_ID = 'scene-backdrop-video';

function getBackdropVideoContext(page) {
  if (typeof wx === 'undefined' || typeof wx.createVideoContext !== 'function') {
    return null;
  }
  try {
    return wx.createVideoContext(BACKDROP_VIDEO_ID, page);
  } catch (error) {
    return null;
  }
}

function pauseBackdropVideo(page) {
  var context = getBackdropVideoContext(page);
  if (context && typeof context.pause === 'function') {
    try {
      context.pause();
    } catch (error) {}
  }
}

function resumeBackdropVideo(page) {
  var context = getBackdropVideoContext(page);
  if (context && typeof context.play === 'function') {
    try {
      context.play();
    } catch (error) {}
  }
}

module.exports = {
  BACKDROP_VIDEO_ID: BACKDROP_VIDEO_ID,
  pauseBackdropVideo: pauseBackdropVideo,
  resumeBackdropVideo: resumeBackdropVideo,
  syncUserProfile: syncUserProfile,
  syncStageMusic: syncStageMusic,
  syncShopDisplay: syncShopDisplay,
};
