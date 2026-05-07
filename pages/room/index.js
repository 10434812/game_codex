const {getNavLayout} = require('../../utils/nav')
const {DEFAULT_STAGE, MATCH_MODE_TEXT, NAV_TABS, ROOM_UI_LIMIT, WAITING_SLOT_NAME} = require('../../utils/constants')
const gameStore = require('../../utils/game-store')
const {playCue, playVibrate} = require('../../utils/audio')
const {getCachedProfile, hasValidProfile} = require('../../utils/user-profile')

function buildEmptySlot() {
  return {
    name: WAITING_SLOT_NAME,
    state: '',
    filled: false,
    star: false,
  }
}

function mapRoomSlots(players) {
  const filledSlots = (players || []).slice(0, ROOM_UI_LIMIT).map((player) => ({
    name: player.name,
    state: player.state || (player.isSelf ? '房主' : '已就绪'),
    filled: true,
    star: !!player.isSelf,
    avatar: player.avatar,
  }))

  while (filledSlots.length < ROOM_UI_LIMIT) {
    filledSlots.push(buildEmptySlot())
  }

  return filledSlots
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    modeText: MATCH_MODE_TEXT,
    tabs: NAV_TABS,
    activeTab: 'social',
    slots: Array.from({length: ROOM_UI_LIMIT}, buildEmptySlot),
    stageName: DEFAULT_STAGE.name,
    roomId: '----',
    activePercent: 0,
    selfReady: true,
    starting: false,
    startButtonText: '开始游戏',
    roomHintText: '准备好后，游戏将在两分钟内开始',
    userProfile: getCachedProfile(),
    userAuthorized: hasValidProfile(getCachedProfile()),
  },
  onLoad() {
    try {
      this.setData({nav: getNavLayout()})
    } catch (error) {}
    this.refreshRoom()
  },
  onShow() {
    this.syncUserProfile()
    const snapshot = gameStore.getState()
    this.observeState(gameStore.ensureRoom(snapshot.stage || DEFAULT_STAGE))
    this.unsubscribeStore()
    this.unsubscribe = gameStore.subscribe((state) => {
      this.observeState(state)
    })
  },
  onHide() {
    this.clearStartCountdown()
    this.unsubscribeStore()
  },
  onUnload() {
    this.clearStartCountdown()
    this.unsubscribeStore()
  },
  observeState(state) {
    if (!state) {
      return
    }
    if (state.status === 'idle') {
      const ensured = gameStore.ensureRoom(state.stage || DEFAULT_STAGE)
      this.observeState(ensured)
      return
    }
    if (state.status === 'playing') {
      this.clearStartCountdown()
      wx.redirectTo({url: '/pages/arena/index'})
      return
    }
    if (state.status === 'finished') {
      this.clearStartCountdown()
      wx.redirectTo({url: '/pages/result/index'})
      return
    }

    const activePercent = Math.round((state.players.length / ROOM_UI_LIMIT) * 100)
    const selfPlayer = state.players.find((player) => player.isSelf) || state.players[0]
    const selfReady = !selfPlayer || selfPlayer.ready !== false
    this.setData({
      slots: mapRoomSlots(state.players),
      stageName: state.stage.name,
      roomId: state.roomId,
      activePercent,
      selfReady,
      modeText: state.modeText || MATCH_MODE_TEXT,
    })
  },
  inviteFriend() {
    if (this.data.starting) {
      return
    }
    playCue('tap', {volume: 0.75})
    playVibrate('light')
    playCue('invite', {volume: 0.7})
    const before = gameStore.getState()
    const state = gameStore.inviteHumanPlayer()
    if (state.players.length > before.players.length) {
      playCue('inviteSuccess', {volume: 0.8})
      wx.showToast({title: '邀请已发送', icon: 'none'})
    } else {
      playCue('actionFail', {volume: 0.7})
      wx.showToast({title: '房间人数已满', icon: 'none'})
    }
    this.observeState(state)
  },
  toggleReady() {
    if (this.data.starting) {
      return
    }
    playCue('tap', {volume: 0.75})
    playVibrate('medium')
    const state = gameStore.setSelfReady(!this.data.selfReady)
    this.observeState(state)
  },
  start() {
    if (this.data.starting) {
      return
    }
    if (!this.data.selfReady) {
      playCue('actionFail', {volume: 0.7})
      wx.showToast({title: '请先完成准备', icon: 'none'})
      return
    }
    playCue('tap', {volume: 0.75})
    playVibrate('medium')
    this.clearStartCountdown()
    let left = 3
    this.setData({
      starting: true,
      startButtonText: `倒计时 ${left}s`,
    })
    playCue('countdown3', {volume: 0.55})
    this.startCountdownTimer = setInterval(() => {
      left -= 1
      if (left === 2) {
        playCue('countdown2', {volume: 0.55})
      } else if (left === 1) {
        playCue('countdown1', {volume: 0.55})
      }
      if (left <= 0) {
        this.clearStartCountdown()
        playCue('gameStart', {volume: 0.85})
        const state = gameStore.startGame()
        this.observeState(state)
        return
      }
      this.setData({
        startButtonText: `倒计时 ${left}s`,
      })
    }, 1000)
  },
  syncUserProfile() {
    const cached = getCachedProfile()
    this.setData({
      userProfile: cached,
      userAuthorized: hasValidProfile(cached),
    })
  },
  clearStartCountdown() {
    if (this.startCountdownTimer) {
      clearInterval(this.startCountdownTimer)
      this.startCountdownTimer = null
    }
    if (this.data.starting || this.data.startButtonText !== '开始游戏') {
      this.setData({
        starting: false,
        startButtonText: '开始游戏',
      })
    }
  },
  unsubscribeStore() {
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe()
      this.unsubscribe = null
    }
  },
  switchTab(e) {
    playCue('tap', {volume: 0.75})
    playVibrate('light')
    const page = e.currentTarget.dataset.page
    if (!page || page === '/pages/room/index') {
      return
    }
    if (page === '/pages/result/index') {
      const snapshot = gameStore.getState()
      if (snapshot.status !== 'finished' || !snapshot.result) {
        wx.showToast({title: '暂无历史结算', icon: 'none'})
        return
      }
    }
    if (page === '/pages/arena/index') {
      const snapshot = gameStore.getState()
      if (snapshot.status !== 'playing') {
        wx.showToast({title: '请先开启对局', icon: 'none'})
        return
      }
    }
    wx.redirectTo({url: page})
  },
  onTapProfile() {
    playVibrate('light')
    wx.navigateTo({url: '/pages/profile/index'})
  },
})
