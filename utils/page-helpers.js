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

module.exports = {
  syncUserProfile: syncUserProfile,
  syncStageMusic: syncStageMusic,
  syncShopDisplay: syncShopDisplay,
};
