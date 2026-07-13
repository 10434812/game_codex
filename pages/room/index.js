const {getNavLayout} = require('../../utils/nav')
const {
  buildStageThemeStyle,
  DEFAULT_AVATAR,
  DEFAULT_STAGE,
  MATCH_MODE_TEXT,
  NAV_TABS,
  resolveStage,
  ROOM_UI_LIMIT,
  WAITING_SLOT_NAME,
} = require('../../utils/constants')
const gameStore = require('../../utils/game-store')
const {playCue, playVoice, playVibrate} = require('../../utils/audio')
const {getCachedProfile} = require('../../utils/user-profile')
const api = require('../../utils/api-client')
const runtimeConfig = require('../../utils/runtime-config')
const {enableShareMenu, buildShareAppMessage, buildShareTimeline} = require('../../utils/share-config')
const {saveStageTheme} = require('../../utils/stage-theme')
const guideStore = require('../../utils/guide-store')

const ONLINE_MODE_TEXT = '联网对战'

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

function getRoomIdFromOptions(options = {}) {
  return String(options.backendRoomId || options.roomId || '').trim()
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    activeTab: 'social',
    slots: Array.from({length: ROOM_UI_LIMIT}, buildEmptySlot),
    stageName: DEFAULT_STAGE.name,
    stageImage: DEFAULT_STAGE.image,
    stageVideo: DEFAULT_STAGE.video || '',
    stageThemeKey: DEFAULT_STAGE.theme.key,
    stageThemeStyle: buildStageThemeStyle(DEFAULT_STAGE),
    roomId: '----',
    backendRoomId: '',
    activePercent: 0,
    selfReady: true,
    isHost: true,
    starting: false,
    startButtonText: '开始游戏',
    roomHintText: '准备好后，游戏将在两分钟内开始',
    userProfile: getCachedProfile(),
    defaultAvatar: DEFAULT_AVATAR,
    guideVisible: false,
  },
  onLoad(options = {}) {
    this.inviteRoomId = getRoomIdFromOptions(options)
    try {
      this.setData({
        nav: getNavLayout(),
        tabs: NAV_TABS,
        modeText: MATCH_MODE_TEXT,
      })
    } catch (error) {}
    runtimeConfig.fetchRemoteConfig().finally(() => {
      enableShareMenu()
    })
    this.refreshRoom()
  },
  onShow() {
    this.syncUserProfile()
    this.syncStageMusic()
    if (!this.roomCreatedVoicePlayed) {
      playVoice('roomCreated', {debounceMs: 0})
      this.roomCreatedVoicePlayed = true
    }
    this.unsubscribeStore()
    if (!this.inviteRoomId && !this.data.backendRoomId) {
      this.unsubscribe = gameStore.subscribe((state) => this.observeState(state))
      this.observeState(gameStore.getState())
    }
    this.initRoom()
    this.syncGuide()
  },
  onHide() {
    this.clearStartCountdown()
    this.clearPollTimer()
    this.unsubscribeStore()
  },
  onUnload() {
    this.clearStartCountdown()
    this.clearPollTimer()
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
    const stage = resolveStage(state.stage || DEFAULT_STAGE)
    const theme = saveStageTheme(stage)
    this.setData({
      slots: mapRoomSlots(state.players),
      stageName: stage.name,
      stageImage: theme.stageImage,
      stageVideo: theme.stageVideo,
      stageThemeKey: theme.stageThemeKey,
      stageThemeStyle: theme.stageThemeStyle,
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
    if (this.data.backendRoomId) {
      playVoice('roomInviteSent')
      wx.showToast({title: '邀请已发送', icon: 'none'})
      return
    }
    const before = gameStore.getState()
    const state = gameStore.inviteHumanPlayer()
    if (state.players.length > before.players.length) {
      playCue('inviteSuccess', {volume: 0.8})
      playVoice('roomInviteSent')
      wx.showToast({title: '邀请已发送', icon: 'none'})
    } else {
      playCue('actionFail', {volume: 0.7})
      playVoice('roomFull')
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
    if (this.data.backendRoomId && !this.data.isHost) {
      playCue('actionFail', {volume: 0.7})
      wx.showToast({title: '等待房主开始游戏', icon: 'none'})
      return
    }
    if (!this.data.selfReady) {
      playCue('actionFail', {volume: 0.7})
      playVoice('roomNeedReady')
      wx.showToast({title: '请先完成准备', icon: 'none'})
      return
    }
    if (guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ROOM)) {
      guideStore.advanceTo(guideStore.GUIDE_STEPS.ARENA_TEAM)
      this.setData({guideVisible: false})
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
    playVoice('countdown3', {force: true})
    this.startCountdownTimer = setInterval(() => {
      left -= 1
      if (left === 2) {
        playCue('countdown2', {volume: 0.55})
        playVoice('countdown2', {force: true})
      } else if (left === 1) {
        playCue('countdown1', {volume: 0.55})
        playVoice('countdown1', {force: true})
      }
      if (left <= 0) {
        this.clearStartCountdown()
        playCue('gameStart', {volume: 0.85})
        playVoice('countdownGo', {force: true})
        this.onStartGame()
        return
      }
      this.setData({
        startButtonText: `倒计时 ${left}s`,
      })
    }, 1000)
  },
  syncGuide() {
    this.setData({
      guideVisible: guideStore.shouldShowStep(guideStore.GUIDE_STEPS.ROOM),
    })
  },
  onGuidePrimary() {
    this.start()
  },
  syncUserProfile() {
    const pageHelpers = require('../../utils/page-helpers')
    pageHelpers.syncUserProfile(this)
  },
  syncStageMusic() {
    const pageHelpers = require('../../utils/page-helpers')
    pageHelpers.syncStageMusic(this)
  },
  refreshRoom() {
    const snapshot = gameStore.getState()
    this.observeState(snapshot)
  },
  async initRoom() {
    if (this.roomInitialized) {
      return
    }
    this.roomInitialized = true
    try {
      if (this.inviteRoomId) {
        const result = await api.post(`/rooms/${encodeURIComponent(this.inviteRoomId)}/join`)
        const room = result && result.room ? result.room : {}
        const roomId = room && room.id ? room.id : this.inviteRoomId
        const roomCode = room && (room.roomCode || room.room_code) ? (room.roomCode || room.room_code) : ''
        this.setData({
          backendRoomId: String(roomId),
          roomId: roomCode || String(roomId),
        })
        this.renderBackendRoom(result)
        this.pollRoom(roomId)
        return
      }
      const snapshot = gameStore.getState()
      const stageId = snapshot.stage && snapshot.stage.id ? snapshot.stage.id : DEFAULT_STAGE.id
      const result = await api.post('/rooms', {stageId})
      const room = result && result.room ? result.room : result
      const roomId = room && room.id ? room.id : ''
      const roomCode = room && (room.roomCode || room.room_code) ? (room.roomCode || room.room_code) : ''
      if (!roomId) {
        return
      }
      this.setData({
        backendRoomId: String(roomId),
        roomId: roomCode || String(roomId),
      })
      this.pollRoom(roomId)
    } catch (err) {
      console.warn('[room] initRoom error:', err)
      this.roomInitialized = false
    }
  },
  renderBackendRoom(roomPayload) {
    const room = roomPayload && roomPayload.room ? roomPayload.room : {}
    const stage = resolveStage({id: room.stage_id || DEFAULT_STAGE.id})
    const theme = saveStageTheme(stage)
    const players = (roomPayload && roomPayload.players || []).map(p => ({
      name: p.nick_name || p.name,
      state: p.is_ready ? '已就绪' : '未准备',
      filled: true,
      star: !!p.is_host,
      avatar: p.avatar_url || '',
    }))
    while (players.length < ROOM_UI_LIMIT) {
      players.push(buildEmptySlot())
    }
    const roomPlayers = roomPayload && roomPayload.players || []
    const selfPlayer = roomPlayers.find((p) => p.is_self)
    const patch = {
      slots: players,
      activePercent: Math.round((roomPlayers.length / ROOM_UI_LIMIT) * 100),
      isHost: selfPlayer ? !!selfPlayer.is_host : this.data.isHost,
      selfReady: selfPlayer ? !!selfPlayer.is_ready : this.data.selfReady,
      modeText: ONLINE_MODE_TEXT,
    }
    patch.stageName = stage.name
    patch.stageImage = theme.stageImage
    patch.stageVideo = theme.stageVideo
    patch.stageThemeKey = theme.stageThemeKey
    patch.stageThemeStyle = theme.stageThemeStyle
    if (room.room_code) patch.roomId = room.room_code
    if (room.id) patch.backendRoomId = String(room.id)
    this.setData(patch)
  },
  pollRoom(roomId) {
    this.clearPollTimer()
    this._pollSeq = (this._pollSeq || 0) + 1;
    const currentSeq = this._pollSeq;

    this.pollTimer = setInterval(async () => {
      try {
        const room = await api.get(`/rooms/${roomId}`)
        // Ignore stale responses if poll was restarted
        if (currentSeq !== this._pollSeq) return;

        if (room.sessionId) {
          this.clearPollTimer()
          wx.redirectTo({url: `/pages/arena/index?sessionId=${room.sessionId}`})
          return
        }

        const currentSlots = this.data.slots || []
        const beforeSlots = JSON.stringify(currentSlots)
        this.renderBackendRoom(room)
        if (JSON.stringify(this.data.slots || []) === beforeSlots) {
          return
        }
      } catch (err) { /* ignore polling errors */ }
    }, 2000)
  },
  async onStartGame() {
    try {
      const roomId = this.data.backendRoomId || this.data.roomId
      const result = await api.post(`/rooms/${roomId}/start`)
      wx.redirectTo({ url: `/pages/arena/index?sessionId=${result.sessionId}` })
    } catch (err) {
      if (this.data.backendRoomId) {
        wx.showToast({title: err.message || '暂时无法开始对局', icon: 'none'})
        return
      }
      gameStore.startGame()
      wx.redirectTo({ url: '/pages/arena/index' })
    }
  },
  onShareAppMessage() {
    return buildShareAppMessage('room', {
      extraQuery: [
        `roomId=${encodeURIComponent(this.data.roomId || '')}`,
        this.data.backendRoomId ? `backendRoomId=${encodeURIComponent(this.data.backendRoomId)}` : '',
      ].filter(Boolean).join('&'),
    })
  },
  onShareTimeline() {
    return buildShareTimeline('room', {
      extraQuery: [
        `roomId=${encodeURIComponent(this.data.roomId || '')}`,
        this.data.backendRoomId ? `backendRoomId=${encodeURIComponent(this.data.backendRoomId)}` : '',
      ].filter(Boolean).join('&'),
    })
  },
  clearPollTimer() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
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
