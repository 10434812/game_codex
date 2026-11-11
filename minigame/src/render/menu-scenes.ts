import type {DailyTasks} from '../core/DailyTasks';
import {STAGES, type Stage} from '../core/Constants';
import type {FinishedResult, GameState} from '../core/GameStore';
import type {OnlineSnapshot} from '../core/OnlineGame';
import type {GoodsViewItem, ShopCategory, ShopState} from '../core/ShopTypes';
import type {StatsRecord, StatsSummary} from '../core/PlayerStats';
import type {UserProfile} from '../core/UserProfile';
import {isReady, legalConfig} from '../core/LegalConfig';
import {getWx, type WxImage} from '../platform/wx';
import type {Viewport} from '../platform/device';
import {ellipsize, fillRoundRect, hitTestRect, type Canvas2DContext, type Rect} from './canvas-utils';

export type Screen = 'boot' | 'home' | 'room' | 'arena' | 'result' | 'shop' | 'profile' | 'income' | 'privacy' | 'agreement' | 'tasks';
export interface MenuAction {type: string; value?: string}
export interface MenuModel {
  screen: Screen; stage: Stage; local: GameState; online: OnlineSnapshot; mode: 'local' | 'online';
  profile: UserProfile; inventory: ShopState; goods: GoodsViewItem[]; category: ShopCategory;
  dailyTasks?: DailyTasks;
  summary: StatsSummary; history: StatsRecord[]; result: FinishedResult | null;
  loggedIn: boolean; busy: boolean; error: string; scroll: number; roomSize: number; hasMoreHistory: boolean;
}
export interface MenuHit {rect: Rect; action: MenuAction}
export interface MenuFrame {hits: MenuHit[]; maxScroll: number; contentTop: number; contentBottom: number}

const INK = '#fff3da', MUTED = '#ddc9a6', DARK = '#101d2c', PANEL = '#203044', GOLD = '#f5bc60';
const imageCache = new Map<string, {image: WxImage; ready: boolean}>();
function image(ctx: Canvas2DContext, url: string, rect: Rect): void {
  if (!url) return;
  let entry = imageCache.get(url);
  if (!entry) {
    const wxApi = getWx(); if (!wxApi) return;
    if (imageCache.size >= 48) imageCache.delete(imageCache.keys().next().value as string);
    entry = {image: wxApi.createImage(), ready: false};
    const current = entry;
    current.image.onload = () => {current.ready = true;};
    current.image.onerror = () => {current.ready = false;};
    imageCache.set(url, current); current.image.src = url;
  }
  if (entry.ready && entry.image.width > 0) {
    ctx.save(); ctx.beginPath(); ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x + rect.width, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height); ctx.lineTo(rect.x, rect.y + rect.height); ctx.closePath(); ctx.clip();
    const scale = Math.max(rect.width / entry.image.width, rect.height / entry.image.height);
    const w = entry.image.width * scale, h = entry.image.height * scale;
    ctx.drawImage(entry.image, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h); ctx.restore();
  }
}

class Page {
  y = 0;
  readonly hits: MenuHit[] = [];
  readonly top: number;
  readonly bottom: number;
  readonly ctx: Canvas2DContext;
  readonly viewport: Viewport;
  readonly model: MenuModel;
  constructor(ctx: Canvas2DContext, viewport: Viewport, model: MenuModel) {
    this.ctx = ctx; this.viewport = viewport; this.model = model;
    this.top = viewport.safeTop + 112;
    this.bottom = viewport.designHeight - viewport.safeBottom - 116;
  }
  text(value: string, x: number, y: number, size = 28, color = INK, bold = false, maxWidth = 624): void {
    const c = this.ctx; c.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = color;
    c.fillText(ellipsize(c, value, maxWidth), x, y);
  }
  label(value: string, size = 28, color = MUTED): void {this.text(value, 40, this.at(26), size, color); this.y += 58;}
  paragraph(value: string, size = 26, color = MUTED): void {
    const c = this.ctx; c.font = `${size}px sans-serif`;
    let line = '';
    for (const ch of Array.from(value)) {
      if (ch === '\n' || (line && c.measureText(line + ch).width > 624)) {this.text(line, 48, this.at(22), size, color); this.y += 40; line = ch === '\n' ? '' : ch;} else line += ch;
    }
    if (line) {this.text(line, 48, this.at(22), size, color); this.y += 40;}
    this.y += 18;
  }
  heading(value: string): void {this.y += 22; this.text(value, 40, this.at(28), 34, INK, true); this.y += 78;}
  at(offset = 0): number {return this.top + this.y - this.model.scroll + offset;}
  button(label: string, type: string, value?: string, primary = true, enabled = true): void {
    const rect = {x: 40, y: this.at(), width: 640, height: 88};
    fillRoundRect(this.ctx, rect, 14, enabled && primary ? GOLD : PANEL);
    this.text(label, 64, rect.y + 44, 30, enabled && primary ? '#30210e' : enabled ? INK : '#aeafa8', true, 588);
    if (enabled) this.hit(rect, {type, value});
    this.y += 108;
  }
  hit(rect: Rect, action: MenuAction): void {
    const y = Math.max(rect.y, this.top), end = Math.min(rect.y + rect.height, this.bottom);
    if (end > y) this.hits.push({rect: {...rect, y, height: end - y}, action});
  }
  row(title: string, detail: string, accent = false): void {
    this.text(title, 48, this.at(32), 28, accent ? GOLD : INK, accent, 350);
    this.text(detail, 422, this.at(32), 26, accent ? GOLD : MUTED, false, 242);
    this.ctx.fillStyle = '#374358'; this.ctx.fillRect(48, this.at(66), 624, 1); this.y += 82;
  }
}

function home(p: Page): void {
  const m = p.model;
  if ((m.mode === 'online' ? m.online.sessionId : m.local.status === 'playing') && !m.result) p.button('继续当前对局', 'continue');
  const hero = {x: 40, y: p.at(), width: 640, height: 330};
  fillRoundRect(p.ctx, hero, 16, m.stage.theme.deep); image(p.ctx, m.stage.image, hero);
  p.ctx.fillStyle = 'rgba(8, 17, 29, 0.72)'; p.ctx.fillRect(hero.x, hero.y + 220, hero.width, 110);
  p.text(m.stage.name, 66, hero.y + 254, 40, INK, true);
  p.text(m.stage.slogan, 66, hero.y + 297, 25, INK); p.y += 354;
  p.button('切换景区', 'next-stage', undefined, false);
  p.paragraph('120 秒跑动接福袋、抢礼物、躲雷。\n个人积分最高者获胜。');
  p.button('创建联机房间 · 邀请好友', 'create-online', undefined, true, !m.busy);
  p.button('输入房间号 · 加入好友房间', 'join-online', undefined, false, !m.busy);
  p.button('每日任务 · 领取锦鲤币', 'tasks', undefined, false, !m.busy);
  p.button('本地体验 · 与模拟玩家对战', 'create-local', undefined, false, !m.busy);
  if (!m.loggedIn) p.label('联机与账号商城使用微信登录', 24);
  p.label(`景区 ${STAGES.findIndex((s) => s.id === m.stage.id) + 1} / ${STAGES.length}`, 24);
}

function room(p: Page): void {
  const m = p.model, online = m.mode === 'online', room = m.online.room;
  p.heading(online ? `房间 ${room?.code || '同步中'}` : `${m.roomSize} 人本地体验`);
  p.label(m.stage.name);
  if (online) {
    (room?.players || []).forEach((member) => p.row(`${member.self ? '我 · ' : ''}${member.name}`, member.host ? '房主' : member.ready ? '已准备' : '等待准备', member.self));
    p.label(`${room?.players.length || 0} / 10 人 · ${m.online.connection}`, 24);
    p.button('邀请好友', 'share-room', undefined, false, !!room);
    const self = room?.players.find((player) => player.self);
    if (!self) p.paragraph('正在确认当前玩家身份，请刷新房间信息。');
  } else {
    m.local.players.forEach((member) => p.row(member.name, member.isSelf ? '我 · 房主' : '机器人', member.isSelf));
    p.button('调整人数', 'room-size', undefined, false);
  }
}

function result(p: Page): void {
  const m = p.model, result = m.result;
  if (!result) {p.heading('本局结算确认中'); p.paragraph('正在同步服务端结果。可以点击重新同步，确认后展示奖励与排行。'); p.button('重新同步', 'refresh', undefined, true, !m.busy); return;}
  const self = result.ranking.find((player) => player.isSelf), rank = self?.rank;
  p.heading(rank ? `你获得第 ${rank} 名` : '本局已结束');
  p.label(`共 ${result.ranking.length} 位玩家`, 26);
  if (self) p.row('我的积分', `${self.score} 分`, true);
  p.row('锦鲤币奖励', `+${result.coins}`, true);
  p.row('积分增益', `+${result.gain}`);
  if (result.rewardNotice) p.paragraph(result.rewardNotice);
  p.paragraph(result.achievement || '每一局都是新的旅程');
  result.ranking.forEach((player) => p.row(`${player.rank}  ${player.isSelf ? '我 · ' : ''}${player.name}`, `${player.score} 分`, player.isSelf));
}

function shop(p: Page): void {
  const m = p.model;
  p.row('锦鲤币', String(m.inventory.coins), true);
  p.label(m.loggedIn ? '账号资产' : '游客体验资产', 24);
  if (m.inventory.syncStatus === 'error') p.paragraph(m.inventory.syncError || '资产同步失败，请刷新重试');
  p.button(`分类：${m.category === 'skin' ? '皮肤' : m.category === 'pet' ? '萌宠' : '头像光环'} · 点击切换`, 'category', undefined, false);
  m.goods.forEach((item) => {
    const top = p.at(); fillRoundRect(p.ctx, {x: 40, y: top, width: 640, height: 218}, 16, PANEL);
    const url = 'skinImage' in item ? item.skinImage : 'petImage' in item ? item.petImage : item.ringImage;
    image(p.ctx, url, {x: 58, y: top + 20, width: 132, height: 132});
    p.text(item.name, 214, top + 44, 29, INK, true, 434);
    p.text(`${item.price} 锦鲤币`, 214, top + 86, 26, GOLD);
    p.text(item.description, 214, top + 126, 23, MUTED, false, 430);
    const rect = {x: 214, y: top + 154, width: 424, height: 52};
    // 商品整行作为点击目标，按钮文案明确展示操作。
    p.text(item.equipped ? '已装备' : item.owned ? '装备' : '购买', rect.x, rect.y + 24, 27, GOLD, true);
    if (!item.equipped && !m.busy) p.hit({x: 40, y: top, width: 640, height: 218}, {type: item.owned ? 'equip' : 'buy', value: item.id});
    p.y += 238;
  });
  if (!m.goods.length) p.paragraph('当前分类暂无商品');
  p.button('刷新资产', 'refresh', undefined, false, !m.busy);
}

function profile(p: Page): void {
  const m = p.model;
  image(p.ctx, m.profile.avatarUrl, {x: 48, y: p.at(), width: 104, height: 104});
  p.text(m.profile.nickName, 178, p.at(36), 36, INK, true, 480);
  p.text(m.loggedIn ? '微信已登录' : '本地体验账号', 178, p.at(84), 25, MUTED); p.y += 132;
  if (m.loggedIn) {
    p.button('修改名字', 'nickname', undefined, false, !m.busy);
    p.button('修改头像', 'avatar', undefined, false, !m.busy);
  } else {
    p.paragraph('登录后即可修改名字和头像，用于联机对战。');
    p.button('微信登录', 'login', undefined, true, !m.busy);
  }
  p.row('锦鲤币', String(m.inventory.coins));
  p.button('每日任务', 'tasks', undefined, false, !m.busy);
  p.button('查看战绩与收益', 'income', undefined, false);
  p.button('隐私政策', 'privacy', undefined, false);
  p.button('用户协议', 'agreement', undefined, false);
  p.button('撤回隐私授权', 'revoke', undefined, false, !m.busy);
  if (m.loggedIn) {
    p.button('退出登录', 'logout', undefined, false, !m.busy);
    p.button('注销账号', 'delete-account', undefined, false, !m.busy);
  }
}

function income(p: Page): void {
  const m = p.model;
  p.row('累计锦鲤币', String(m.summary.totalIncome), true); p.row('累计经验', String(m.summary.totalExp));
  p.label(m.loggedIn ? '账号对局记录' : '游客体验记录', 24);
  if (!m.history.length) p.paragraph('完成一局对战后，这里会展示奖励和记录。');
  m.history.forEach((record) => {
    p.row(record.stageName || '对局奖励', `+${record.income}`);
    p.label(`${new Date(record.createdAt).toLocaleDateString()} · ${record.achievement || record.modeText}`, 23);
  });
  if (m.hasMoreHistory) p.button('加载更多记录', 'more-history', undefined, false, !m.busy);
  p.button('刷新记录', 'refresh', undefined, false, !m.busy);
}

function tasks(p: Page): void {
  const m = p.model;
  p.heading('今日积福');
  p.paragraph('北京时间每日 00:00 重置。仅正常结算的联机对局计入任务；组队任务需结算时保持组队。');
  if (!m.loggedIn) {
    p.paragraph('登录后可参与每日任务，游客对局不计入进度。');
    p.button('微信登录', 'login', undefined, true, !m.busy);
    return;
  }
  if (m.dailyTasks) {
    p.label(m.dailyTasks.date, 24);
    for (const task of m.dailyTasks.tasks) {
      p.row(task.title, `${task.progress} / ${task.target}`);
      p.button(task.claimed ? `已领取 ${task.reward} 金币` : task.progress < task.target ? `未完成 · 奖励 ${task.reward} 金币` : `领取 ${task.reward} 金币`, 'claim-task', task.id, true, !m.busy && !task.claimed && task.progress >= task.target);
    }
  }
  p.button('刷新任务', 'refresh', undefined, false, !m.busy);
  p.paragraph('未领取奖励不跨日保留。');
}

function boot(p: Page): void {
  p.heading('锦鲤前程'); p.paragraph('结伴同行，让好运发生。');
  p.paragraph(isReady() ? '请阅读用户协议和隐私政策，确认后完成微信隐私授权。' : '正式开放准备中。可先查看协议说明，正式文本生效后即可授权进入。');
  p.button('查看隐私政策', 'privacy', undefined, false);
  p.button('查看用户协议', 'agreement', undefined, false);
  p.button('同意协议并授权进入', 'authorize', undefined, true, isReady() && !p.model.busy);
  p.button('退出', 'exit', undefined, false);
}

function legal(p: Page): void {
  const sections = p.model.screen === 'privacy' ? legalConfig.privacySections : legalConfig.agreementSections;
  p.paragraph(isReady() ? `${legalConfig.operatorName} · 生效日期 ${legalConfig.effectiveDate}` : '协议草案待运营方补齐主体、联系方式及生效信息。');
  if (!sections.length) p.paragraph('正式文本配置完成后，本页展示完整内容。');
  sections.forEach((section) => {p.heading(section.heading); p.paragraph(section.text);});
  p.button('返回', 'back', undefined, false);
}

const TITLES: Record<Screen, string> = {boot: '欢迎来到锦鲤前程', home: '探索景区', room: '好友房间', arena: '好运对战', result: '对局结算', shop: '装备商城', profile: '我的', income: '战绩与收益', tasks: '每日任务', privacy: '隐私政策', agreement: '用户协议'};

export function renderMenu(ctx: Canvas2DContext, viewport: Viewport, model: MenuModel): MenuFrame {
  ctx.fillStyle = DARK; ctx.fillRect(0, 0, viewport.designWidth, viewport.designHeight);
  const p = new Page(ctx, viewport, model);
  p.text(TITLES[model.screen], 40, viewport.safeTop + 40, 38, INK, true);
  if (!['boot', 'home', 'shop', 'income', 'profile'].includes(model.screen)) {
    const back = {x: 40, y: viewport.safeTop + 70, width: 190, height: 40};
    p.text('返回', 42, back.y + 20, 24, GOLD); p.hits.push({rect: back, action: {type: 'back'}});
  }
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, p.top); ctx.lineTo(720, p.top); ctx.lineTo(720, p.bottom); ctx.lineTo(0, p.bottom); ctx.closePath(); ctx.clip();
  if (model.error) {p.paragraph(model.error, 26, '#ffc5a7'); p.button('重试', 'refresh', undefined, false, !model.busy);}
  if (model.busy) p.label('正在处理，请稍候…', 25, GOLD);
  ({boot, home, room, result, shop, profile, income, tasks, privacy: legal, agreement: legal, arena: home})[model.screen](p);
  ctx.restore();
  if (model.screen === 'room' || (model.screen === 'result' && model.result)) {
    const y = viewport.designHeight - viewport.safeBottom - 96;
    ctx.fillStyle = DARK; ctx.fillRect(0, y - 12, 720, 116 + viewport.safeBottom);
    const footerButton = (label: string, rect: Rect, action: MenuAction, primary: boolean) => {
      fillRoundRect(ctx, rect, 14, primary && !model.busy ? GOLD : PANEL);
      p.text(label, rect.x + 24, rect.y + rect.height / 2, 29, primary && !model.busy ? '#30210e' : INK, true, rect.width - 48);
      if (!model.busy) p.hits.push({rect, action});
    };
    if (model.screen === 'room') {
      const self = model.online.room?.players.find((player) => player.self);
      const label = model.mode === 'local' ? '开始体验' : self?.host ? '开始对战' : self?.ready ? '取消准备' : '准备';
      footerButton('离开房间', {x: 40, y, width: 240, height: 88}, {type: 'leave-room'}, false);
      footerButton(label, {x: 300, y, width: 380, height: 88}, {type: model.mode === 'local' || self?.host ? 'start' : 'ready'}, true);
    } else {
      footerButton('返回探索', {x: 40, y, width: 308, height: 88}, {type: 'home'}, false);
      footerButton('再来一局', {x: 368, y, width: 312, height: 88}, {type: 'play-again'}, true);
    }
  }
  if (['home', 'shop', 'income', 'profile'].includes(model.screen)) {
    const y = viewport.designHeight - viewport.safeBottom - 96;
    ctx.fillStyle = PANEL; ctx.fillRect(0, y - 10, 720, 116 + viewport.safeBottom);
    [['home', '探索'], ['shop', '商城'], ['income', '战绩'], ['profile', '我的']].forEach(([screen, label], i) => {
      p.text(label, 44 + i * 180, y + 40, 29, model.screen === screen ? GOLD : MUTED, model.screen === screen);
      p.hits.push({rect: {x: i * 180, y, width: 180, height: 96}, action: {type: screen}});
    });
  }
  return {hits: p.hits, maxScroll: Math.max(0, p.y - (p.bottom - p.top)), contentTop: p.top, contentBottom: p.bottom};
}

export function menuActionAt(frame: MenuFrame, x: number, y: number): MenuAction | null {
  return frame.hits.find((hit) => hitTestRect(x, y, hit.rect))?.action || null;
}
