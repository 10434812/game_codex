const {getNavLayout} = require('../../utils/nav');
const {DEFAULT_STAGE, DEFAULT_AVATAR, MATCH_MODE_TEXT, NAV_TABS, buildStageThemeStyle, resolveStage} = require('../../utils/constants');
const {getCachedProfile} = require('../../utils/user-profile');
const {playStageBgm, playCue, playVoice, playVibrate} = require('../../utils/audio');
const shop = require('../../utils/shop-store');
const {QUICK_EMOTES} = require('../../utils/emote');
const guideStore = require('../../utils/guide-store');
const pageHelpers = require('../../utils/page-helpers');
const privacy = require('../../utils/privacy-consent');
const store = require('../../utils/game-store');
const api = require('../../utils/api-client');
const {FIELD} = require('../../utils/run-arena');
const {fieldPoint} = require('../../utils/run-arena-renderer');
const {ARENA_DROP_ASSETS} = require('../../utils/arena-effects');
const {appendArenaViewPatch} = require('../../utils/arena-view-patch');
const {sprintFeedback, scoreBursts} = require('../../utils/arena-feedback');
const RULES_KEY = 'game_codex_running_rules_v1';

Page({
  data: {
    nav: {statusBarHeight: 20, navHeight: 64, capsuleSpace: 120}, userProfile: getCachedProfile(), defaultAvatar: DEFAULT_AVATAR,
    modeText: MATCH_MODE_TEXT, stageThemeKey: DEFAULT_STAGE.theme.key, stageThemeStyle: buildStageThemeStyle(DEFAULT_STAGE),
    timeText: '120s', score: 0, rankText: '', teamText: '独立', hasTeam: false, waiting: false,
    rulesVisible: false, rulesFirstRun: false, rulesStarting: false, hint: '拖动跑动 · 松手停住 · 点选玩家邀请组队', error: '', connectionText: '', tutorialStep: 0,
    stageImage: DEFAULT_STAGE.image, stageVideo: '', emotePanelVisible: false, quickEmotes: QUICK_EMOTES,
    tabs: NAV_TABS, activeTab: 'play', players: [], drops: [], bursts: [], teamLinks: [],
    selfRankText: '', selfRankLead: false, messageCardCollapsed: true, chatMessages: [], quickReplyOptions: QUICK_EMOTES.slice(0, 3),
    incomingId: '', incomingName: '', teamPending: false, inviteLink: null, sprint: false, sprintText: '',
    motionDuration: 16,
  },
  onLoad(options = {}) {
    try {this.setData({nav: getNavLayout()});} catch (error) {}
    if (!privacy.canEnter()) return;
    this.sessionId = String(options.sessionId || ''); this.version = -1; this.effectId = 0; this.generation = 0;
    this.ignoredInvites = new Set();
    this.direction = {dx: 0, dy: 0}; const first = wx.getStorageSync(RULES_KEY) !== '1';
    this.setData({rulesVisible: first, rulesFirstRun: first, tutorialStep: first ? 1 : 0, motionDuration: this.sessionId ? 100 : 16});
  },
  onReady() {
    if (!wx.createSelectorQuery) return;
    wx.createSelectorQuery().in(this).select('#run-field').boundingClientRect().exec((results) => {
      const info = results && results[0]; if (!info) return;
      this.canvasBounds = {x: info.left || 0, y: info.top || 0};
      this.fieldRect = {x: info.width * .09, y: info.height * .12, width: info.width * .82, height: info.height * .76};
      this.draw();
    });
  },
  onShow() {
    if (!privacy.canEnter()) return;
    this.active = true; this.generation = (this.generation || 0) + 1; this.direction = {dx: 0, dy: 0};
    this.appearance = {...shop.getEquippedDisplay(), images: this.appearance?.images || {}, emotes: {}};
    this.setData({userProfile: getCachedProfile()}); pageHelpers.resumeBackdropVideo(this);
    if (this.sessionId) {this.setData({connectionText: '正在同步对局…'}); this.fetchArenaState(); this.connectArenaRealtime(); this.startArenaPolling();}
    else {
      // 上一局遗留的结算状态不是本次对局：回房间重新开局，而不是弹回结算页（I-1）
      if (store.getState().status === 'finished') {wx.redirectTo({url: '/pages/room/index'}); return;}
      this.unsubscribe = store.subscribe((state) => this.acceptState(state)); this.acceptState(store.getState());
      if (this.data.rulesFirstRun) store.pauseGame(); else store.resumeGame();
    }
    this.inputTimer = setInterval(() => {if (this.pointer?.moved) this.sendDirection();}, 150);
    this.inputTimer?.unref?.();
  },
  onHide() {this.stopArena();}, onUnload() {this.stopArena();},
  stopArena() {
    this.queuedViewChanges = null;
    this.direction = {dx: 0, dy: 0}; this.sendDirection(); this.pointer = null; this.active = false; this.generation++;
    pageHelpers.pauseBackdropVideo(this);
    clearInterval(this.inputTimer); clearInterval(this.pollTimer); if (this.unsubscribe) this.unsubscribe(); this.unsubscribe = null;
    const socket = this.socket; this.socket = null; this.socketOpen = false; if (socket) socket.close({code: 1000, reason: 'page_hidden'});
    if (!this.sessionId) store.pauseGame();
  },
  acceptState(state) {
    if (!this.active || !state || (this.sessionId && String(state.sessionId) !== this.sessionId)) return;
    if (state.status === 'finished') {
      if (!this.redirected) {this.redirected = true; guideStore.advanceTo(guideStore.GUIDE_STEPS.RESULT); wx.redirectTo({url: `/pages/result/index${this.sessionId ? '?sessionId=' + this.sessionId : ''}`});} return;
    }
    if (this.sessionId && (state.stateVersion || 0) < this.version) return;
    this.version = state.stateVersion || 0; this.snapshot = state;
    const self = (state.players || []).find((p) => p.isSelf), runner = state.runWorld?.runners.find((r) => r.id === self?.id);
    if (this.data.tutorialStep === 2 && runner?.stats && runner.stats.bags + runner.stats.gifts + runner.stats.bombs > 0) this.setData({tutorialStep: 3});
    const mate = state.players?.find((p) => p.id === runner?.mateId), target = state.players?.find((p) => p.id === runner?.targetId);
    const invitations = state.runWorld?.runners.filter((r) => r.targetId === self?.id && !r.mateId) || [];
    for (const id of this.ignoredInvites || []) if (!invitations.some((r) => r.id === id)) this.ignoredInvites.delete(id);
    const incoming = !mate && invitations.find((r) => !this.ignoredInvites?.has(r.id));
    const mutual = !!target && state.runWorld.runners.some((r) => r.id === target.id && r.targetId === self?.id);
    const rank = self ? state.players.filter((p) => p.score > self.score).length + 1 : 0;
    const patch = {timeText: `${state.timeLeft}s`, score: self?.score || 0, rankText: rank ? `第 ${rank} / ${state.players.length} 名` : '',
      ...sprintFeedback(state, self),
      incomingId: !mutual && incoming ? incoming.id : '', incomingName: !mutual && incoming ? state.players.find((p) => p.id === incoming.id)?.name || '玩家' : '',
      selfRankText: rank ? `当前第 ${rank} / ${state.players.length} 名` : '', selfRankLead: rank === 1,
      modeText: this.sessionId ? '联网对战' : MATCH_MODE_TEXT, waiting: !!state.awaitingStart, hasTeam: !!mate,
      teamText: mate ? `队友 ${mate.name}${runner.boosted ? ' · 加速中' : ''}` : target ? `${mutual ? '已互选' : '等待回应'} ${target.name}` : '独立',
      hint: state.awaitingStart ? `等待所有玩家点击开始\n${state.startWaitSeconds ?? 30}秒内未确认将取消本局` : mate ? '靠近加速 · 得失 2∶1 联动' : mutual ? '双方已同意 · 靠近碰面成队' : incoming ? '收到组队邀请\n接受后靠近碰面成队' : target ? '等待对方接受\n再次点选可取消邀请' : '拖动跑动 · 松手停住\n点选头像邀请组队'};
    const changed = {}; for (const [key, value] of Object.entries(patch)) {
      if (this.data[key] !== value || Object.prototype.hasOwnProperty.call(this.queuedViewChanges || {}, key)) changed[key] = value;
    }
    if (this.stageId !== state.stage?.id) {
      const stage = resolveStage(state.stage || DEFAULT_STAGE); this.stageId = stage.id; playStageBgm(stage, {volume: .38});
      Object.assign(changed, {stageThemeKey: stage.theme.key, stageThemeStyle: buildStageThemeStyle(stage), stageImage: stage.image, stageVideo: stage.video || ''});
      if (this.appearance) this.appearance.paper = stage.theme.panelSolid;
      playVoice('arenaStart');
    }
    for (const event of state.runWorld?.effects || []) {
      if (event.id <= this.effectId) continue; this.effectId = event.id;
      if ([event.actorId, event.teammateId].includes(self?.id)) {
        playCue(event.type === 'team' ? 'pairOther' : event.delta < 0 ? 'actionFail' : 'tap');
        if (event.type === 'team') playVoice('teamSuccess');
        else if (event.delta < 0) playVibrate?.('light');
      }
    }
    if (patch.sprint && state.timeLeft !== this.lastSprintSecond && !this.data.rulesVisible) {
      if (state.timeLeft <= 3) playCue(`countdown${state.timeLeft}`);
      else if ([15, 10, 5].includes(state.timeLeft)) playCue('tap');
    }
    this.lastSprintSecond = state.timeLeft;
    this.draw(changed);
    if (state.needsStartAck && !this.data.rulesFirstRun && !this.readyPending) void this.acknowledgeStart().catch((error) => this.setData({error: error.message}));
  },
  draw(changed = {}) {
    const world = this.snapshot?.runWorld;
    if (!world) {if (Object.keys(changed).length) this.setData(changed); return;}
    if (this.viewSubmission) {this.queuedViewChanges = {...this.queuedViewChanges, ...changed}; return;}
    const self = this.snapshot.players.find((p) => p.isSelf), mine = world.runners.find((r) => r.id === self?.id);
    const boardWidth = this.fieldRect ? this.fieldRect.width / .82 : 360;
    const boardHeight = this.fieldRect ? this.fieldRect.height / .76 : 400;
    const position = (r) => {
      const x = 9 + r.x / FIELD.width * 82, y = 12 + r.y / FIELD.height * 76;
      return {x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000,
        px: Math.round(x * boardWidth) / 100, py: Math.round(y * boardHeight) / 100};
    };
    const players = world.runners.map((r) => {
      const p = this.snapshot.players.find((p) => p.id === r.id);
      return {...p, ...position(r), ...(p?.isSelf ? this.appearance : {}), invited: r.targetId === self?.id || mine?.targetId === r.id,
        boosted: r.boosted, scoreLabel: `${p?.name || ''} · ${p?.score || 0}`, emoteText: this.appearance?.emotes?.[r.id] || ''};
    });
    const avatarRadius = boardWidth * 63 / 750;
    for (const p of players) {
      const font = boardWidth * 21 / 750;
      const w = Math.min(boardWidth - 8, [...p.scoreLabel].reduce((sum, char) => sum + (/[\u2e80-\uffff]/.test(char) ? font : font * .65), 0) + 18), h = 19;
      p.labelX = Math.round(Math.max(w / 2 + 2, Math.min(boardWidth - w / 2 - 2, p.px)) * 100) / 100;
      p.labelY = Math.round(Math.max(2, Math.min(boardHeight - h - 2, p.py + avatarRadius + 10)) * 100) / 100;
      p.labelWidth = w;
    }
    const drops = world.drops.map((d) => {
      const warning = world.elapsedMs < d.warningUntil;
      const point = position(d);
      return {id: d.id, kind: d.kind, ...point, y: warning ? 5 : point.y, py: warning ? Math.round(boardHeight * 5) / 100 : point.py, warning,
        asset: ARENA_DROP_ASSETS[d.kind],
        label: warning ? (d.kind === 'bomb' ? '雷将落下 ↓' : '好运将至 ↓') : d.kind === 'bomb' ? '−10' : d.kind === 'bag' ? '+10' : '+20'};
    });
    const linkBetween = (r, mate) => {
      if (!mate) return null;
      const from = position(r), to = position(mate), width = this.fieldRect ? this.fieldRect.width / .82 : 360, height = this.fieldRect ? this.fieldRect.height / .76 : 400;
      const dx = (to.x - from.x) * width / 100, dy = (to.y - from.y) * height / 100;
      return {id: r.id, style: `left:${from.x}%;top:${from.y}%;width:${Math.hypot(dx, dy)}px;transform-origin:0 50%;transform:rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg);`};
    };
    const links = world.runners.filter((r) => r.mateId && r.id < r.mateId).map((r) => {
      const mate = world.runners.find((m) => m.id === r.mateId); if (!mate) return null;
      return linkBetween(r, mate);
    }).filter(Boolean);
    const inviteTarget = mine?.targetId && world.runners.find((r) => r.id === mine.targetId && !r.mateId);
    const inviteLink = mine && !mine.mateId && inviteTarget ? linkBetween(mine, inviteTarget) : null;
    const bursts = scoreBursts(world, self?.id).map((e) => {
      const point = position(e), margin = Math.min(boardWidth / 2, 16 + e.text.length * boardWidth * 14 / 750);
      const above = point.py - boardWidth * 144 / 750;
      return {...e, ...point,
        labelX: Math.max(margin, Math.min(boardWidth - margin, point.px)) / boardWidth * 100,
        labelY: (above >= 36 ? above : Math.min(boardHeight - 30, point.py + boardWidth * 110 / 750)) / boardHeight * 100};
    });
    // 只推送视图字段，原生视图层共同处理人物、掉落物与弹层。
    const patch = appendArenaViewPatch(this.data, {players, drops, teamLinks: links, inviteLink, bursts}, changed);
    if (Object.keys(patch).length) {
      const submission = {}; this.viewSubmission = submission;
      this.setData(patch, () => {
        if (this.viewSubmission !== submission) return;
        this.viewSubmission = null;
        const pending = this.queuedViewChanges; this.queuedViewChanges = null;
        if (pending && this.active !== false) this.draw(pending);
      });
    }
  },
  async fetchArenaState() {
    if (!this.active || this.fetchPending) return;
    this.fetchPending = true; const generation = this.generation;
    try {const state = await api.get(`/games/${this.sessionId}`); if (this.active && generation === this.generation) {this.acceptState(state); this.setData({connectionText: this.socketOpen && Date.now() - (this.lastFrameAt || 0) <= 1500 ? '' : this.socketOpen ? '等待实时画面同步…' : '实时连接恢复中，已通过网络同步'});}}
    catch (error) {if (this.active && generation === this.generation) this.setData({connectionText: '网络中断，正在重试；对局继续计时'});}
    finally {this.fetchPending = false;}
  },
  startArenaPolling() {clearInterval(this.pollTimer); this.pollTimer = setInterval(() => {
    if (!this.socketOpen || Date.now() - (this.lastFrameAt || 0) > 1500) this.fetchArenaState();
    if (!this.socket && Date.now() - (this.lastConnectAt || 0) > 3000) this.connectArenaRealtime();
  }, 500); this.pollTimer?.unref?.();},
  connectArenaRealtime() {
    if (!wx.connectSocket || !api.getToken()) return;
    this.lastConnectAt = Date.now();
    const base = api.getBaseUrl().replace(/\/api\/?$/, '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    const socket = wx.connectSocket({url: `${base}/ws/arena?sessionId=${encodeURIComponent(this.sessionId)}`, protocols: [`arena.${api.getToken()}`]}); this.socket = socket;
    const current = () => this.active && this.socket === socket;
    socket.onOpen(() => {if (current()) this.socketOpen = true;});
    socket.onMessage(({data}) => {
      if (!current()) return;
      try {const message = JSON.parse(data);
        if (message.event === 'game_state') {this.lastFrameAt = Date.now(); this.acceptState(message.data); if (this.data.connectionText) this.setData({connectionText: ''});}
        else if (['game_finished', 'state_changed'].includes(message.event)) this.fetchArenaState();
        else if (message.event === 'arena_error') this.setData({error: message.data.message});
        else if (message.event === 'emote_broadcast') this.showEmote(message.data.fromUserId, message.data.emoteId);
      } catch (error) {}
    });
    const closed = () => {if (current()) {this.socketOpen = false; this.socket = null; this.setData({connectionText: '实时连接中断，正在恢复'}); this.fetchArenaState();}};
    socket.onClose(closed); socket.onError(closed);
  },
  sendDirection() {
    const direction = this.direction || {dx: 0, dy: 0};
    if (!this.sessionId) {store.setRunDirection(direction.dx, direction.dy); return;}
    if (this.snapshot?.awaitingStart || this.data.rulesVisible) return;
    if (this.socketOpen && this.socket) {try {this.socket.send({data: JSON.stringify({event: 'run_input', data: direction})}); return;} catch (error) {this.socketOpen = false;}}
    this.pendingDirection = direction; void this.flushDirection();
  },
  async flushDirection() {
    if (this.movePending || !this.pendingDirection || !this.active) return;
    const direction = this.pendingDirection; this.pendingDirection = null; this.movePending = true;
    try {await api.post(`/games/${this.sessionId}/move`, direction);} catch (error) {if (this.active) this.setData({error: error.message || '移动同步失败'});}
    finally {this.movePending = false; if (this.pendingDirection && this.active) void this.flushDirection();}
  },
  onRunTouchStart(event) {
    if (this.data.rulesVisible || this.data.waiting) return;
    const t = event.touches[0]; this.pointer = {x: t.x ?? t.clientX, y: t.y ?? t.clientY, moved: false,
      targetId: event.currentTarget?.dataset?.playerId || ''};
  },
  onRunTouchMove(event) {
    if (!this.pointer) return;
    const t = event.touches[0], dx = (t.x ?? t.clientX) - this.pointer.x, dy = (t.y ?? t.clientY) - this.pointer.y;
    if (Math.hypot(dx, dy) < 6 && !this.pointer.moved) return;
    this.pointer.moved = true;
    if (this.data.tutorialStep === 1) this.setData({tutorialStep: 2});
    // 摇杆中心跟随长距离拖动，回拨时无需退回最初落点。
    const distance = Math.hypot(dx, dy), radius = 24;
    const wx = dx * FIELD.width / (this.fieldRect?.width || FIELD.width), wy = dy * FIELD.height / (this.fieldRect?.height || FIELD.height);
    const length = Math.hypot(wx, wy), strength = Math.min(1, distance / radius);
    this.direction = length ? {dx: wx / length * strength, dy: wy / length * strength} : {dx: 0, dy: 0};
    if (distance > radius) {this.pointer.x += dx * (1 - radius / distance); this.pointer.y += dy * (1 - radius / distance);}
    this.sendDirection();
  },
  onRunTouchEnd(event) {
    const pointer = this.pointer; this.onRunTouchCancel();
    if (!pointer || pointer.moved || !this.fieldRect || !this.snapshot?.runWorld) return;
    if (pointer.targetId) {void this.teamAction(pointer.targetId); return;}
    const t = event.changedTouches?.[0];
    const x = t?.x ?? (t?.clientX !== undefined ? t.clientX - this.canvasBounds.x : pointer.x);
    const y = t?.y ?? (t?.clientY !== undefined ? t.clientY - this.canvasBounds.y : pointer.y);
    const point = fieldPoint(x, y, this.fieldRect), self = this.snapshot.players.find((p) => p.isSelf);
    const hitRadius = Math.max(FIELD.radius + 25, 30 * FIELD.width / this.fieldRect.width);
    const target = this.snapshot.runWorld.runners.filter((r) => r.id !== self?.id && Math.hypot(r.x - point.x, r.y - point.y) <= hitRadius)
      .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
    if (target) void this.teamAction(target.id);
  },
  onRunTouchCancel() {this.pointer = null; this.direction = {dx: 0, dy: 0}; this.sendDirection();},
  dismissTutorial() {this.setData({tutorialStep: 0});},
  async teamAction(targetId) {
    if (this.teamPending || this.data.waiting || this.data.rulesVisible) return;
    const self = this.snapshot?.players.find((p) => p.isSelf);
    if (targetId === self?.id) return;
    if (targetId && this.data.tutorialStep === 3) this.setData({tutorialStep: 0});
    this.onRunTouchCancel();
    this.teamPending = true; this.setData({teamPending: true, error: ''});
    try {if (this.sessionId) this.acceptState(await api.post(`/games/${this.sessionId}/team`, {targetId})); else if (targetId === null) store.clearSelfTeam(); else store.setSelfTeam(targetId);}
    catch (error) {this.setData({error: error.message || '组队同步失败'});} finally {this.teamPending = false; this.setData({teamPending: false});}
  },
  onAcceptInvite() {if (this.data.incomingId) void this.teamAction(this.data.incomingId);},
  onIgnoreInvite() {
    if (this.teamPending || !this.data.incomingId) return;
    this.ignoredInvites ||= new Set(); this.ignoredInvites.add(this.data.incomingId);
    this.onRunTouchCancel(); this.acceptState(this.snapshot);
  },
  onExitTeam() {void this.teamAction(null);},
  onTapProfile() {this.onRunTouchCancel(); wx.navigateTo({url: '/pages/profile/index'});},
  onLeaveArena() {
    this.onRunTouchCancel();
    wx.showModal({title: '离开对局', content: this.sessionId ? '联机对局继续计时，返回后可继续游玩。' : '离开将结束本次本地体验。', confirmText: '离开', cancelText: '继续接福', success: (res) => {
      if (res.confirm) {if (!this.sessionId) store.resetToHome(); wx.redirectTo({url: '/pages/home/index'});}
    }});
  },
  async cancelStart() {
    if (!this.sessionId || !this.snapshot?.awaitingStart || this.cancelPending) return;
    this.cancelPending = true;
    this.redirected = true;
    await api.post(`/games/${this.sessionId}/cancel-start`).then(() => {
      wx.redirectTo({url: `/pages/room/index?backendRoomId=${encodeURIComponent(this.snapshot.roomId)}`});
    }).catch((error) => {this.redirected = false; this.setData({error: error.message || '取消失败，请重试'});});
    this.cancelPending = false;
  },
  onToggleEmotePanel() {this.onRunTouchCancel(); this.setData({emotePanelVisible: !this.data.emotePanelVisible});},
  onToggleMessageCard() {this.setData({messageCardCollapsed: !this.data.messageCardCollapsed});},
  switchTab(event) {
    const page = event.currentTarget.dataset.page;
    if (!page || page === '/pages/arena/index') return;
    this.onRunTouchCancel();
    wx.showModal({title: '离开对局', content: this.sessionId ? '联机对局继续计时，返回后可继续游玩。' : '离开将结束本次本地体验。', confirmText: '离开', cancelText: '继续接福', success: (res) => {
      if (res.confirm) {if (!this.sessionId) store.resetToHome(); wx.redirectTo({url: page});}
    }});
  },
  onSendQuickEmote(event) {
    const key = event.currentTarget.dataset.key, self = this.snapshot?.players.find((p) => p.isSelf);
    if (self) this.showEmote(self.id, key);
    if (this.sessionId) void api.post(`/games/${this.sessionId}/emotes`, {emoteId: key}).catch((error) => this.setData({error: error.message}));
    this.setData({emotePanelVisible: false});
  },
  showEmote(id, key) {
    const emote = QUICK_EMOTES.find((e) => e.key === key); if (!emote || !this.appearance) return;
    this.appearance.emotes[id] = emote.text; this.draw();
    const sender = this.snapshot?.players.find((p) => p.id === id);
    this.setData({chatMessages: [...this.data.chatMessages, {id: `${Date.now()}-${id}`, sender: sender?.name || '玩家', text: emote.text, isSelf: !!sender?.isSelf}].slice(-20)});
    const token = this.generation; setTimeout(() => {if (token === this.generation) {delete this.appearance.emotes[id]; this.draw();}}, 2200);
  },
  onOpenRules() {this.onRunTouchCancel(); this.setData({rulesVisible: true});},
  async acknowledgeStart() {this.readyPending = true; try {this.acceptState(await api.post(`/games/${this.sessionId}/ready`, {}));} finally {this.readyPending = false;}},
  async onStartFromRules() {
    if (this.data.rulesStarting) return; this.setData({rulesStarting: true});
    try {
      if (this.sessionId && this.snapshot?.needsStartAck) await this.acknowledgeStart();
      wx.setStorageSync(RULES_KEY, '1'); this.setData({rulesVisible: false, rulesFirstRun: false, error: ''}); if (!this.sessionId) store.resumeGame();
    } catch (error) {this.setData({error: error.message || '开始失败，请重试'});} finally {this.setData({rulesStarting: false});}
  },
  noop() {},
});
