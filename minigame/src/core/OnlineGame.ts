import * as api from './ApiClient';
import {DEFAULT_STAGE, GAME_DURATION_SECONDS, resolveStage, type Stage} from './Constants';
import {QUICK_EMOTES} from './Emote';
import type {Player, Team} from './GameEngine';
import * as localGame from './GameStore';
import type {FinishedResult, GameState} from './GameStore';
import type {Opportunity} from './Investment';
import type {RunWorld} from './RunArena';
import {assertAllowed} from './PrivacyConsent';
import {readJson, removeKey, writeJson} from '../platform/storage';
import {getWx, type WxSocketTask} from '../platform/wx';

export interface OnlineOffer {id: string; remainingSeconds: number; opportunity: Opportunity}
export interface RoomMember {id: string; name: string; ready: boolean; host: boolean; self: boolean}
export interface OnlineRoom {id: string; code: string; stageId: number; status: string; players: RoomMember[]; sessionId: string}
export interface OnlineSnapshot {room: OnlineRoom | null; sessionId: string; connection: string; error: string; result: FinishedResult | null}
export interface OnlineTransport {
  get(path: string): Promise<unknown>;
  post(path: string, data?: unknown): Promise<unknown>;
  token(): string;
}

type Data = Record<string, unknown>;
const ACTIVE_KEY = 'jinli_online_active_v1';
function object(value: unknown): Data {return value && typeof value === 'object' ? value as Data : {};}
function number(value: unknown): number {return Number(value) || 0;}
function text(value: unknown): string {return String(value ?? '');}

function parseRoom(value: unknown): OnlineRoom {
  const data = object(value), room = object(data.room);
  if (!room.id || !Array.isArray(data.players)) throw new Error('房间响应不完整，请重试');
  return {
    id: text(room.id), code: text(room.room_code), stageId: number(room.stage_id), status: text(room.status),
    sessionId: text(data.sessionId),
    players: data.players.map((raw) => {
      const p = object(raw);
      return {id: text(p.user_id), name: text(p.nick_name) || '微信用户', ready: !!p.is_ready, host: !!p.is_host, self: !!p.is_self};
    }),
  };
}

function parsePlayer(raw: unknown): Player {
  const p = object(raw);
  return {id: text(p.id), name: text(p.name), avatar: text(p.avatar), score: number(p.score), seat: number(p.seat),
    teamId: p.teamId ? text(p.teamId) : null, independent: !!p.independent, isSelf: !!p.isSelf, isRobot: !!p.isRobot, ready: true, state: text(p.state)};
}

/** 服务端持有规则与奖励；客户端负责呈现、操作、重连与恢复。 */
export class OnlineGame {
  private readonly transport: OnlineTransport;
  private state: GameState = {...localGame.getState(), stage: DEFAULT_STAGE, roomId: '', status: 'idle', players: [], teams: [], result: null, guestAssets: false, modeText: '联网对战'};
  private snapshot: OnlineSnapshot = {room: null, sessionId: '', connection: '未连接', error: '', result: null};
  private offer: OnlineOffer | null = null;
  private visibleIds: string[] = [];
  private emotes: Record<string, {text: string; until: number}> = {};
  private listeners = new Set<(state: GameState) => void>();
  private changeListeners = new Set<() => void>();
  private socket: WxSocketTask | null = null;
  private timer: number | null = null;
  private reconnectTimer: number | null = null;
  private generation = 0;
  private owner = '';
  private suspended = false;
  private pollingGeneration: number | null = null;
  private pollAgain = false;
  private reconnectAttempt = 0;
  private stateVersion = -1;

  constructor(transport: OnlineTransport = {get: api.get, post: api.post, token: api.getToken}) {this.transport = transport;}
  getState(): GameState {return this.state;}
  getSnapshot(): OnlineSnapshot {return this.snapshot;}
  getOffer(): OnlineOffer | null {return this.offer;}
  getVisibleScoreIds(): string[] {return this.visibleIds;}
  getEmotes(): Record<string, string> {return Object.fromEntries(Object.entries(this.emotes).filter(([, value]) => value.until > Date.now()).map(([id, value]) => [id, value.text]));}
  subscribe(listener: (state: GameState) => void): () => void {this.listeners.add(listener); return () => this.listeners.delete(listener);}
  onChange(listener: () => void): () => void {this.changeListeners.add(listener); return () => this.changeListeners.delete(listener);}
  private emit(): void {this.listeners.forEach((fn) => fn(this.state)); this.changeListeners.forEach((fn) => fn());}
  private active(generation: number, token = this.owner): boolean {
    return generation === this.generation && !!token && token === this.owner && token === this.transport.token();
  }
  private persist(): void {writeJson(ACTIVE_KEY, {token: this.owner, roomId: this.snapshot.room?.id || '', sessionId: this.snapshot.sessionId});}
  private fail(error: unknown): void {
    this.snapshot = {...this.snapshot, error: error instanceof Error ? error.message : '网络连接失败，请重试'};
    if (!this.transport.token()) {this.stop(); this.snapshot = {...this.snapshot, connection: '请重新登录'};}
    this.emit();
  }
  private adopt(): number {
    assertAllowed();
    const token = this.transport.token();
    if (!token) throw new Error('请先微信登录');
    this.stop();
    this.owner = token;
    this.suspended = false;
    this.snapshot = {room: null, sessionId: '', connection: '连接中', error: '', result: null};
    this.state = {...this.state, roomId: '', status: 'idle', players: [], teams: [], result: null};
    this.emotes = {};
    this.stateVersion = -1;
    this.offer = null;
    this.visibleIds = [];
    return this.generation;
  }
  async createRoom(stage: Stage): Promise<void> {
    const generation = this.adopt();
    this.state = {...this.state, stage, status: 'room', result: null};
    const result = await this.transport.post('/rooms', {stageId: stage.id});
    if (!this.active(generation)) return;
    this.acceptRoom(result);
    this.schedule();
  }
  async joinRoom(code: string): Promise<void> {
    if (!/^\d{4}$/.test(code.trim())) throw new Error('请输入四位房间号');
    if (this.snapshot.room && this.owner === this.transport.token()) throw new Error('请先离开当前联机房间，再加入其他房间');
    const generation = this.adopt();
    const found = parseRoom(await this.transport.get(`/rooms/code/${code.trim()}`));
    if (!this.active(generation)) return;
    const result = await this.transport.post(`/rooms/${found.id}/join`);
    if (!this.active(generation)) return;
    this.acceptRoom(result);
    this.schedule();
  }
  private acceptRoom(value: unknown): void {
    const room = parseRoom(value);
    this.snapshot = {...this.snapshot, room, connection: '已连接', error: ''};
    this.state = {...this.state, roomId: room.id, stage: resolveStage({id: room.stageId}), status: 'room'};
    if (room.sessionId && (room.status === 'playing' || room.status === 'finished')) {
      this.enterSession(room.sessionId);
    }
    this.persist();
    this.emit();
  }
  async setReady(): Promise<void> {await this.roomAction('ready');}
  async startGame(): Promise<void> {await this.roomAction('start');}
  private async roomAction(action: string): Promise<void> {
    if (!this.snapshot.room) throw new Error('请先进入房间');
    const generation = this.generation;
    const result = object(await this.transport.post(`/rooms/${this.snapshot.room.id}/${action}`));
    if (!this.active(generation)) return;
    if (result.sessionId) this.enterSession(text(result.sessionId));
    await this.refresh();
  }
  private enterSession(sessionId: string): void {
    if (this.snapshot.sessionId === sessionId) return;
    this.snapshot = {...this.snapshot, sessionId, result: null};
    this.stateVersion = -1;
    this.state = {...this.state, status: 'playing', players: [], teams: [], result: null};
    this.connectSocket();
    this.persist();
  }
  async restore(): Promise<boolean> {
    const saved = readJson<{token: string; roomId: string; sessionId: string}>(ACTIVE_KEY);
    if (!saved || saved.token !== this.transport.token() || (!saved.roomId && !saved.sessionId)) return false;
    this.adopt();
    this.snapshot = {...this.snapshot, sessionId: saved.sessionId, room: saved.roomId ? {id: saved.roomId, code: '', stageId: 1, status: 'waiting', players: [], sessionId: saved.sessionId} : null};
    await this.refresh();
    this.connectSocket();
    this.schedule();
    return !!this.snapshot.room || !!this.snapshot.sessionId;
  }
  async leave(): Promise<void> {
    const roomId = this.snapshot.room?.id, generation = this.generation;
    if (roomId) await this.transport.post(`/rooms/${roomId}/leave`);
    if (!this.active(generation)) return;
    this.clear();
  }
  clear(): void {
    this.stop(); removeKey(ACTIVE_KEY); this.owner = '';
    this.snapshot = {room: null, sessionId: '', connection: '未连接', error: '', result: null};
    this.state = {...this.state, status: 'idle', players: [], teams: [], result: null};
    this.offer = null; this.emit();
  }
  private acceptState(raw: unknown): void {
    const data = object(raw);
    if (text(data.sessionId) !== this.snapshot.sessionId) return;
    if (this.state.status === 'finished' && data.status !== 'finished') return;
    if (data.status === 'finished') {
      this.state = {...this.state, status: 'finished', timeLeft: 0};
      this.offer = null;
      return;
    }
    if (!Array.isArray(data.players) || !Array.isArray(data.teams)) throw new Error('对局状态恢复中，请稍后重试');
    const version = number(data.stateVersion);
    if (version < this.stateVersion) return;
    this.stateVersion = version;
    this.state = {...this.state, players: data.players.map(parsePlayer), teams: data.teams as Team[],
      runWorld: data.runWorld ? data.runWorld as RunWorld : null,
      duration: number(data.duration) || GAME_DURATION_SECONDS, timeLeft: number(data.timeLeft), round: number(data.round),
      awaitingStart: !!data.awaitingStart, needsStartAck: !!data.needsStartAck,
      status: 'playing', feedText: text(data.feedText), stage: resolveStage(object(data.stage)), guestAssets: false};
    this.offer = data.fortuneBag ? data.fortuneBag as OnlineOffer : null;
    this.visibleIds = Array.isArray(data.visibleScoreIds) ? data.visibleScoreIds.map(text) : [];
  }
  async refresh(): Promise<void> {
    if (this.suspended || !this.owner) return;
    const generation = this.generation, token = this.owner;
    if (this.pollingGeneration === generation) {this.pollAgain = true; return;}
    this.pollingGeneration = generation;
    try {
      if (this.snapshot.sessionId) {
        if (this.state.status !== 'finished') {
          const raw = await this.transport.get(`/games/${this.snapshot.sessionId}`);
          if (!this.active(generation, token)) return;
          this.acceptState(raw);
        }
        if (this.state.status === 'finished' && !this.snapshot.result) {
          const raw = object(await this.transport.get(`/games/${this.snapshot.sessionId}/result`));
          if (!this.active(generation, token)) return;
          if (!Array.isArray(raw.ranking) || !raw.resultId) throw new Error('结算确认中，请稍后重试');
          const result = raw as unknown as FinishedResult;
          this.snapshot = {...this.snapshot, result}; this.state = {...this.state, result};
          this.closeSocket();
        }
      } else if (this.snapshot.room) {
        const raw = await this.transport.get(`/rooms/${this.snapshot.room.id}`);
        if (!this.active(generation, token)) return;
        this.acceptRoom(raw);
        if (this.snapshot.sessionId) this.pollAgain = true;
      }
      this.snapshot = {...this.snapshot, connection: '已连接', error: ''};
      this.emit();
    } catch (error) {if (this.active(generation, token) || generation === this.generation) this.fail(error);}
    finally {
      if (this.pollingGeneration === generation) {
        this.pollingGeneration = null;
        if (this.pollAgain && this.active(generation, token)) {this.pollAgain = false; void this.refresh();}
      }
    }
  }
  private schedule(): void {
    if (this.timer !== null || this.suspended || !this.owner) return;
    this.timer = setTimeout(() => {this.timer = null; void this.refresh().finally(() => this.schedule());}, 1500);
  }
  private connectSocket(): void {
    this.closeSocket();
    const wxApi = getWx(), sessionId = this.snapshot.sessionId, generation = this.generation;
    if (!wxApi?.connectSocket || !sessionId || this.suspended || this.state.status === 'finished') return;
    const url = api.getBaseUrl().replace(/\/api\/?$/, '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    try {
      const socket = wxApi.connectSocket({url: `${url}/ws/arena?sessionId=${encodeURIComponent(sessionId)}`, protocols: [`arena.${this.owner}`]});
      this.socket = socket;
      const current = () => this.active(generation) && this.socket === socket && !this.suspended;
      socket.onOpen(() => {if (current()) {this.socketOpen = true; this.reconnectAttempt = 0; void this.refresh();}});
      socket.onMessage((event) => {
        if (!current()) return;
        try {
          const msg = object(JSON.parse(event.data));
          if (msg.event === 'game_state') {this.acceptState(msg.data); this.emit(); if (this.state.status === 'finished') void this.refresh();}
          else if (['game_tick', 'game_finished', 'state_changed'].includes(text(msg.event))) void this.refresh();
          if (msg.event === 'emote_broadcast') {
            const data = object(msg.data), emote = QUICK_EMOTES.find((item) => item.key === data.emoteId);
            if (emote) this.emotes[text(data.fromUserId)] = {text: emote.text, until: Date.now() + 2200};
          }
        } catch { /* 下次快照恢复。 */ }
      });
      const reconnect = (code?: number) => {
        if (!current()) return;
        this.socket = null;
        try {socket.close({code: 1000, reason: 'reconnecting'});} catch { /* 平台已关闭。 */ }
        if (code === 4001) {api.clearToken(); this.fail(new Error('账号会话已结束，请重新登录')); return;}
        this.snapshot = {...this.snapshot, connection: '重连中'}; this.emit();
        if (this.reconnectTimer === null) {
          this.reconnectTimer = setTimeout(() => {this.reconnectTimer = null; if (this.active(generation)) this.connectSocket();}, Math.min(15000, 1000 * 2 ** this.reconnectAttempt++));
        }
      };
      socket.onClose((event) => reconnect(event.code)); socket.onError(() => reconnect());
    } catch {this.snapshot = {...this.snapshot, connection: '正在同步'};}
  }
  private closeSocket(): void {const socket = this.socket; this.socket = null; this.socketOpen = false; try {socket?.send({data: JSON.stringify({event: 'run_input', data: {dx: 0, dy: 0}})}); socket?.close({code: 1000, reason: 'scene_change'});} catch { /* 平台已关闭。 */ }}
  async setSelfTeam(targetId: string): Promise<void> {await this.action('team', {targetId});}
  private movePending = false;
  private nextDirection: {dx: number; dy: number} | null = null;
  private socketOpen = false;
  setRunDirection(dx: number, dy: number): void {
    if (this.suspended || this.state.status !== 'playing' || this.state.awaitingStart) return;
    if (this.socket && this.socketOpen) {
      try {this.socket.send({data: JSON.stringify({event: 'run_input', data: {dx, dy}})}); return;} catch {this.socketOpen = false;}
    }
    this.nextDirection = {dx, dy};
    void this.flushDirection();
  }
  private async flushDirection(): Promise<void> {
    if (this.suspended || !this.owner) {this.nextDirection = null; return;}
    if (this.movePending || !this.nextDirection) return;
    const direction = this.nextDirection; this.nextDirection = null; this.movePending = true;
    try {await this.action('move', direction);} catch (error) {this.fail(error);}
    finally {this.movePending = false; if (this.nextDirection) void this.flushDirection();}
  }
  async clearSelfTeam(): Promise<void> {await this.action('team', {targetId: null});}
  async ready(): Promise<void> {await this.action('ready', {});}
  async claimFortuneBag(offerId: string): Promise<void> {await this.action('fortune-bag/claim', {offerId});}
  async sendEmote(emoteId: string): Promise<void> {await this.action('emotes', {emoteId});}
  private async action(path: string, body: unknown): Promise<void> {
    const generation = this.generation, token = this.owner, sessionId = this.snapshot.sessionId;
    if (!this.active(generation) || !sessionId) throw new Error('请重新进入当前对局');
    const raw = await this.transport.post(`/games/${sessionId}/${path}`, body);
    if (!this.active(generation, token)) return;
    if (path !== 'emotes') this.acceptState(raw);
    this.emit();
  }
  hide(): void {this.suspended = true; this.stop();}
  show(): void {this.suspended = false; if (this.owner) {void this.refresh(); this.connectSocket(); this.schedule();}}
  stop(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.timer = null; this.reconnectTimer = null; this.pollAgain = false;
    this.closeSocket();
  }
}
