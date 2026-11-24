import {resultCard, resultShareTitle, loadResultAvatars, renderResultCard} from './render/result-share-card';
import {claimRetention, fetchExperienceLeaderboard, parsePassport, type LeaderboardEntry, type ScenicPassport} from './core/Retention';
import {getSettings, setSetting, type AudioSettings} from './core/AudioSettings';
import {analytics, playFlow} from './core/Analytics';
import {fetchDailyTasks, type DailyTasks} from './core/DailyTasks';
import * as api from './core/ApiClient';
import {AUDIO_SOURCES, STAGE_BGM_BY_NAME} from './core/AudioAssets';
import {DEFAULT_STAGE, STAGES, resolveStage, type Stage} from './core/Constants';
import {OnlineGame} from './core/OnlineGame';
import * as privacy from './core/PrivacyConsent';
import * as runtime from './core/RuntimeConfig';
import * as shop from './core/ShopStore';
import * as user from './core/UserProfile';
import type {ShopCategory} from './core/ShopTypes';
import type {StatsRecord, StatsSummary} from './core/PlayerStats';
import {GameAudio} from './platform/audio';
import {selectGrowthGoal, type GrowthGoal} from './core/GrowthGoal';
import type {Viewport} from './platform/device';
import {toast, vibrate} from './platform/feedback';
import {getWx, type WxCanvas} from './platform/wx';
import {fillRoundRect, hitTestRect, type Canvas2DContext} from './render/canvas-utils';
import {renderRulesPanel, rulesPanelLayout} from './render/rules-panel';
import {readText, writeText} from './platform/storage';
import {clearMenuImages, menuActionAt, renderMenu, type MenuAction, type MenuFrame, type MenuModel, type Screen} from './render/menu-scenes';
import {ArenaScene, type ArenaEvent} from './scenes/arena-scene';

interface RawHistory {records?: Record<string, unknown>[]; total?: number}
const NO_FRAME: MenuFrame = {hits: [], maxScroll: 0, contentTop: 0, contentBottom: 0};

export class GameApplication {
  readonly online = new OnlineGame();
  private screen: Screen = 'boot';
  private previousScreen: Screen = 'boot';
  private stage: Stage = DEFAULT_STAGE;
  private readonly mode = 'online';
  private roomSize = 4;
  private category: ShopCategory = 'skin';
  private busy = false;
  private error = '';
  private scroll = 0;
  private frame: MenuFrame = NO_FRAME;
  private arena: ArenaScene | null = null;
  private summary: StatsSummary = {totalIncome: 0, totalExp: 0, recordsCount: 0};
  private history: StatsRecord[] = [];
  private dailyTasks: DailyTasks | undefined;
  private tasksOwner = '';
  private resultGoal: GrowthGoal | null = null;
  private resultPassport?: ScenicPassport;
  private resultGoalKey = '';
  private resultGoalPending = '';
  private shareRevision = 0;
  private sharePending: {key: string; ready: Promise<void>} | null = null;
  private shareUnavailable = false;
  private shareImage: {key: string; path: string} | null = null;
  private leaderboard: LeaderboardEntry[] | undefined;
  private leaderboardOwner = '';
  private historyPage = 0;
  private historyTotal = 0;
  private revision = 0;
  private hidden = false;
  private initialized = false;
  private lifecycle = 0;
  private pointer: {x: number; y: number; previousY: number; moved: boolean} | null = null;
  private guideVisible = false;
  private guideSeen = readText('game_codex_running_rules_v1') === '1';
  private guideFirstRun = false;
  private readyPending = false;
  private clearingSession = false;
  private readonly disposeOnline: () => void;
  readonly viewport: Viewport;
  private readonly audio: GameAudio;

  constructor(viewport: Viewport, audio = new GameAudio()) {
    this.viewport = viewport;
    this.audio = audio;
    this.disposeOnline = this.online.onChange(() => {
      if (this.clearingSession || this.mode !== 'online' || !privacy.isAllowed()) return;
      const state = this.online.getState();
      void this.prepareResultShare();
      void this.loadResultGoal();
      if (!api.isLoggedIn()) {
        this.clearingSession = true;
        try {this.online.clear();} finally {this.clearingSession = false;}
        this.navigate('profile'); this.error = '账号会话已结束，请重新登录'; return;
      }
      if (state.status === 'finished' && ['room', 'arena', 'result'].includes(this.screen)) this.navigate('result');
      else if (state.status === 'playing' && state.players.length && this.screen === 'room') this.navigate('arena');
      else if (this.screen === 'arena' && state.needsStartAck && !this.guideVisible) void this.acknowledgeStart();
    });
  }

  async initialize(): Promise<void> {
    analytics.track('app_launch');
    await runtime.fetchRemoteConfig();
    try {
      if (await privacy.checkPlatformConsent()) {
        this.navigate('home');
        if (api.isLoggedIn()) {
          await user.fetchProfile();
          const restored = await this.online.restore();
          if (restored) {this.stage = this.online.getState().stage; this.navigate(this.online.getState().status === 'finished' ? 'result' : 'room');}
        }
        await this.joinLaunchRoom();
      }
    } catch (error) {this.error = error instanceof Error ? error.message : '请重试隐私授权';}
    finally {this.initialized = true; if (this.hidden) this.online.hide();}
  }

  private async joinLaunchRoom(query = getWx()?.getLaunchOptionsSync?.().query): Promise<void> {
    if (typeof query?.challenge === 'string' && query.challenge) {
      this.challengeCode = query.challenge;
      if (privacy.isAllowed() && !['room', 'arena', 'result'].includes(this.screen)) this.navigate('home');
      return;
    }
    if (query?.roomCode && /^\d{4}$/.test(query.roomCode) && privacy.isAllowed()) {
      if (this.online.getSnapshot().room) {

        if (this.online.getSnapshot().room?.code !== query.roomCode) {
          const status = this.online.getState().status;
          this.navigate(status === 'finished' ? 'result' : status === 'playing' ? 'arena' : 'room');
          this.error = '已返回当前联机房间；离开后可加入其他邀请';
        }
        return;
      }
      await this.ensureLogin(); await this.online.joinRoom(query.roomCode); this.stage = this.online.getState().stage; this.navigate('room');
    }
  }

  private challengeCode = '';

  getModel(): MenuModel {
    const inventory = shop.getStoreState();
    return {screen: this.screen, stage: this.stage, local: this.online.getState(), online: this.online.getSnapshot(), mode: this.mode,
      profile: user.getCachedProfile(), inventory, goods: this.screen === 'shop' ? shop.buildGoodsView(this.category, inventory) : [],
      dailyTasks: api.isLoggedIn() && api.getToken() === this.tasksOwner ? this.dailyTasks : undefined,
      leaderboard: api.isLoggedIn() && api.getToken() === this.leaderboardOwner ? this.leaderboard : undefined,
      category: this.category, summary: this.summary, history: this.history,
      result: this.online.getSnapshot().result,
      resultGoal: this.resultGoalKey === `${api.getToken()}:${this.online.getSnapshot().result?.resultId}` ? this.resultGoal : null,
      resultPassport: this.resultGoalKey === `${api.getToken()}:${this.online.getSnapshot().result?.resultId}` ? this.resultPassport : undefined,
      onlineAvailable: runtime.isApiSupported('onlineArena'),
      quickMatchAvailable: runtime.isApiSupported('onlineArena') && runtime.isApiSupported('quickMatch'),
      challengePending: !!this.challengeCode,
      loggedIn: api.isLoggedIn(), busy: this.busy, error: this.error || (this.mode === 'online' ? this.online.getSnapshot().error : ''),
      scroll: this.scroll, roomSize: this.roomSize, hasMoreHistory: this.history.length < this.historyTotal};
  }

  private navigate(screen: Screen): void {
    if (screen === this.screen) return;
    if (screen === 'home') analytics.track('home_view');
    if (!['boot', 'privacy', 'agreement'].includes(screen) && !privacy.isAllowed()) screen = 'boot';
    this.arena?.dispose(); this.arena = null;
    this.previousScreen = this.screen; this.screen = screen; this.scroll = 0; this.frame = NO_FRAME; this.error = '';
    if (screen === 'result') void this.loadResultGoal(true);
    this.audio.stopBgm();
    if (screen === 'arena') {
      this.guideFirstRun = !this.guideSeen;
      this.guideVisible = this.guideFirstRun;
      this.arena = new ArenaScene({width: 720, height: this.viewport.designHeight, offsetY: this.viewport.safeTop + 48,
        safeBottom: this.viewport.safeBottom, online: this.online, onEvent: (event) => this.feedback(event)});
      this.arena.start();
      if (!this.hidden) this.audio.playBgm(STAGE_BGM_BY_NAME[this.stage.name] || AUDIO_SOURCES.bgm);
      if (this.mode === 'online' && !this.guideVisible) void this.acknowledgeStart();
    }
  }

  private feedback(event: ArenaEvent): void {
    if (event.type === 'finished') {this.audio.playCue(AUDIO_SOURCES.resultWin); this.navigate('result');}
    else if (event.type === 'bomb_hit') {this.audio.playCue(AUDIO_SOURCES.actionFail); vibrate('heavy');}
    else if (event.type === 'shield_blocked' || event.type === 'combo') vibrate('light');
    else if (event.type === 'sprint') {vibrate('medium'); toast('最后15秒，好运翻倍');}
    else if (event.type === 'bag_spawned') this.audio.playCue(AUDIO_SOURCES.invite, 0.58);
    else if (event.type === 'opportunity_opened') {this.audio.playCue(AUDIO_SOURCES.tap); vibrate('medium');}
    else if (event.type === 'bag_collected' || event.type === 'team_formed') this.audio.playCue(AUDIO_SOURCES.pairOther);
  }

  update(delta: number): void {if (!this.hidden && !(this.guideVisible && this.guideFirstRun)) this.arena?.update(delta);}
  render(ctx: Canvas2DContext): void {
    if (this.screen !== 'arena' || !this.arena) {
      this.frame = renderMenu(ctx, this.viewport, this.getModel());
      this.scroll = Math.min(this.scroll, this.frame.maxScroll); return;
    }
    this.arena.render(ctx);
    const top = this.viewport.safeTop;
    fillRoundRect(ctx, {x: 28, y: top, width: 152, height: 72}, 14, '#203044');
    ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff3da'; ctx.fillText('返回', 104, top + 36);
    fillRoundRect(ctx, {x: 540, y: top, width: 152, height: 72}, 14, '#203044');
    ctx.fillText('玩法', 616, top + 36);
    const y = this.viewport.designHeight - this.viewport.safeBottom - 92;
    fillRoundRect(ctx, {x: 40, y, width: 640, height: 78}, 14, '#203044');
    ctx.fillText(`快捷表情 · ${this.online.getSnapshot().connection}`, 360, y + 39);
    if (this.guideVisible) {
      renderRulesPanel(ctx, this.viewport, this.guideFirstRun, this.readyPending, this.error);
    }
  }

  touchStart(x: number, y: number): void {this.pointer = {x, y, previousY: y, moved: false}; if (this.screen === 'arena' && !this.guideVisible) this.arena?.touchStart(x, y);}
  touchMove(x: number, y: number): void {
    const pointer = this.pointer; if (!pointer) return;
    if (this.screen === 'arena') {if (!this.guideVisible) this.arena?.touchMove(x, y); return;}
    if (Math.abs(y - pointer.y) + Math.abs(x - pointer.x) > 12) pointer.moved = true;
    if (pointer.moved && pointer.y >= this.frame.contentTop && pointer.y <= this.frame.contentBottom) this.scroll = Math.max(0, Math.min(this.frame.maxScroll, this.scroll + pointer.previousY - y));
    pointer.previousY = y;
  }
  touchEnd(x: number, y: number): void {
    const pointer = this.pointer; this.pointer = null;
    const arenaMoved = this.screen === 'arena' ? this.arena?.touchEnd() : false;
    if (arenaMoved) return;
    if (pointer?.moved || this.hidden) return;
    if (this.screen === 'arena') {
      if (this.guideVisible) {
        if (hitTestRect(x, y, rulesPanelLayout(this.viewport).button)) void this.closeRules();
        return;
      }
      if (y >= this.viewport.safeTop && y < this.viewport.safeTop + 72 && x > 540) {this.guideFirstRun = false; this.guideVisible = true; return;}
      if (y >= this.viewport.safeTop && y < this.viewport.safeTop + 72 && x < 180) {void this.dispatch({type: 'back'}); return;}
      if (y > this.viewport.designHeight - this.viewport.safeBottom - 106) {void this.dispatch({type: 'emote'}); return;}
      this.arena?.handleTap(x, y); return;
    }
    const action = menuActionAt(this.frame, x, y); if (action) void this.dispatch(action);
  }
  cancelTouch(): void {this.pointer = null; this.arena?.touchCancel();}

  private async acknowledgeStart(): Promise<boolean> {
    if (this.readyPending) return false;
    if (!this.online.getState().needsStartAck) return true;
    this.readyPending = true;
    try {await this.online.ready(); this.error = ''; return true;}
    catch (error) {this.error = error instanceof Error ? error.message : '开始失败，请重试'; return false;}
    finally {this.readyPending = false;}
  }

  private async closeRules(): Promise<void> {
    if (this.readyPending) return;
    if (this.guideFirstRun) {
      if (this.mode === 'online' && !await this.acknowledgeStart()) return;
      this.guideSeen = true;
      writeText('game_codex_running_rules_v1', '1');
    }
    this.guideFirstRun = false;
    this.guideVisible = false;
  }

  private async ensureLogin(): Promise<void> {
    privacy.assertAllowed();
    const maintenance = runtime.getFeatures().maintenance as {enabled?: boolean; message?: string} | undefined;
    if (maintenance?.enabled || runtime.getBoolean('system.maintenance_mode')) {
      throw new Error(maintenance?.message || runtime.getValue('system.maintenance_message') || '系统维护中，请稍后重试');
    }
    if (!runtime.getBoolean('wechat.login_enabled', true)) throw new Error('微信登录暂时关闭，请稍后重试');
    if (!api.isLoggedIn()) await user.login();
    if (!api.isLoggedIn()) throw new Error('请完成微信登录后重试');
  }

  private modal(title: string, content: string, editable = false): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const wxApi = getWx();
      if (!wxApi?.showModal) {reject(new Error('当前微信版本暂不支持此操作，请升级后重试')); return;}
      wxApi.showModal({title, content: editable && title === '加入房间' ? '' : content, editable, placeholderText: editable ? content : undefined, confirmText: '确认',
        success: (result) => resolve(result.confirm ? result.content?.trim() || '' : null), fail: reject});
    });
  }

  async dispatch(action: MenuAction): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = '';
    const revision = this.revision;
    try {await this.perform(action);} catch (error) {if (revision === this.revision) this.error = error instanceof Error ? error.message : '操作失败，请重试';}
    finally {this.busy = false;}
  }

  private async perform(action: MenuAction): Promise<void> {
    const {type, value} = action;
    if (type === 'audio-setting' && value && ['music', 'sound', 'voice', 'haptics'].includes(value)) {
      const key = value as keyof AudioSettings;
      const settings = setSetting(key, !getSettings()[key]); this.audio.applySettings();
      if (key === 'music' && settings.music) this.audio.playBgm(STAGE_BGM_BY_NAME[this.stage.name] || AUDIO_SOURCES.bgm);
      return;
    }
    if (type === 'privacy' || type === 'agreement') {this.navigate(type); return;}
    if (type === 'exit') {getWx()?.exitMiniProgram?.(); return;}
    if (type === 'authorize') {
      await privacy.authorize(); analytics.track('privacy_accept'); void analytics.flush(); this.navigate('home'); await this.joinLaunchRoom(); return;
    }
    if (type === 'back') {
      if (this.screen === 'privacy' || this.screen === 'agreement') this.navigate(['privacy', 'agreement'].includes(this.previousScreen) ? (privacy.isAllowed() ? 'profile' : 'boot') : this.previousScreen);
      else if (this.screen === 'room') await this.perform({type: 'leave-room'});
      else if (this.screen === 'arena') {
        if (await this.modal('暂时离开对局', '本局计时继续，可从探索页返回对战。') !== null) this.navigate('home');
      } else if (this.screen === 'result') await this.perform({type: 'home'});
      else this.navigate('home');
      return;
    }
    privacy.assertAllowed();
    if (type === 'passport-stage' && this.screen === 'result' && this.mode === 'online') {
      const recommended = this.getModel().resultPassport?.nextStage;
      const stage = recommended && String(recommended.id) === value && STAGES.find((stage) => stage.id === recommended.id);
      if (!stage) return;
      await this.online.leave();
      this.stage = stage;
      this.navigate('home');
      return;
    }
    if (['home', 'shop', 'income', 'profile', 'tasks'].includes(type)) {
      if (this.screen === 'result' && this.mode === 'online') await this.online.leave();
      this.navigate(type as Screen); await this.loadPage(); return;
    }
    if (type === 'continue') {this.navigate(this.mode === 'online' && this.online.getState().status === 'finished' ? 'result' : 'arena'); return;}
    if (type === 'next-stage') {this.stage = STAGES[(STAGES.findIndex((s) => s.id === this.stage.id) + 1) % STAGES.length]; return;}
    if (type === 'retry-service') {
      await runtime.fetchRemoteConfig(true);
      if (!runtime.isApiSupported('onlineArena')) throw new Error('对战服务暂时不可用，请稍后重试');
      return;
    }
    if (type === 'login') {await this.ensureLogin(); await this.loadPage(); return;}
    if (type === 'create-local') throw new Error('请创建或加入好友房间');
    if (type === 'quick-match' || type === 'challenge-match') {
      await this.ensureLogin();
      if (!runtime.isApiSupported('quickMatch')) throw new Error('快速匹配升级中，请稍后重试');
      const challengeCode = type === 'challenge-match' ? this.challengeCode : '';
      let stage = this.stage;
      if (challengeCode) {
        if (['room', 'playing'].includes(this.online.getState().status)) throw new Error('请先离开当前房间，再开始好友挑战');
        const owner = api.getToken();
        let challenge: {stageId: number};
        try {challenge = await api.get(`/matchmaking/challenge/${encodeURIComponent(challengeCode)}`) as {stageId: number};}
        catch (error) {
          if (error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 404 || error.statusCode === 409)) this.challengeCode = '';
          throw error;
        }
        if (owner !== api.getToken() || this.hidden || this.challengeCode !== challengeCode) return;
        stage = resolveStage({id: challenge.stageId});
      }
      const attempt = playFlow.begin(stage.id);
      try {
        const autoCreated = await this.online.quickMatch(stage, attempt, {createFriendRoomIfEmpty: !challengeCode, challengeCode});
        if (autoCreated === undefined) return;
        if (challengeCode) {
          if (this.challengeCode === challengeCode) this.challengeCode = '';
          this.stage = stage;
        }
        this.navigate('room');
        if (autoCreated) toast('当前在线玩家较少，已为您自动创建房间');
      }
      catch (error) {playFlow.failed(attempt, error); throw error;}
      return;
    }
    if (type === 'create-online' || type === 'join-online') {
      await this.ensureLogin();
      if (this.online.getSnapshot().room) {this.navigate(this.online.getState().status === 'finished' ? 'result' : 'room'); return;}
      if (type === 'create-online') {await this.online.createRoom(this.stage); analytics.track('room_create', {stageId: this.stage.id, roomId: this.online.getSnapshot().room?.id || ''});}
      else {
        const code = await this.modal('加入房间', '请输入 4 位房号', true); if (code === null) return;
        if (!/^\d{4}$/.test(code.trim())) {toast('请输入 4 位数字房号'); return;}
        await this.online.joinRoom(code.trim()); analytics.track('room_join', {roomId: this.online.getSnapshot().room?.id || ''}); this.stage = this.online.getState().stage;
      }
      this.navigate('room'); return;
    }
    if (type === 'room-size') return;
    if (type === 'start') {
      await this.ensureLogin();
      if (!this.online.getSnapshot().room) throw new Error('请先创建或加入好友房间');
      if (this.mode === 'online') {await this.online.startGame(); await this.online.refresh();}
 return;
    }
    if (type === 'ready') {await this.online.setReady(); return;}
    if (type === 'leave-room') {
      await this.online.leave();
      this.navigate('home'); return;
    }
    if (type === 'share-result') {
      if (!runtime.getBoolean('wechat.share_enabled', true)) throw new Error('分享功能暂时关闭');
      const wxApi = getWx(); if (!wxApi?.shareAppMessage) throw new Error('当前环境暂不支持分享');
      const owner = api.getToken();
      const resultId = this.online.getSnapshot().result?.resultId;
      const pending = this.sharePending;
      if (pending?.key === `${owner}:${resultId}`) await pending.ready;
      if (this.screen === 'result' && owner === api.getToken() && resultId === this.online.getSnapshot().result?.resultId) {
        wxApi.shareAppMessage(this.shareData());
      }
      return;
    }
    if (type === 'share-room') {
      analytics.track('share_click');
      const code = this.online.getSnapshot().room?.code;
      if (!code) throw new Error('请等待房间信息同步');
      if (!runtime.getBoolean('wechat.share_enabled', true)) throw new Error('分享功能暂时关闭');
      if (!getWx()?.shareAppMessage) throw new Error(`房间号 ${code}，请告知好友在加入房间中输入`);
      getWx()?.shareAppMessage?.({title: `来锦鲤前程组队 · 房间 ${code}`, query: `roomCode=${encodeURIComponent(code)}`}); return;
    }
    if (type === 'play-again') {
      const snapshot = this.online.getSnapshot();
      const attempt = playFlow.begin(this.stage.id, !!snapshot.result?.matchmaking, snapshot.sessionId);
      try {
        await runtime.fetchRemoteConfig();
        const token = api.getToken();
        if (snapshot.result?.matchmaking) {
          await this.ensureLogin();
          if (!runtime.isApiSupported('quickMatch')) throw new Error('快速匹配升级中，请稍后重试');
          await this.online.quickMatch(this.stage, attempt);
        } else {
          if (!runtime.isApiSupported('roomRematch')) throw new Error('续玩服务升级中，请稍后重试');
          if (snapshot.rematchUnavailable) {
            this.online.clear(); await this.online.createRoom(this.stage, attempt);
            analytics.track('room_create', {stageId: this.stage.id, roomId: this.online.getSnapshot().room?.id || ''});
          }
          else await this.online.rematch(attempt);
        }
        if (token !== api.getToken() || this.online.getState().status === 'finished') return;
        this.navigate(this.online.getState().status === 'playing' ? 'arena' : 'room');
      } catch (error) {playFlow.failed(attempt, error); throw error;}
      return;
    }
    if (type === 'category') {this.category = this.category === 'skin' ? 'pet' : this.category === 'pet' ? 'ring' : 'skin'; this.scroll = 0; return;}
    if ((type === 'buy' || type === 'equip') && value) {
      await this.ensureLogin();
      if (type === 'buy') {
        const item = shop.getGoodsByCategory(this.category).find((goods) => goods.id === value);
        if (!item || await this.modal('确认购买', `${item.name}需要 ${item.price} 锦鲤币。`) === null) return;
      }
      const result = await (type === 'buy' ? shop.buyViaApi(value) : shop.equipViaApi(value, this.category));
      if (!result.ok) throw new Error(result.message); toast(result.message); return;
    }
    if (type === 'nickname') {
      const name = await this.modal('修改名字', user.getCachedProfile().nickName, true); if (name === null) return;
      if (!name || name.length > 32) throw new Error('昵称请输入 1 至 32 个字符');
      await user.requestUpdate({nickName: name}); return;
    }
    if (type === 'avatar') {
      const file = await new Promise<string>((resolve, reject) => {
        const wxApi = getWx(); if (!wxApi?.chooseMedia) {reject(new Error('请升级微信后上传头像')); return;}
        wxApi.chooseMedia({count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: (res) => resolve(res.tempFiles[0]?.tempFilePath || ''), fail: reject});
      });
      await user.uploadAvatar(file); toast('头像已提交审核'); return;
    }
    if (type === 'logout' || type === 'revoke' || type === 'delete-account') {
      const message = type === 'delete-account' ? '注销后，账号将按隐私政策处理，确认继续？' : type === 'revoke' ? '撤回后将退出当前账号，重新使用时需要主动授权。' : '确认退出当前账号？';
      if (await this.modal(type === 'delete-account' ? '注销账号' : '确认操作', message) === null) return;
      if (type === 'delete-account') await user.deleteAccount();
      else {
        if (this.online.getSnapshot().room) await this.online.leave();
        user.logout();
      }
      this.revision++;
      this.clearingSession = true;
      try {this.online.clear();} finally {this.clearingSession = false;}
      this.dailyTasks = undefined;
      this.history = []; this.historyTotal = 0; this.summary = {totalIncome: 0, totalExp: 0, recordsCount: 0};
      if (type === 'revoke' || type === 'delete-account') {privacy.revoke(); privacy.clearStoredConsent(); this.navigate('boot');}
      else this.navigate('profile'); return;
    }
    if (type === 'leaderboard') {
      await this.ensureLogin(); const token = api.getToken();
      const rows = await fetchExperienceLeaderboard();
      if (token === api.getToken()) {this.leaderboard = rows; this.leaderboardOwner = token;}
      return;
    }
    if (type === 'weekend') {
      await this.ensureLogin();
      const token = api.getToken();
      const activity = await api.get('/weekend') as {stage: string; period: string; souvenir: string; active: boolean; completed: boolean};
      if (token === api.getToken() && this.screen === 'tasks' && !this.hidden) {
        const status = activity.completed ? '已获得' : activity.active ? '待完成' : '已结束';
        await this.modal('周末景区挑战', `${activity.period} 起 · 北京时间周六至周日\n${activity.stage}：完成一场联机对局\n${activity.souvenir} · ${status}`);
      }
      return;
    }
    if (type === 'claim-retention' && value) {
      await this.ensureLogin(); const token = api.getToken();
      const receipt = await claimRetention(value);
      if (token === api.getToken()) {
        if (!receipt.alreadyClaimed) analytics.track(value === 'checkin' ? 'checkin' : 'growth_claim', {taskId: value});
        toast(receipt.alreadyClaimed ? '奖励已领取并到账' : `获得 ${receipt.reward} 金币`);
        await this.loadPage(); if (token === api.getToken()) await shop.refreshInventory();
      }
      return;
    }
    if (type === 'claim-task' && value) {
      if (!api.isLoggedIn()) throw new Error('请先登录');
      const token = api.getToken();
      await api.post(`/tasks/${encodeURIComponent(value)}/claim`, {});
      if (token === api.getToken()) {toast('奖励已领取'); await this.loadPage(); if (token === api.getToken()) await shop.refreshInventory();}
      return;
    }
    if (type === 'refresh') {await this.loadPage(); return;}
    if (type === 'more-history') {await this.loadHistory(this.historyPage + 1); return;}
    if (type === 'emote') {
      const options = ['冲呀!', '收到~', '哈哈哈', '稳住别慌', '太棒了', '求带飞'];
      const index = await new Promise<number>((resolve) => {
        const wxApi = getWx();
        if (!wxApi?.showActionSheet) {resolve(-1); return;}
        wxApi.showActionSheet({itemList: options, success: (res) => resolve(res.tapIndex), fail: () => resolve(-1)});
      });
      if (index < 0) return;
      const key = ['cheer', 'ok', 'laugh', 'cool', 'heart', 'help'][index];
      if (!key) throw new Error('请输入 1 至 6 选择表情');
      if (this.mode === 'online') await this.online.sendEmote(key);
      toast(options[index]); return;
    }
  }

  private async loadPage(): Promise<void> {
    if (this.screen === 'boot') {await this.initialize(); return;}
    if (this.screen === 'room' || this.screen === 'result') {
      if (this.mode === 'online') {await this.online.refresh(); if (this.screen === 'result' && this.online.getSnapshot().result && api.isLoggedIn()) await shop.refreshInventory();}
      if (this.screen === 'result') void this.loadResultGoal(true);
      return;
    }
    if (this.screen === 'shop' && api.isLoggedIn()) await shop.refreshInventory();
    if (this.screen === 'profile' && api.isLoggedIn()) await user.fetchProfile();
    if (this.screen === 'income') await this.loadHistory(1);
    if (this.screen === 'tasks') {
      this.dailyTasks = undefined;
      const token = api.getToken();
      if (token) {
        const data = await fetchDailyTasks();
        if (token === api.getToken()) {this.dailyTasks = data; this.tasksOwner = token;}
      }
    }
  }

  private async loadResultGoal(force = false): Promise<void> {
    const {result, sessionId} = this.online.getSnapshot(), token = api.getToken();
    if (!result || !token || this.hidden || !this.online.ownsCurrentAccount() || !runtime.isApiSupported('retention') || !result.ranking.length) return;
    if ('interrupted' in result && result.interrupted === true) return;
    const key = `${token}:${result.resultId}`;
    if (this.resultGoalPending === key || (!force && this.resultGoalKey === key)) return;
    const revision = this.revision, lifecycle = this.lifecycle;
    this.resultGoalPending = key;
    try {
      const summary = await api.get('/retention', {sessionId});
      if (!this.hidden && revision === this.revision && lifecycle === this.lifecycle && token === api.getToken() && this.online.getSnapshot().result?.resultId === result.resultId) {
        const passport = parsePassport(summary && typeof summary === 'object' && 'passport' in summary ? summary.passport : undefined);
        this.resultGoal = selectGrowthGoal(summary);
        this.resultPassport = passport;
        this.resultGoalKey = key;
      }
    } catch (_) { /* Optional progress must not block the next match. */ }
    finally {if (this.resultGoalPending === key) this.resultGoalPending = '';}
  }

  private async loadHistory(page: number): Promise<void> {
    const revision = this.revision, token = api.getToken();
    if (!token) {
      this.summary = {totalIncome: 0, totalExp: 0, recordsCount: 0}; this.history = []; this.historyTotal = 0; this.historyPage = 1; return;
    }
    const [rawSummary, rawHistory] = await Promise.all([api.get('/stats/summary'), api.get(`/stats/history?page=${page}&limit=20`)]);
    if (revision !== this.revision || token !== api.getToken()) return;
    const summary = rawSummary as Record<string, number>, history = rawHistory as RawHistory;
    this.summary = {totalIncome: Number(summary.totalIncome) || 0, totalExp: Number(summary.totalExp) || 0, recordsCount: Number(summary.recordCount) || 0};
    const records = (history.records || []).map((record) => ({id: String(record.sessionId), createdAt: new Date(String(record.finishedAt || record.startedAt)).getTime(),
      stageName: resolveStage({id: Number(record.stageId)}).name, achievement: record.rank ? `第 ${record.rank} 名` : '对局进行中', income: Number(record.coinsEarned) || 0,
      exp: Math.max(0, Number(record.finalScore) - Number(record.initialScore)), modeText: '联网对战'}));
    this.history = page === 1 ? records : [...this.history, ...records.filter((record) => !this.history.some((old) => old.id === record.id))];
    this.historyTotal = Number(history.total) || 0; this.historyPage = page;
  }

  private async prepareResultShare(): Promise<void> {
    const result = this.online.getSnapshot().result;
    if (!result || !this.online.ownsCurrentAccount()) return;
    const model = resultCard(result, this.online.getState().stage.name), wx = getWx();
    if (!model || !wx?.createCanvas || this.shareUnavailable) return;
    const owner = api.getToken(), key = `${owner}:${result.resultId}`, revision = this.shareRevision;
    if (this.shareImage?.key === key || this.sharePending?.key === key) return;
    let canvas: WxCanvas;
    try {canvas = wx.createCanvas();} catch {this.shareUnavailable = true; return;}
    if (!canvas.toTempFilePath) {this.shareUnavailable = true; canvas.width = 0; canvas.height = 0; return;}
    let markReady!: () => void;
    const pending = {key, ready: new Promise<void>((resolve) => {markReady = resolve;})};
    this.sharePending = pending;
    let finished = false;
    const complete = (path = '') => {
      if (finished) return; finished = true; clearTimeout(deadline); canvas.width = 0; canvas.height = 0;
      if (this.sharePending === pending) this.sharePending = null;
      markReady();
      if (path && revision === this.shareRevision && owner === api.getToken() && this.online.getSnapshot().result?.resultId === result.resultId) this.shareImage = {key, path};
    };
    const deadline = setTimeout(() => complete(), 3000);
    try {
      const avatars = await loadResultAvatars(model, wx.createImage?.bind(wx));
      if (finished || revision !== this.shareRevision || owner !== api.getToken()
        || this.online.getSnapshot().result?.resultId !== result.resultId) {complete(); return;}
      canvas.width = 500;
      canvas.height = 400;
      renderResultCard(canvas.getContext('2d'), model, avatars);
      canvas.toTempFilePath({fileType: 'png', width: 500, height: 400, destWidth: 500, destHeight: 400,
        success: (response) => complete(response.tempFilePath), fail: () => complete()});
    } catch {complete();}
  }
  shareData(): {title: string; query: string; imageUrl?: string} {
    analytics.track('share_click');
    const snapshot = this.online.getSnapshot();
    const card = this.online.ownsCurrentAccount() ? resultCard(snapshot.result, this.online.getState().stage.name) : null;
    if (this.screen === 'result' && card && snapshot.result) {
      const key = `${api.getToken()}:${snapshot.result.resultId}`;
      const query = snapshot.result.challengeCode ? `from=result_share&challenge=${encodeURIComponent(snapshot.result.challengeCode)}` : 'from=result_share';
      return {title: resultShareTitle(card), query, ...(this.shareImage?.key === key ? {imageUrl: this.shareImage.path} : {})};
    }
    const room = snapshot.room;
    return {title: '来锦鲤前程一起接好运', query: room?.status === 'waiting' ? `roomCode=${encodeURIComponent(room.code)}` : ''};
  }
  clearImageCaches(): void {clearMenuImages(); this.arena?.clearImages();}
  hide(): void {playFlow.background(this.online.getSnapshot().room?.id || ''); this.shareRevision++; this.sharePending = null; this.shareImage = null;this.arena?.touchCancel(); this.hidden = true; this.lifecycle++; this.pointer = null; void analytics.flush(); this.online.hide(); this.audio.stopBgm();}
  async show(query?: Record<string, string>): Promise<void> {
    const wasHidden = this.hidden;
    if (query?.challenge) this.challengeCode = query.challenge;
    this.hidden = false;
    if (!this.initialized || !wasHidden) return;
    const lifecycle = ++this.lifecycle;
    try {
      const allowed = await privacy.checkPlatformConsent();
      if (this.hidden || lifecycle !== this.lifecycle) return;
      if (!allowed) {this.navigate('boot'); return;}
    } catch (error) {
      if (lifecycle === this.lifecycle) {this.navigate('boot'); this.error = error instanceof Error ? error.message : '请重试隐私授权';}
      return;
    }
    try {
      await this.joinLaunchRoom(query);
      if (this.hidden || lifecycle !== this.lifecycle) return;
    } catch (error) {
      if (lifecycle === this.lifecycle) this.error = error instanceof Error ? error.message : '加入房间失败，请重试';
    }
    analytics.track('app_launch', {source: 'foreground'});
    this.online.show();
    if (this.screen === 'tasks') await this.dispatch({type: 'refresh'});
    if (this.screen === 'arena') this.audio.playBgm(STAGE_BGM_BY_NAME[this.stage.name] || AUDIO_SOURCES.bgm);
  }
  dispose(): void {this.shareRevision++; this.lifecycle++; this.arena?.dispose(); this.disposeOnline(); this.online.stop(); this.audio.destroy();}
}
