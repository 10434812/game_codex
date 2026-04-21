const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_STAGE, ROOM_UI_LIMIT, WAITING_SLOT_NAME} = require('../../utils/constants');
const gameStore = require('../../utils/game-store');
const {playCue} = require('../../utils/audio');
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile');

function buildEmptySlot() {
  return {
    name: WAITING_SLOT_NAME,
    state: '',
    filled: false,
    star: false,
  };
}

function mapRoomSlots(players) {
  const filledSlots = (players || []).slice(0, ROOM_UI_LIMIT).map((player) => ({
    name: player.name,
    state: player.state || (player.isSelf ? '房主' : '已就绪'),
    filled: true,
    star: !!player.isSelf,
    avatar: player.avatar,
  }));

  while (filledSlots.length < ROOM_UI_LIMIT) {
    filledSlots.push(buildEmptySlot());
  }

  return filledSlots;
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    slots: Array.from({length: ROOM_UI_LIMIT}, buildEmptySlot),
    stageName: DEFAULT_STAGE.name,
    roomId: '----',
    activePercent: 0,
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()});
    } catch (error) {}
    this.refreshRoom();
  },
  onShow() {
    this.syncUserProfile();
    this.refreshRoom();
  },
  refreshRoom() {
    const snapshot = gameStore.getState();
    const state = gameStore.ensureRoom(snapshot.stage || DEFAULT_STAGE);
    const activePercent = Math.round((state.players.length / ROOM_UI_LIMIT) * 100);
    this.setData({
      slots: mapRoomSlots(state.players),
      stageName: state.stage.name,
      roomId: state.roomId,
      activePercent,
    });
  },
  inviteFriend() {
    playCue('tap', {volume: 0.75});
    playCue('invite', {volume: 0.7});
    const before = gameStore.getState();
    const state = gameStore.inviteHumanPlayer();
    if (state.players.length > before.players.length) {
      playCue('inviteSuccess', {volume: 0.8});
      wx.showToast({title: '邀请成功', icon: 'none'});
    } else {
      playCue('actionFail', {volume: 0.7});
      wx.showToast({title: '房间已满', icon: 'none'});
    }
    this.refreshRoom();
  },
  start() {
    playCue('tap', {volume: 0.75});
    playCue('countdown3', {volume: 0.55});
    setTimeout(() => playCue('countdown2', {volume: 0.55}), 260);
    setTimeout(() => playCue('countdown1', {volume: 0.55}), 520);
    setTimeout(() => playCue('gameStart', {volume: 0.85}), 800);
    const state = gameStore.startGame();
    this.setData({slots: mapRoomSlots(state.players)});
    wx.redirectTo({url: '/pages/arena/index'});
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
});
