import type {GameState, GameStatus} from '../core/GameStore';
import type {OnlineGame} from '../core/OnlineGame';
import type {Player} from '../core/GameEngine';
import type {RandomSource} from '../core/Random';
import {FIELD, isSprint} from '../core/RunArena';
import {readDrag, type DragPointer} from '../core/ArenaMotion';
import {renderRunArena, runFieldRect, fieldPoint} from '../render/run-arena-renderer';
import {fillRoundRect, type Canvas2DContext} from '../render/canvas-utils';
import type {RunAppearance} from '../render/run-arena-renderer';
import * as shopStore from '../core/ShopStore';
import {getWx} from '../platform/wx';
import {ARENA_EFFECT_ASSETS, ARENA_DROP_ASSETS} from '../render/arena-effects';

export type ArenaEvent = {type: 'bag_spawned' | 'opportunity_opened' | 'bag_expired' | 'finished' | 'team_formed' | 'bomb_hit' | 'shield_blocked' | 'combo' | 'sprint'} | {type: 'bag_collected'; bonus: number};
export interface ArenaResultRow {id: string; name: string; score: string; rank: number; isSelf: boolean}
export interface ArenaSnapshot {
  status: GameStatus; timeLeft: number; playerCount: number; teamCount: number; hasFortuneBag: boolean;
  fortuneBagPosition: {x: number; y: number} | null; bagCountdownSeconds: number;
  pendingOpportunity: {name: string; bonus: number} | null; ranking: ArenaResultRow[];
}
export interface ArenaSource {
  getState(): GameState;
  subscribe(listener: (state: GameState) => void): () => void;
  setRunDirection(dx: number, dy: number): void;
  setSelfTeam(targetId: string): unknown;
  clearSelfTeam(): unknown;
}
export interface ArenaSceneOptions {source?: ArenaSource; online?: OnlineGame; random?: RandomSource; offsetY?: number; safeBottom?: number; width?: number; height?: number; onEvent?: (event: ArenaEvent) => void}
export interface SelfRankInfo {text: string; lead: boolean}
export function buildSelfRankInfo(players: readonly Player[] | null | undefined): SelfRankInfo {
  const list = Array.isArray(players) ? players.filter(Boolean) : [], self = list.find((p) => p.isSelf);
  if (list.length < 2 || !self) return {text: '', lead: false};
  const rank = list.filter((p) => p.score > self.score).length + 1;
  return {text: `当前第 ${rank} / ${list.length} 名`, lead: rank === 1};
}

/** 状态由本地 store 或服务器持有。场景负责触控、绘制和反馈。 */
export class ArenaScene {
  private readonly online: OnlineGame | null;
  private readonly width: number;
  private readonly height: number;
  private readonly top: number;
  private readonly safeBottom: number;
  private readonly source: ArenaSource;
  private readonly onEvent: ((event: ArenaEvent) => void) | null;
  private gameState: GameState;
  private unsubscribe: (() => void) | null = null;
  private pointer: DragPointer | null = null;
  private direction = {dx: 0, dy: 0};
  private inputMs = 0;
  private effectId = 0;
  private redFlashMs = 0;
  private sprintAnnounced = false;
  private imageGeneration = 0;
  private retryImagesAt = new Map<string, number>();
  private error = '';
  private pending = false;
  private appearance: RunAppearance = {images: {}};
  private requestedImages = new Set<string>();
  constructor(options: ArenaSceneOptions = {}) {
    const source = options.online || options.source;
    if (!source) throw new Error('需要服务端对局数据源');
    this.source = source;
    this.online = options.online || null; this.width = options.width ?? 720; this.height = options.height ?? 1280;
    this.top = (options.offsetY ?? 160) + 140; this.safeBottom = Math.max(0, options.safeBottom ?? 0); this.onEvent = options.onEvent || null;
    this.gameState = this.source.getState();
  }
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.source.subscribe((state) => {
      const previous = this.gameState.status; this.gameState = state;
      if (state.status === 'finished' && previous !== 'finished') this.onEvent?.({type: 'finished'});
      const self = state.players.find((p) => p.isSelf);
      if (!state.awaitingStart && state.runWorld && isSprint(state.runWorld.elapsedMs) && !this.sprintAnnounced) {
        this.sprintAnnounced = true; this.onEvent?.({type: 'sprint'});
      }
      for (const e of state.runWorld?.effects || []) {
        if (e.id <= this.effectId) continue; this.effectId = e.id;
        if ([e.actorId, e.teammateId].includes(self?.id || '')) {
          if (e.type === 'team') this.onEvent?.({type: 'team_formed'});
          else if (e.delta > 0) this.onEvent?.({type: 'bag_collected', bonus: e.delta});
          if (e.actorId === self?.id) {
            if (e.blocked) this.onEvent?.({type: 'shield_blocked'});
            else if (e.kind === 'bomb' && e.delta < 0) {this.redFlashMs = 300; this.onEvent?.({type: 'bomb_hit'});}
            if ((e.combo || 0) >= 3) this.onEvent?.({type: 'combo'});
          }
        }
      }
    });
    this.gameState = this.source.getState();
  }
  dispose(): void {this.clearImages(); this.touchCancel(); this.unsubscribe?.(); this.unsubscribe = null;}
  update(deltaMs: number): void {
    if (Number.isFinite(deltaMs) && deltaMs > 0) this.redFlashMs = Math.max(0, this.redFlashMs - deltaMs);
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || !this.pointer?.moved) return;
    this.inputMs += deltaMs; if (this.inputMs >= 150) {this.inputMs = 0; this.sendDirection();}
  }
  clearImages(): void {this.imageGeneration++; this.appearance.images = {}; this.requestedImages.clear(); this.retryImagesAt.clear();}
  private rect() {return runFieldRect(this.width, this.height - 100 - this.safeBottom, this.top);}
  render(ctx: Canvas2DContext): void {
    this.appearance = {...this.appearance, ...shopStore.getEquippedDisplay(), emotes: this.online?.getEmotes() || {}};
    const wx = getWx();
    const stageImage = this.gameState.stage.image;
    for (const url of [...Object.values(ARENA_EFFECT_ASSETS), ...Object.values(ARENA_DROP_ASSETS), ...this.gameState.players.map((p) => p.avatar), this.appearance.skinImage, this.appearance.ringImage, this.appearance.petImage, stageImage]) {
      if (!url || this.requestedImages.has(url) || Date.now() < (this.retryImagesAt.get(url) || 0) || !wx?.createImage) continue;
      this.requestedImages.add(url); const generation = this.imageGeneration, image = wx.createImage();
      image.onload = () => {if (generation === this.imageGeneration) {this.appearance.images![url] = image; this.retryImagesAt.delete(url);}};
      image.onerror = () => {if (generation === this.imageGeneration) {this.requestedImages.delete(url); this.retryImagesAt.set(url, Date.now() + 5000);}}; image.src = url.startsWith('/') ? url.slice(1) : url;
    }
    ctx.fillStyle = '#142335'; ctx.fillRect(0, 0, this.width, this.height);
    const backdrop = this.appearance.images?.[stageImage];
    if (backdrop) {
      const scale = Math.max(this.width / backdrop.width, this.height / backdrop.height);
      const w = backdrop.width * scale, h = backdrop.height * scale;
      ctx.drawImage(backdrop, (this.width - w) / 2, (this.height - h) / 2, w, h);
      ctx.fillStyle = '#07132199'; ctx.fillRect(0, 0, this.width, this.height);
    }
    fillRoundRect(ctx, {x: this.width / 2 - 210, y: this.top - 125, width: 420, height: 106}, 38, '#efc781');
    const world = this.gameState.runWorld, self = this.gameState.players.find((p) => p.isSelf);
    const runner = world?.runners.find((r) => r.id === self?.id);
    ctx.fillStyle = '#51361e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px sans-serif'; ctx.fillText(`${this.gameState.timeLeft}s · ${world && isSprint(world.elapsedMs) ? '好运翻倍' : '我的积分'} ${self?.score || 0}`, this.width / 2, this.top - 90);
    ctx.font = '24px sans-serif'; ctx.fillText(buildSelfRankInfo(this.gameState.players).text, this.width / 2, this.top - 48);
    if (world) renderRunArena(ctx, this.online?.getRenderWorld() || world, this.gameState.players, this.rect(), this.appearance);
    const y = this.rect().y + this.rect().height + 25;
    ctx.font = '22px sans-serif'; ctx.fillStyle = '#fff3da';
    fillRoundRect(ctx, {x: 24, y: y - 16, width: this.width - 48, height: 84}, 10, '#203044');
    ctx.fillText(this.error || (this.gameState.awaitingStart ? '等待所有玩家开始' : '拖动跑动 · 松手停住 · 点选玩家邀请'), this.width / 2, y);
    if (this.redFlashMs > 0) {
      ctx.save(); ctx.globalAlpha = this.redFlashMs / 300; ctx.fillStyle = '#c34434';
      ctx.fillRect(0, 0, this.width, 12); ctx.fillRect(0, this.height - 12, this.width, 12);
      ctx.fillRect(0, 0, 12, this.height); ctx.fillRect(this.width - 12, 0, 12, this.height); ctx.restore();
    }
    if (runner?.mateId || runner?.targetId) {
      fillRoundRect(ctx, {x: 240, y: y + 17, width: 240, height: 48}, 10, '#8a4f1c');
      ctx.fillStyle = '#fff8ea'; ctx.fillText(runner.mateId ? '退出组队' : '取消邀请', this.width / 2, y + 41);
    } else {ctx.fillStyle = '#ddc9a6'; ctx.fillText('福 +10 · 礼 +20 · 雷扣10 · 队友同步一半', this.width / 2, y + 43);}
  }
  touchStart(x: number, y: number): void {
    const rect = this.rect(); if (y < rect.y || y > rect.y + rect.height || this.gameState.awaitingStart) return;
    this.pointer = {x, y, lastX: x, lastY: y, moved: false};
  }
  touchMove(x: number, y: number): void {
    if (!this.pointer) return;
    const rect = this.rect();
    const direction = readDrag(this.pointer, x, y, rect.width, rect.height, 8, 48);
    if (!direction) return;
    this.direction = direction;
    this.sendDirection();
  }
  touchEnd(): boolean {const moved = !!this.pointer?.moved; this.touchCancel(); return moved;}
  touchCancel(): void {this.pointer = null; this.direction = {dx: 0, dy: 0}; this.sendDirection();}
  private sendDirection(): void {this.source.setRunDirection(this.direction.dx, this.direction.dy);}
  handleTap(x: number, y: number): boolean {
    const world = this.gameState.runWorld; if (!world || this.gameState.status !== 'playing' || this.gameState.awaitingStart) return false;
    const self = this.gameState.players.find((p) => p.isSelf), runner = world.runners.find((r) => r.id === self?.id);
    const rect = this.rect(), exitY = rect.y + rect.height + 42;
    if (runner && (runner.mateId || runner.targetId) && x >= 240 && x <= 480 && y >= exitY && y <= exitY + 48) {void this.teamAction(null); return true;}
    const point = fieldPoint(x, y, rect);
    const target = world.runners.filter((r) => r.id !== self?.id && Math.hypot(r.x - point.x, r.y - point.y) <= FIELD.radius + 25)
      .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
    if (!target) return false;
    void this.teamAction(target.id); return true;
  }
  private async teamAction(targetId: string | null): Promise<void> {
    if (this.pending) return; this.pending = true;
    try {
      if (targetId) await this.source.setSelfTeam(targetId); else await this.source.clearSelfTeam();
      this.error = '';
    } catch (error) {this.error = error instanceof Error ? error.message : '组队同步失败';} finally {this.pending = false;}
  }
  getSnapshot(): ArenaSnapshot {
    const bag = this.gameState.runWorld?.drops.find((d) => d.kind !== 'bomb');
    const ranking = this.gameState.result?.ranking || [];
    return {status: this.gameState.status, timeLeft: this.gameState.timeLeft, playerCount: this.gameState.players.length, teamCount: this.gameState.teams.length,
      hasFortuneBag: !!bag, fortuneBagPosition: bag ? {x: bag.x, y: bag.y} : null, bagCountdownSeconds: 0, pendingOpportunity: null,
      ranking: ranking.map((p) => ({id: p.id, name: p.name, score: String(p.score), rank: p.rank, isSelf: !!p.isSelf}))};
  }
  buildBoardPlayers() {
    const rect = this.rect();
    return this.gameState.players.map((p) => {const r = this.gameState.runWorld?.runners.find((r) => r.id === p.id);
      return {...p, x: rect.x + (r?.x || 0) * rect.width / FIELD.width, y: rect.y + (r?.y || 0) * rect.height / FIELD.height};});
  }
}
