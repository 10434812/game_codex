const analytics = require('../../utils/analytics');
const {getNavLayout} = require('../../utils/nav')
const {
  buildStageThemeStyle,
  DEFAULT_AVATAR,
  DEFAULT_STAGE,
  NAV_TABS,
  resolveStage,
  ROOM_UI_LIMIT,
  WAITING_SLOT_NAME,
} = require('../../utils/constants')
const {playCue, playVoice, playVibrate} = require('../../utils/audio')
const {getCachedProfile, ensureLogin} = require('../../utils/user-profile')
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

function getRoomIdFromOptions(options = {}) {
  return String(options.backendRoomId || options.roomId || '').trim()
}

function beginRoomAction(page) {
  if (page.roomActionRequest || page.roomUnloaded) return null
  const request = {
    epoch: page.pageEpoch || 0,
    token: api.getToken(),
    roomId: page.data.backendRoomId,
  }
  page.roomActionRequest = request
  return {
    roomId: encodeURIComponent(request.roomId),
    isCurrent: () => page.roomActionRequest === request && !page.roomUnloaded &&
      request.epoch === (page.pageEpoch || 0) && request.roomId === page.data.backendRoomId &&
      (request.token === api.getToken() || api.isRecoveredToken(request.token, api.getToken())),
    finish: () => {if (page.roomActionRequest === request) page.roomActionRequest = null},
  }
}

Page({
  data: {
    nav: {
      statusBarHeight: 20,
      navHeight: 64,
      capsuleSpace: 120,
    },
    activeTab: 'social', navExpanded: false,
    slots: [buildEmptySlot()],
    stageName: DEFAULT_STAGE.name,
    stageImage: DEFAULT_STAGE.image,
    stageVideo: DEFAULT_STAGE.video || '',
    stageThemeKey: DEFAULT_STAGE.theme.key,
    stageThemeStyle: buildStageThemeStyle(DEFAULT_STAGE),
    roomId: '----',
    matchmaking: false, matchCancelPending: false,
    backendRoomId: '',
    activePercent: 0,
    readyCountText: '',
    selfReady: true,
    isHost: true,
    starting: false,
    startButtonText: '开始游戏',
    roomHintText: '准备好后，点击开始游戏',
    unreadyNames: [],
    creatingOnlineRoom: false,
    loginError: '',
    joinLoginRequired: false,
    roomConnectionError: '',
    roomUnavailable: false,
    roomRetrying: false,
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
        modeText: ONLINE_MODE_TEXT,
      })
    } catch (error) {}
    if (!privacy.canEnter()) return
    runtimeConfig.fetchRemoteConfig().finally(() => {
      this.setData({shareEnabled: runtimeConfig.getBoolean('wechat.share_enabled', true)})
      enableShareMenu()
    })
    this.entryStage = resolveStage({id: Number(options.stageId) || DEFAULT_STAGE.id})
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
    this.initRoom()
    this.syncGuide()
  },
  onHide() {
    pageHelpers.pauseBackdropVideo(this);
    this.pageEpoch = (this.pageEpoch || 0) + 1
    this.roomActionRequest = null
    this.roomInitRequest = null
    this.roomInitPending = false
    this.setData({creatingOnlineRoom: false, roomRetrying: false})
    this.clearStartCountdown()
    this.clearPollTimer()
    this.unsubscribeStore()
  },
  onUnload() {
    this.roomUnloaded = true
    this.pageEpoch = (this.pageEpoch || 0) + 1
    this.roomActionRequest = null
    this.roomInitRequest = null
    this.roomInitPending = false
    this.clearStartCountdown()
    this.clearPollTimer()
    this.unsubscribeStore()
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
    if (this.data.starting || this.data.roomConnectionError || this.data.roomUnavailable) {
      return
    }
    playCue('tap', {volume: 0.75})
    playVibrate('medium')
    // 准备状态始终以服务端为准。
    if (this.data.backendRoomId) {
      const action = beginRoomAction(this)
      if (!action) return
      try {
        await api.post(`/rooms/${action.roomId}/ready`)
        if (!action.isCurrent()) return
        const room = await api.get(`/rooms/${action.roomId}`)
        if (!action.isCurrent()) return
        this.renderBackendRoom(room)
      } catch (err) {
        if (action.isCurrent()) wx.showToast({title: (err && err.message) || '准备失败，请重试', icon: 'none'})
      } finally {action.finish()}
      return
    }
    wx.showToast({title: '请先连接好友房间', icon: 'none'})
  },
  start() {
    if (this.data.starting || this.roomActionRequest) {
      return
    }
    if (this.data.roomConnectionError || this.data.roomUnavailable) {
      wx.showToast({title: '请先恢复房间连接或返回首页', icon: 'none'})
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
    if (!this.data.backendRoomId) { this.createOnlineRoom(); return }
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
  syncGuide() { this.setData({guideVisible: false}) },
  onGuidePrimary() {
    this.start()
  },
  syncUserProfile() {
    pageHelpers.syncUserProfile(this)
  },
  syncStageMusic() {
    pageHelpers.syncStageMusic(this)
  },
  async createOnlineRoom() {
    if (this.data.creatingOnlineRoom || this.data.starting) return
    if (this.roomInitPending) {
      wx.showToast({title: '房间正在连接，请稍候', icon: 'none'})
      return
    }
    const epoch = this.pageEpoch || 0
    this.setData({creatingOnlineRoom: true, loginError: ''})
    try {
      await ensureLogin()
      if (epoch !== (this.pageEpoch || 0)) return
      this.setData({joinLoginRequired: false})
      this.syncUserProfile()
      await this.initRoom(true)
    } catch (error) {
      if (epoch === (this.pageEpoch || 0)) {
        const message = error.message || '微信登录失败，请再次点击邀请重试'
        this.setData({loginError: message})
        wx.showToast({title: message, icon: 'none'})
      }
    } finally {
      if (!this.roomUnloaded && epoch === (this.pageEpoch || 0)) this.setData({creatingOnlineRoom: false})
    }
  },
  async initRoom(forceOnline = false) {
    if (this.roomInitPending || this.roomUnloaded) return
    if (this.roomInitialized && !forceOnline) {
      // 已初始化但 onHide 清掉了轮询：切回前台时恢复，否则房间会卡在旧状态
      // （看不到新加入的玩家 / 房主开局跳转）。
      if (this.data.backendRoomId && !this.pollTimer) {
        this.pollRoom(this.data.backendRoomId)
      }
      return
    }
    this.roomInitialized = false
    this.roomInitPending = true
    // 页面离开（onHide/onUnload）后，await 返回的结果不得再启动轮询，否则定时器无人清理
    const epoch = this.pageEpoch || 0
    const request = {token: api.getToken()}
    this.roomInitRequest = request
    const isStale = (allowExpiredLogin = false) => this.roomInitRequest !== request || epoch !== (this.pageEpoch || 0) ||
      (request.token !== api.getToken() && !api.isRecoveredToken(request.token, api.getToken()) &&
        !(allowExpiredLogin && !api.getToken()))
    try {
      await runtimeConfig.fetchRemoteConfig()
      if (isStale()) return
      if (!runtimeConfig.isApiSupported('onlineArena')) throw Object.assign(new Error('对战服务暂时不可用，请稍后重试'), {code: 'ONLINE_SERVICE_UNAVAILABLE'})
      if (!api.isLoggedIn()) throw Object.assign(new Error('微信登录后即可进入好友房间'), {statusCode: 401})
      if (this.inviteRoomId) {
        // 契约修正：数字房间 ID 走 /rooms/:id/join；分享拿到的是房间码时走 /rooms/code/:code/join，
        // 避免把房间码当数值 id 传给 MySQL 隐式转换（可能 404 或进错房间）
        const joinPath = this.inviteBackendRoomId
          ? `/rooms/${encodeURIComponent(this.inviteBackendRoomId)}/join`
          : `/rooms/code/${encodeURIComponent(this.inviteRoomId)}/join`
        const result = await api.post(joinPath)
        if (isStale()) return
        const room = result && result.room ? result.room : {}
        const roomId = room && room.id ? room.id : this.inviteRoomId
        analytics.track('room_join', {roomId: String(roomId)})
        const roomCode = room && (room.roomCode || room.room_code) ? (room.roomCode || room.room_code) : ''
        this.setData({
          backendRoomId: String(roomId),
          roomId: roomCode || String(roomId),
        })
        this.unsubscribeStore()
        this.renderBackendRoom(result)
        this.roomInitialized = true
        this.pollRoom(roomId)
        return
      }
      const stageId = (this.entryStage || DEFAULT_STAGE).id
      const result = await api.post('/rooms', {stageId})
      if (isStale()) return
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
      analytics.track('room_create', {roomId: String(roomId), stageId})
      // 后端房间以轮询数据为准，停止本地 store 订阅，避免本地机器人反复覆盖真人列表
      this.unsubscribeStore()
      this.renderBackendRoom(result)
      this.roomInitialized = true
      this.pollRoom(roomId)
    } catch (err) {
      if (isStale(err.statusCode === 401)) return
      console.warn('[room] initRoom error:', err)
      this.roomInitialized = false
      this.showRoomError(err)
      if (!api.isLoggedIn() && err.statusCode === 401) {
        this.setData({joinLoginRequired: true, roomHintText: '微信登录后即可加入这个好友房间'})
      }
      if (forceOnline || this.inviteRoomId) wx.showToast({title: (err && err.message) || '联网房间连接失败，请重试', icon: 'none'})
    } finally {
      if (this.roomInitRequest === request) {
        this.roomInitRequest = null
        this.roomInitPending = false
      }
    }
  },
  renderBackendRoom(roomPayload) {
    const room = roomPayload && roomPayload.room ? roomPayload.room : {}
    const stage = resolveStage({id: room.stage_id || DEFAULT_STAGE.id})
    const theme = saveStageTheme(stage)
    const roomLimit = room.match_due_at ? 4 : ROOM_UI_LIMIT
    const players = (roomPayload && roomPayload.players || []).slice(0, roomLimit).map(p => ({
      name: p.nick_name || p.name,
      state: p.is_host ? '房主' : p.is_ready ? '已准备' : '未准备',
      ready: !!(p.is_host || p.is_ready),
      filled: true,
      star: !!p.is_host,
      avatar: p.avatar_url || '',
    }))
    if (players.length < roomLimit) {
      players.push(buildEmptySlot())
    }
    const roomPlayers = roomPayload && roomPayload.players || []
    const selfPlayer = roomPlayers.find((p) => p.is_self)
    const unreadyNames = roomPlayers.filter((p) => !p.is_host && !p.is_ready).map((p) => p.nick_name || p.name || '玩家')
    const patch = {
      matchmaking: !!room.match_due_at,
      roomConnectionError: '',
      roomUnavailable: false,
      slots: players,
      activePercent: Math.round((roomPlayers.length / roomLimit) * 100),
      readyCountText: `已准备 ${roomPlayers.filter((p) => p.is_ready).length}/${roomPlayers.length} 人`,
      isHost: selfPlayer ? !!selfPlayer.is_host : this.data.isHost,
      selfReady: selfPlayer ? !!selfPlayer.is_ready : this.data.selfReady,
      unreadyNames,
      roomHintText: (selfPlayer ? !!selfPlayer.is_host : this.data.isHost)
        ? (unreadyNames.length ? `等待 ${unreadyNames.join('、')} 准备` : '玩家已准备，房主可以开始游戏')
        : (selfPlayer?.is_ready ? '你已准备，等待房主开始游戏' : '点击「准备」，房主才能开始游戏'),
      modeText: ONLINE_MODE_TEXT,
    }
    if (room.match_due_at) patch.roomHintText = '正在匹配真人，满4人立即开局；约8秒后不足4人由机器人补位'
    patch.stageName = stage.name
    patch.stageImage = theme.stageImage
    patch.stageVideo = theme.stageVideo
    patch.stageThemeKey = theme.stageThemeKey
    patch.stageThemeStyle = theme.stageThemeStyle
    if (room.room_code) patch.roomId = room.room_code
    if (room.id) patch.backendRoomId = String(room.id)
    this.setData(patch)
  },
  showRoomError(error, autoRetry = false) {
    this.clearStartCountdown()
    const unavailable = error.statusCode === 404 || error.statusCode === 410
    if (unavailable || error.statusCode === 401 || error.statusCode === 403) {
      analytics.playFlow.cancel(String(this.data.backendRoomId || ''), unavailable ? 'room_unavailable' : 'login_expired')
    }
    this.setData({
      roomUnavailable: unavailable,
      guideVisible: false,
      roomConnectionError: error.code === 'ONLINE_SERVICE_UNAVAILABLE' ? error.message
        : unavailable ? '房间已失效，请返回首页重新建房或索取新邀请。'
        : error.statusCode === 401 ? '登录已失效，请点击重新连接恢复登录。'
          : error.statusCode === 403 ? (error.message || '当前账号无法进入房间，请返回首页。')
            : autoRetry ? '房间连接中断，正在重试；也可点击重新连接。' : '房间连接失败，请点击重新连接。',
    })
  },
  async retryRoomConnection() {
    if (this.data.roomRetrying || this.data.roomUnavailable) return
    const epoch = this.pageEpoch || 0
    this.clearPollTimer()
    this.setData({roomRetrying: true})
    try {
      await ensureLogin()
      if (epoch !== (this.pageEpoch || 0)) return
      if (this.data.backendRoomId) await this.pollRoom(this.data.backendRoomId, true)
      else { this.roomInitialized = false; await this.initRoom(true) }
    } catch (error) {
      if (epoch === (this.pageEpoch || 0)) this.showRoomError(error)
    } finally {
      if (!this.roomUnloaded && epoch === (this.pageEpoch || 0)) this.setData({roomRetrying: false})
    }
  },
  leaveUnavailableRoom() {
    this.clearPollTimer()
    wx.reLaunch({url: '/pages/home/index'})
  },
  pollRoom(roomId, immediate = false) {
    this.clearPollTimer()
    const currentSeq = this._pollSeq
    let failures = 0
    const poll = async () => {
      this.pollTimer = null
      const token = api.getToken()
      try {
        const room = await api.get(`/rooms/${roomId}`)
        if (currentSeq !== this._pollSeq) return
        if (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken())) {
          this.clearPollTimer()
          this.showRoomError({statusCode: 401})
          return
        }
        if (!room || !room.room) throw new Error('房间信息未确认')
        failures = 0
        if (room.sessionId) {
          this.clearPollTimer()
          wx.redirectTo({url: `/pages/arena/index?sessionId=${encodeURIComponent(room.sessionId)}`})
          return
        }
        if (room.room.status && room.room.status !== 'waiting') {
          throw Object.assign(new Error('房间已结束'), {statusCode: 410})
        }
        this.renderBackendRoom(room)
      } catch (error) {
        if (currentSeq !== this._pollSeq) return
        // 换号后旧请求的失败也不能覆盖新会话。
        if (token !== api.getToken() && api.getToken() && !api.isRecoveredToken(token, api.getToken())) {
          this.clearPollTimer()
          return
        }
        failures++
        this.showRoomError(error, true)
        if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          this.clearPollTimer()
          return
        }
      } finally {
        if (currentSeq === this._pollSeq) {
          this.pollTimer = setTimeout(poll, Math.min(10000, 2000 * 2 ** Math.min(failures, 3)))
        }
      }
    }
    if (immediate) return poll()
    this.pollTimer = setTimeout(poll, 2000)
  },
  async onStartGame() {
    if (!this.data.backendRoomId) {
      await this.createOnlineRoom()
      return
    }
    const action = beginRoomAction(this)
    if (!action) return
    this.setData({starting: true, startButtonText: '正在开始…'})
    try {
      const result = await api.post(`/rooms/${action.roomId}/start`)
      if (!action.isCurrent()) return
      if (!result || !result.sessionId) throw new Error('对局尚未确认，请重试')
      wx.redirectTo({url: `/pages/arena/index?sessionId=${encodeURIComponent(result.sessionId)}`})
    } catch (err) {
      if (action.isCurrent()) wx.showToast({title: (err && err.message) || '暂时无法开始对局', icon: 'none'})
    } finally {
      if (action.isCurrent()) this.setData({starting: false, startButtonText: '开始游戏'})
      action.finish()
    }
  },
  onShareAppMessage() {
    analytics.track('share_click');
    if (this.data.roomUnavailable || !this.data.backendRoomId || !runtimeConfig.getBoolean('wechat.share_enabled', true)) return buildShareAppMessage('default')
    const query = [
        `roomId=${encodeURIComponent(this.data.roomId || '')}`,
        `backendRoomId=${encodeURIComponent(this.data.backendRoomId)}`,
        'scene=room',
      ].join('&')
    // 房间邀请固定进入房间，不能被后台的通用推广分享路径改到其他页面。
    return {...buildShareAppMessage('room'), path: `/pages/room/index?${query}`}
  },
  onShareTimeline() {
    if (this.data.roomUnavailable || !this.data.backendRoomId) return buildShareTimeline('default')
    return buildShareTimeline('room', {
      extraQuery: [
        `roomId=${encodeURIComponent(this.data.roomId || '')}`,
        this.data.backendRoomId ? `backendRoomId=${encodeURIComponent(this.data.backendRoomId)}` : '',
      ].filter(Boolean).join('&'),
    })
  },
  clearPollTimer() {
    this._pollSeq = (this._pollSeq || 0) + 1
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
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
  async cancelMatch() {
    if (this.data.matchCancelPending) return
    const epoch = this.pageEpoch || 0, token = api.getToken()
    this.setData({matchCancelPending: true})
    try {
      await api.post(`/rooms/${this.data.backendRoomId}/leave`)
      if (epoch !== (this.pageEpoch || 0) || (token !== api.getToken() && !api.isRecoveredToken(token, api.getToken()))) return
      analytics.playFlow.cancel(String(this.data.backendRoomId || ''), 'user_cancel')
      this.clearPollTimer()
      wx.redirectTo({url: '/pages/home/index'})
    } catch (error) {if (epoch === (this.pageEpoch || 0)) this.showRoomError(error)}
    finally {if (epoch === (this.pageEpoch || 0)) this.setData({matchCancelPending: false})}
  },
  toggleNav() {
    playVibrate('light')
    this.setData({navExpanded: !this.data.navExpanded})
  },
  async switchTab(e) {
    playCue('tap', {volume: 0.75})
    playVibrate('light')
    const page = e.currentTarget.dataset.page
    if (this.data.matchmaking && page && page !== '/pages/room/index') {await this.cancelMatch(); return}
    if (!page || page === '/pages/room/index') {
      return
    }
    if (page === '/pages/result/index') {
      try { wx.redirectTo({url: await require('../../utils/online-navigation').latestResultUrl()}) }
      catch (error) { wx.showToast({title: error.message || '记录加载失败', icon: 'none'}) }
      return
    }
    if (page === '/pages/arena/index') {
      if (!this.data.backendRoomId) { await this.createOnlineRoom(); return }
      try {
        const room = await api.get(`/rooms/${this.data.backendRoomId}`)
        if (room.sessionId) wx.redirectTo({url: `/pages/arena/index?sessionId=${encodeURIComponent(room.sessionId)}`})
        else wx.showToast({title: '请先在房间开始游戏', icon: 'none'})
      } catch (error) { this.showRoomError(error) }
      return
    }
    wx.redirectTo({url: page})
  },
  onTapProfile() {
    playVibrate('light')
    wx.navigateTo({url: '/pages/profile/index'})
  },
})
