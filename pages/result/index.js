const {getNavLayout} = require('../../utils/nav');
const gameStore = require('../../utils/game-store');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');

const RESULT_FIREWORK_MS = 8000;
const RESULT_FIREWORK_STEP_MS = 1800;

function createEmptyTop3() {
  return {
    first: {
      name: '--',
      score: '0',
      avatar: '/assets/bg/avatars/avatar_01.png',
    },
    second: {
      name: '--',
      score: '0',
      avatar: '/assets/bg/avatars/avatar_02.png',
    },
    third: {
      name: '--',
      score: '0',
      avatar: '/assets/bg/avatars/avatar_03.png',
    },
  };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    top3: createEmptyTop3(),
    rankList: [],
    gainText: '0',
    coinText: '0',
    achievementText: '--',
    totalText: '总计 0 玩家',
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
    showScorePopup: false,
    selectedPlayer: null,
    scoreBreakdown: {
      baseScore: '0',
      achievementBonus: '0',
      teamBonus: '0',
      penalty: '0',
    },
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    this.refreshResult();
  },
  onShow() {
    this.syncUserProfile();
    this.playResultFirework();
    this.refreshResult();
  },
  onHide() {
    this.stopResultFirework();
  },
  onUnload() {
    this.stopResultFirework();
  },
  playResultFirework() {
    this.stopResultFirework();
    playCue('resultWin', {volume: 0.8});
    this.resultWinInterval = setInterval(() => {
      playCue('resultWin', {volume: 0.8});
    }, RESULT_FIREWORK_STEP_MS);
    this.resultWinTimer = setTimeout(() => {
      this.stopResultFirework();
    }, RESULT_FIREWORK_MS);
  },
  stopResultFirework() {
    if (this.resultWinTimer) {
      clearTimeout(this.resultWinTimer);
      this.resultWinTimer = null;
    }
    if (this.resultWinInterval) {
      clearInterval(this.resultWinInterval);
      this.resultWinInterval = null;
    }
  },
  refreshResult() {
    const state = gameStore.getState();
    if (state.status !== 'finished' || !state.result) {
      wx.reLaunch({url: '/pages/home/index'});
      return;
    }

    this.setData({
      top3: state.result.top3,
      rankList: state.result.rest,
      gainText: formatNumber(state.result.gain),
      coinText: formatNumber(state.result.coins),
      achievementText: state.result.achievement,
      totalText: `总计 ${state.result.ranking.length} 玩家`,
    });
  },
  replay() {
    playCue('tap', {volume: 0.75});
    gameStore.restartGame();
    wx.redirectTo({url: '/pages/arena/index'});
  },
  goHome() {
    playCue('tap', {volume: 0.75});
    gameStore.resetToHome();
    wx.reLaunch({url: '/pages/home/index'});
  },
  syncUserProfile() {
    const cached = getCachedProfile();
    this.setData({
      userProfile: cached,
      userAuthorized: hasValidProfile(cached),
    });
  },
  onTapProfile() {
    wx.navigateTo({url: '/pages/profile/index'});
  },
  onTapPlayer(e) {
    const player = e.currentTarget.dataset.player;
    if (!player || player.name === '--') return;

    playCue('tap', {volume: 0.75});
    
    // Mock score breakdown based on total score
    const total = parseInt((player.score || '0').replace(/,/g, ''), 10) || 0;
    const isWin = total > 0;
    
    let baseScore = 0;
    let achievementBonus = 0;
    let teamBonus = 0;
    let penalty = 0;
    
    if (isWin) {
      baseScore = Math.floor(total * 0.45);
      achievementBonus = Math.floor(total * 0.25);
      teamBonus = total - baseScore - achievementBonus;
      // random minor penalty between 0 to 5% of total
      penalty = Math.floor(total * Math.random() * 0.05);
      // adjust base score to keep the math right if penalty exists
      baseScore += penalty; 
    } else {
      penalty = Math.floor(Math.random() * 50) + 10;
      baseScore = total + penalty; // base - penalty = total
    }

    this.setData({
      showScorePopup: true,
      selectedPlayer: player,
      scoreBreakdown: {
        baseScore: formatNumber(baseScore),
        achievementBonus: formatNumber(achievementBonus),
        teamBonus: formatNumber(teamBonus),
        penalty: formatNumber(penalty),
      }
    });
  },
  closeScorePopup() {
    playCue('tap', {volume: 0.75});
    this.setData({
      showScorePopup: false,
    });
  },
});
