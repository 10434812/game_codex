import {fetchDailyTasks, type DailyTasks} from './core/DailyTasks';
import * as api from './core/ApiClient';
import {AUDIO_SOURCES, STAGE_BGM_BY_NAME} from './core/AudioAssets';
import {DEFAULT_STAGE, STAGES, resolveStage, type Stage} from './core/Constants';
import * as local from './core/GameStore';
import {OnlineGame} from './core/OnlineGame';
import * as privacy from './core/PrivacyConsent';
import * as runtime from './core/RuntimeConfig';
import * as shop from './core/ShopStore';
import * as stats from './core/PlayerStats';
import * as user from './core/UserProfile';
import type {ShopCategory} from './core/ShopTypes';
import type {StatsRecord, StatsSummary} from './core/PlayerStats';
import {GameAudio} from './platform/audio';
import type {Viewport} from './platform/device';
import {toast, vibrate} from './platform/feedback';
import {getWx} from './platform/wx';
import {fillRoundRect, hitTestRect, type Canvas2DContext} from './render/canvas-utils';
import {renderRulesPanel, rulesPanelLayout} from './render/rules-panel';
import {readText, writeText} from './platform/storage';
import {menuActionAt, renderMenu, type MenuAction, type MenuFrame, type MenuModel, type Screen} from './render/menu-scenes';
import {ArenaScene, type ArenaEvent} from './scenes/arena-scene';

interface RawHistory {records?: Record<string, unknown>[]; total?: number}
const NO_FRAME: MenuFrame = {hits: [], maxScroll: 0, contentTop: 0, contentBottom: 0};

export class GameApplication {
  readonly online = new OnlineGame();
  private screen: Screen = 'boot';
  private previousScreen: Screen = 'boot';
  private stage: Stage = DEFAULT_STAGE;
  private mode: 'local' | 'online' = 'local';
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
  private readonly disposeOnline: () => void;
  readonly viewport: Viewport;
  private readonly audio: GameAudio;

  constructor(viewport: Viewport, audio = new GameAudio()) {
    this.viewport = viewport;
    this.audio = audio;
    this.disposeOnline = this.online.onChange(() => {
      if (this.mode !== 'online' || !privacy.isAllowed()) return;
      const state = this.online.getState();
      if (!api.isLoggedIn()) {this.mode = 'local'; this.online.clear(); this.navigate('profile'); this.error = '账号会话已结束，请重新登录'; return;}
      if (state.status === 'finished' && ['room', 'arena', 'result'].includes(this.screen)) this.navigate('result');
      else if (state.status === 'playing' && state.players.length && this.screen === 'room') this.navigate('arena');
      else if (this.screen === 'arena' && state.needsStartAck && !this.guideVisible) void this.acknowledgeStart();
    });
  }

  async initialize(): Promise<void> {
    await runtime.fetchRemoteConfig();
    try {
      if (await privacy.checkPlatformConsent()) {
        this.navigate('home');
        if (api.isLoggedIn()) {
          await user.fetchProfile();
          const restored = await this.online.restore();
          if (restored) {this.mode = 'online'; this.stage = this.online.getState().stage; this.navigate(this.online.getState().status === 'finished' ? 'result' : 'room');}
        }
        await this.joinLaunchRoom();
      }
    } catch (error) {this.error = error instanceof Error ? error.message : '请重试隐私授权';}
    finally {this.initialized = true; if (this.hidden) this.online.hide();}
  }

  private async joinLaunchRoom(query = getWx()?.getLaunchOptionsSync?.().query): Promise<void> {
    if (query?.roomCode && /^\d{4}$/.test(query.roomCode) && privacy.isAllowed()) {
      if (this.online.getSnapshot().room) {
        this.mode = 'online';
        if (this.online.getSnapshot().room?.code !== query.roomCode) {
          const status = this.online.getState().status;
          this.navigate(status === 'finished' ? 'result' : status === 'playing' ? 'arena' : 'room');
          this.error = '已返回当前联机房间；离开后可加入其他邀请';
        }
        return;
      }
      await this.ensureLogin(); this.mode = 'online'; await this.online.joinRoom(query.roomCode); this.stage = this.online.getState().stage; this.navigate('room');
    }
  }

  getModel(): MenuModel {
    const inventory = shop.getStoreState();
    return {screen: this.screen, stage: this.stage, local: local.getState(), online: this.online.getSnapshot(), mode: this.mode,
      profile: user.getCachedProfile(), inventory, goods: this.screen === 'shop' ? shop.buildGoodsView(this.category, inventory) : [],
      dailyTasks: api.isLoggedIn() ? this.dailyTasks : undefined,
      category: this.category, summary: this.summary, history: this.history,
      result: this.mode === 'online' ? this.online.getSnapshot().result : local.getState().result,
      loggedIn: api.isLoggedIn(), busy: this.busy, error: this.error || (this.mode === 'online' ? this.online.getSnapshot().error : ''),
      scroll: this.scroll, roomSize: this.roomSize, hasMoreHistory: this.history.length < this.historyTotal};
  }

  private navigate(screen: Screen): void {
    if (screen === this.screen) return;
    if (!['boot', 'privacy', 'agreement'].includes(screen) && !privacy.isAllowed()) screen = 'boot';
    this.arena?.dispose(); this.arena = null;
    if (this.mode === 'local') local.pauseGame();
    this.previousScreen = this.screen; this.screen = screen; this.scroll = 0; this.frame = NO_FRAME; this.error = '';
    this.audio.stopBgm();
    if (screen === 'arena') {
      this.guideFirstRun = !this.guideSeen;
      this.guideVisible = this.guideFirstRun;
      this.arena = new ArenaScene({width: 720, height: this.viewport.designHeight, offsetY: this.viewport.safeTop + 48,
        online: this.mode === 'online' ? this.online : undefined, onEvent: (event) => this.feedback(event)});
      this.arena.start();
      if (this.mode === 'local' && !this.hidden && !this.guideVisible) local.resumeGame();
      if (!this.hidden) this.audio.playBgm(STAGE_BGM_BY_NAME[this.stage.name] || AUDIO_SOURCES.bgm);
      if (this.mode === 'online' && !this.guideVisible) void this.acknowledgeStart();
    }
  }

  private feedback(event: ArenaEvent): void {
    if (event.type === 'finished') {this.audio.playCue(AUDIO_SOURCES.resultWin); this.navigate('result');}
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
    ctx.fillText(this.mode === 'online' ? `快捷表情 · ${this.online.getSnapshot().connection}` : '快捷表情', 360, y + 39);
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
      if (this.mode === 'local' && !this.hidden) local.resumeGame();
    }
    this.guideFirstRun = false;
    this.guideVisible = false;
  }

  private async ensureLogin(): Promise<void> {
    privacy.assertAllowed();
    if (runtime.getBoolean('system.maintenance_mode')) throw new Error(runtime.getValue('system.maintenance_message') || '系统维护中，请稍后重试');
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
    if (type === 'privacy' || type === 'agreement') {this.navigate(type); return;}
    if (type === 'exit') {getWx()?.exitMiniProgram?.(); return;}
    if (type === 'authorize') {
      await privacy.authorize(); this.navigate('home'); await this.joinLaunchRoom(); return;
    }
    if (type === 'back') {
      if (this.screen === 'privacy' || this.screen === 'agreement') this.navigate(['privacy', 'agreement'].includes(this.previousScreen) ? (privacy.isAllowed() ? 'profile' : 'boot') : this.previousScreen);
      else if (this.screen === 'room') await this.perform({type: 'leave-room'});
      else if (this.screen === 'arena') {
        if (await this.modal('暂时离开对局', this.mode === 'online' ? '本局计时继续，可从探索页返回对战。' : '本局将暂停，可从探索页继续体验。') !== null) this.navigate('home');
      } else if (this.screen === 'result') await this.perform({type: 'home'});
      else this.navigate('home');
      return;
    }
    privacy.assertAllowed();
    if (['home', 'shop', 'income', 'profile', 'tasks'].includes(type)) {
      if (type === 'home' && this.screen === 'result' && this.mode === 'online') await this.online.leave();
      this.navigate(type as Screen); await this.loadPage(); return;
    }
    if (type === 'continue') {this.navigate(this.mode === 'online' && this.online.getState().status === 'finished' ? 'result' : 'arena'); return;}
    if (type === 'next-stage') {this.stage = STAGES[(STAGES.findIndex((s) => s.id === this.stage.id) + 1) % STAGES.length]; return;}
    if (type === 'login') {await this.ensureLogin(); await this.loadPage(); return;}
    if (type === 'create-local') {
      if (this.online.getSnapshot().room) throw new Error('请先返回联机房间并离开，再创建体验局');
      this.mode = 'local'; local.createRoomFromStage(this.stage, {roomSize: this.roomSize}); this.navigate('room'); return;
    }
    if (type === 'create-online' || type === 'join-online') {
      await this.ensureLogin();
      if (this.online.getSnapshot().room) {this.mode = 'online'; this.navigate(this.online.getState().status === 'finished' ? 'result' : 'room'); return;}
      if (type === 'create-online') {this.mode = 'online'; await this.online.createRoom(this.stage);}
      else {
        const code = await this.modal('加入房间', '输入四位房间号', true); if (code === null) return;
        this.mode = 'online'; await this.online.joinRoom(code); this.stage = this.online.getState().stage;
      }
      this.navigate('room'); return;
    }
    if (type === 'room-size') {this.roomSize = this.roomSize >= 10 ? 4 : this.roomSize + 2; local.createRoomFromStage(this.stage, {roomSize: this.roomSize}); return;}
    if (type === 'start') {
      if (this.mode === 'online') {await this.online.startGame(); await this.online.refresh();}
      else {local.startGame({autoStartTimer: false}); this.navigate('arena');} return;
    }
    if (type === 'ready') {await this.online.setReady(); return;}
    if (type === 'leave-room') {
      if (this.mode === 'online') await this.online.leave(); else local.resetToHome();
      this.navigate('home'); return;
    }
    if (type === 'share-room') {
      const code = this.online.getSnapshot().room?.code;
      if (!code) throw new Error('请等待房间信息同步');
      if (!runtime.getBoolean('wechat.share_enabled', true)) throw new Error('分享功能暂时关闭');
      if (!getWx()?.shareAppMessage) throw new Error(`房间号 ${code}，请告知好友在加入房间中输入`);
      getWx()?.shareAppMessage?.({title: `来锦鲤前程组队 · 房间 ${code}`, query: `roomCode=${encodeURIComponent(code)}`}); return;
    }
    if (type === 'play-again') {
      if (this.mode === 'online') {await this.online.leave(); await this.online.createRoom(this.stage);}
      else local.createRoomFromStage(this.stage, {roomSize: this.roomSize});
      this.navigate('room'); return;
    }
    if (type === 'category') {this.category = this.category === 'skin' ? 'pet' : this.category === 'pet' ? 'ring' : 'skin'; this.scroll = 0; return;}
    if ((type === 'buy' || type === 'equip') && value) {
      if (type === 'buy') {
        const item = shop.getGoodsByCategory(this.category).find((goods) => goods.id === value);
        if (!item || await this.modal('确认购买', `${item.name}需要 ${item.price} 锦鲤币。`) === null) return;
      }
      const result = api.isLoggedIn()
        ? await (type === 'buy' ? shop.buyViaApi(value) : shop.equipViaApi(value, this.category))
        : type === 'buy' ? shop.purchaseItem(this.category, value) : shop.equipItem(this.category, value);
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
      this.revision++; this.online.clear(); local.resetToHome();
      this.dailyTasks = undefined;
      this.history = []; this.historyTotal = 0; this.summary = {totalIncome: 0, totalExp: 0, recordsCount: 0};
      if (type === 'revoke' || type === 'delete-account') {privacy.revoke(); privacy.clearStoredConsent(); this.navigate('boot');}
      else this.navigate('profile'); return;
    }
    if (type === 'claim-task' && value) {
      if (!api.isLoggedIn()) throw new Error('请先登录');
      const token = api.getToken();
      await api.post(`/tasks/${encodeURIComponent(value)}/claim`, {});
      if (token === api.getToken()) {toast('奖励已领取'); await this.loadPage(); await shop.refreshInventory();}
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
        if (token === api.getToken()) this.dailyTasks = data;
      }
    }
  }

  private async loadHistory(page: number): Promise<void> {
    const revision = this.revision, token = api.getToken();
    if (!token) {
      this.summary = stats.getSummary(); this.history = stats.getIncomeRecords(); this.historyTotal = this.history.length; this.historyPage = 1; return;
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

  hide(): void {this.arena?.touchCancel(); this.hidden = true; this.lifecycle++; this.pointer = null; this.online.hide(); if (this.mode === 'local') local.pauseGame(); this.audio.stopBgm();}
  async show(query?: Record<string, string>): Promise<void> {
    const wasHidden = this.hidden;
    this.hidden = false;
    if (!this.initialized || !wasHidden) return;
    const lifecycle = ++this.lifecycle;
    try {
      const allowed = await privacy.checkPlatformConsent();
      if (this.hidden || lifecycle !== this.lifecycle) return;
      if (!allowed) {this.navigate('boot'); return;}
      await this.joinLaunchRoom(query);
      if (this.hidden || lifecycle !== this.lifecycle) return;
    } catch (error) {
      if (lifecycle === this.lifecycle) {this.navigate('boot'); this.error = error instanceof Error ? error.message : '请重试隐私授权';}
      return;
    }
    if (this.mode === 'online') this.online.show(); else if (this.screen === 'arena' && !(this.guideVisible && this.guideFirstRun)) local.resumeGame();
    if (this.screen === 'tasks') await this.dispatch({type: 'refresh'});
    if (this.screen === 'arena') this.audio.playBgm(STAGE_BGM_BY_NAME[this.stage.name] || AUDIO_SOURCES.bgm);
  }
  dispose(): void {this.lifecycle++; this.arena?.dispose(); this.disposeOnline(); this.online.stop(); local.pauseGame(); this.audio.destroy();}
}
