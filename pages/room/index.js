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
const pageHelpers = require('../../utils/page-helpers')
const privacy = require('../../utils/privacy-consent')

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

  if (filledSlots.length < ROOM_UI_LIMIT) {
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
    slots: [buildEmptySlot()],
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
    roomHintText: '准备好后，点击开始游戏',
    unreadyNames: [],
    creatingOnlineRoom: false,
    shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true),
    userProfile: getCachedProfile(),
    defaultAvatar: DEFAULT_AVATAR,
    guideVisible: false,
  },
  onLoad(options = {}) {
    this.inviteBackendRoomId = String(options.backendRoomId || '').trim()
    this.inviteRoomCode = String(options.roomId || '').trim()
    this.inviteRoomId = getRoomIdFromOptions(options)
    try {
      this.setData({
        nav: getNavLayout(),
        tabs: NAV_TABS,
        modeText: MATCH_MODE_TEXT,
      })
    } catch (error) {}
    if (!privacy.canEnter()) return
    runtimeConfig.fetchRemoteConfig().finally(() => {
      this.setData({shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true)})
      enableShareMenu()
    })
    if (!this.inviteRoomId) this.refreshRoom()
  },
  onShow() {
    if (!privacy.canEnter()) return
    pageHelpers.resumeBackdropVideo(this);
    this.syncUserProfile()
    this.syncStageMusic()
    if (!this.roomCreatedVoicePlayed) {
      playVoice('roomCreated', {debounceMs: 0})
      this.roomCreatedVoicePlayed = true
    }
    this.unsubscribeStore()
    if (!this.inviteRoomId && !this.data.backendRoomId) {
      this.unsubscribe = gameStore.subscribe((state) => this.observeState(state))
      // 上一局的结算状态不是本次进入的房间：开新房间，避免底部导航被弹回结算页（I-1）
      const entry = gameStore.getState()
      this.observeState(entry.status === 'finished' ? gameStore.ensureRoom(entry.stage || DEFAULT_STAGE) : entry)
    }
    this.initRoom()
    this.syncGuide()
  },
  onHide() {
    pageHelpers.pauseBackdropVideo(this);
    this.pageEpoch = (this.pageEpoch || 0) + 1
    this.clearStartCountdown()
    this.clearPollTimer()
    this.unsubscribeStore()
  },
  onUnload() {
    this.pageEpoch = (this.pageEpoch || 0) + 1
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
      roomHintText: '准备好后，点击开始游戏',
      modeText: state.modeText || MATCH_MODE_TEXT,
    })
  },
  async inviteFriend() {
    if (this.data.starting || this.data.creatingOnlineRoom) {
      return
    }
    if (!runtimeConfig.getBoolean('wechat.share_enabled', true)) {
      wx.showToast({title: '邀请分享暂未开放', icon: 'none'})
      return
    }
    playCue('tap', {volume: 0.75})
    playVibrate('light')
    playCue('invite', {volume: 0.7})
    if (this.data.backendRoomId) {
      return
    }
    const epoch = this.pageEpoch || 0
    await this.createOnlineRoom()
    if (epoch === (this.pageEpoch || 0) && this.data.backendRoomId) {
      // 分享必须由用户点击原生按钮触发；先完成建房，避免异步分享超时后发出普通首页卡片。
      wx.showToast({title: '房间已建好，点击＋选择微信群', icon: 'none'})
    }
  },
  async toggleReady() {
    if (this.data.starting) {
      return
    }
    playCue('tap', {volume: 0.75})
    playVibrate('medium')
    // 后端房间的准备状态以服务器为准；本地 gameStore 只在本地房间使用
    if (this.data.backendRoomId) {
      try {
        const roomId = encodeURIComponent(this.data.backendRoomId)
        await api.post(`/rooms/${roomId}/ready`)
        const room = await api.get(`/rooms/${roomId}`)
        this.renderBackendRoom(room)
      } catch (err) {
        wx.showToast({title: (err && err.message) || '准备失败，请重试', icon: 'none'})
      }
      return
    }
    const state = gameStore.setSelfReady(!this.data.selfReady)
    this.observeState(state)
  },
  start() {
    if (this.data.starting) {
      return
    }
    if (this.roomInitPending || (this.inviteRoomId && !this.data.backendRoomId)) {
      wx.showToast({title: this.roomInitPending ? '房间正在连接，请稍候' : '请先成功加入好友房间', icon: 'none'})
      return
    }
    if (this.data.backendRoomId && !this.data.isHost) {
      playCue('actionFail', {volume: 0.7})
      wx.showToast({title: '等待房主开始游戏', icon: 'none'})
      return
    }
    if (this.data.backendRoomId && this.data.unreadyNames.length) {
      wx.showToast({title: `等待 ${this.data.unreadyNames.join('、')} 准备`, icon: 'none'})
      return
    }
    // 后端房间由服务端校验准备状态（房主无需准备），本地房间沿用本地校验
    if (!this.data.backendRoomId && !this.data.selfReady) {
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
    pageHelpers.syncUserProfile(this)
  },
  syncStageMusic() {
    pageHelpers.syncStageMusic(this)
  },
  refreshRoom() {
    const snapshot = gameStore.getState()
    this.observeState(snapshot)
  },
  async createOnlineRoom() {
    if (this.data.creatingOnlineRoom || this.data.starting) return
    if (this.roomInitPending) {
      wx.showToast({title: '房间正在连接，请稍候', icon: 'none'})
      return
    }
    this.setData({creatingOnlineRoom: true})
    await this.initRoom(true)
    this.setData({creatingOnlineRoom: false})
  },
  async initRoom(forceOnline = false) {
    if (this.roomInitialized && !forceOnline) {
      // 已初始化但 onHide 清掉了轮询：切回前台时恢复，否则房间会卡在旧状态
      // （看不到新加入的玩家 / 房主开局跳转）。
      if (this.data.backendRoomId && !this.pollTimer) {
        this.pollRoom(this.data.backendRoomId)
      }
      return
    }
    this.roomInitialized = true
    this.roomInitPending = true
    // 页面离开（onHide/onUnload）后，await 返回的结果不得再启动轮询，否则定时器无人清理
    const epoch = this.pageEpoch || 0
    const isStale = () => epoch !== (this.pageEpoch || 0)
    try {
      if (this.inviteRoomId || forceOnline || runtimeConfig.getBoolean('room.backend_enabled', false)) {
        await runtimeConfig.fetchRemoteConfig()
        if (!runtimeConfig.isApiSupported('onlineArena')) {
          this.roomInitialized = false
          this.setData({roomHintText: '联机服务升级中，可返回首页体验本地对局'})
          if (forceOnline || this.inviteRoomId) wx.showToast({title: '联机服务升级中，请先体验本地对局', icon: 'none'})
          return
        }
      }
      if (this.inviteRoomId) {
        // 契约修正：数字房间 ID 走 /rooms/:id/join；分享拿到的是房间码时走 /rooms/code/:code/join，
        // 避免把房间码当数值 id 传给 MySQL 隐式转换（可能 404 或进错房间）
        const joinPath = this.inviteBackendRoomId
          ? `/rooms/${encodeURIComponent(this.inviteBackendRoomId)}/join`
          : `/rooms/code/${encodeURIComponent(this.inviteRoomId)}/join`
        const result = await api.post(joinPath)
        if (isStale()) {
          this.roomInitialized = false
          return
        }
        const room = result && result.room ? result.room : {}
        const roomId = room && room.id ? room.id : this.inviteRoomId
        const roomCode = room && (room.roomCode || room.room_code) ? (room.roomCode || room.room_code) : ''
        this.setData({
          backendRoomId: String(roomId),
          roomId: roomCode || String(roomId),
        })
        this.unsubscribeStore()
        this.renderBackendRoom(result)
        this.pollRoom(roomId)
        return
      }
      const snapshot = gameStore.getState()
      // 自建房默认留在本地流程。之前这里无条件建后端房间并每 2s 轮询，
      // 轮询回来的玩家（只有自己）会把本地补的机器人覆盖掉，
      // 和 gameStore 订阅互相打架，房间人数与 modeText 每两秒跳一次。
      if (!forceOnline && !runtimeConfig.getBoolean('room.backend_enabled', false)) {
        return
      }
      const stageId = snapshot.stage && snapshot.stage.id ? snapshot.stage.id : DEFAULT_STAGE.id
      const result = await api.post('/rooms', {stageId})
      if (isStale()) {
        this.roomInitialized = false
        return
      }
      const room = result && result.room ? result.room : result
      const roomId = room && room.id ? room.id : ''
      const roomCode = room && (room.roomCode || room.room_code) ? (room.roomCode || room.room_code) : ''
      if (!roomId) {
        throw new Error('创建联网房间失败，请重试')
      }
      this.setData({
        backendRoomId: String(roomId),
        roomId: roomCode || String(roomId),
      })
      // 后端房间以轮询数据为准，停止本地 store 订阅，避免本地机器人反复覆盖真人列表
      this.unsubscribeStore()
      this.renderBackendRoom(result)
      this.pollRoom(roomId)
    } catch (err) {
      console.warn('[room] initRoom error:', err)
      this.roomInitialized = false
      if (forceOnline || this.inviteRoomId) wx.showToast({title: (err && err.message) || '联网房间连接失败，请重试', icon: 'none'})
    } finally {
      this.roomInitPending = false
    }
  },
  renderBackendRoom(roomPayload) {
    const room = roomPayload && roomPayload.room ? roomPayload.room : {}
    const stage = resolveStage({id: room.stage_id || DEFAULT_STAGE.id})
    const theme = saveStageTheme(stage)
    const players = (roomPayload && roomPayload.players || []).slice(0, ROOM_UI_LIMIT).map(p => ({
      name: p.nick_name || p.name,
      state: p.is_ready ? '已就绪' : '未准备',
      filled: true,
      star: !!p.is_host,
      avatar: p.avatar_url || '',
    }))
    if (players.length < ROOM_UI_LIMIT) {
      players.push(buildEmptySlot())
    }
    const roomPlayers = roomPayload && roomPayload.players || []
    const selfPlayer = roomPlayers.find((p) => p.is_self)
    const unreadyNames = roomPlayers.filter((p) => !p.is_host && !p.is_ready).map((p) => p.nick_name || p.name || '玩家')
    const patch = {
      slots: players,
      activePercent: Math.round((roomPlayers.length / ROOM_UI_LIMIT) * 100),
      isHost: selfPlayer ? !!selfPlayer.is_host : this.data.isHost,
      selfReady: selfPlayer ? !!selfPlayer.is_ready : this.data.selfReady,
      unreadyNames,
      roomHintText: (selfPlayer ? !!selfPlayer.is_host : this.data.isHost)
        ? (unreadyNames.length ? `等待 ${unreadyNames.join('、')} 准备` : '玩家已准备，房主可以开始游戏')
        : '准备好后，等待房主开始游戏',
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
    // 本地房直接开局，不做一次注定要失败的后端请求（那次等待会让倒计时结束后卡住一拍）
    if (!this.data.backendRoomId) {
      gameStore.startGame({autoStartTimer: false})
      wx.redirectTo({url: '/pages/arena/index'})
      return
    }
    try {
      const result = await api.post(`/rooms/${this.data.backendRoomId}/start`)
      wx.redirectTo({url: `/pages/arena/index?sessionId=${result.sessionId}`})
    } catch (err) {
      wx.showToast({title: (err && err.message) || '暂时无法开始对局', icon: 'none'})
    }
  },
  onShareAppMessage() {
    if (!this.data.backendRoomId || !runtimeConfig.getBoolean('wechat.share_enabled', true)) return buildShareAppMessage('default')
    const query = [
        `roomId=${encodeURIComponent(this.data.roomId || '')}`,
        `backendRoomId=${encodeURIComponent(this.data.backendRoomId)}`,
        'scene=room',
      ].join('&')
    // 房间邀请固定进入房间，不能被后台的通用推广分享路径改到其他页面。
    return {...buildShareAppMessage('room'), path: `/pages/room/index?${query}`}
  },
  onShareTimeline() {
    if (!this.data.backendRoomId) return buildShareTimeline('default')
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
