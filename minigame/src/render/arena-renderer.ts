/**
 * 战场渲染（Canvas 2D）。
 *
 * 坐标全部使用设计单位（宽 720，与小程序端棋盘坐标一致），
 * 由调用方通过 ctx.setTransform 一次性缩放到物理像素。
 * 玩家节点位置直接来自 BoardLayout.buildBoardPlayers，与小程序端同源。
 */

import {getNodeCenter, getLayoutForPlayerCount, type BoardPlayer, type FortuneBag, type Point} from '../core/BoardLayout';
import type {StageTheme} from '../core/Constants';
import type {TeamLink} from '../core/TeamLink';
import {ellipsize, fillRoundRect, type Canvas2DContext, type Rect} from './canvas-utils';

export const NODE_RADIUS = 46;
/** 命中判定半径：小于节点半径，避免相邻节点误触。 */
export const NODE_HIT_RADIUS = 34;

const LABEL_HEIGHT = 34;
const LABEL_MAX_WIDTH = 250;
const LABEL_GAP = 14;
const LABEL_EDGE_PADDING = 10;
const BUBBLE_HEIGHT = 42;
const BUBBLE_MAX_WIDTH = 176;
export const BAG_RADIUS = 42;

export interface PendingOpportunityView {
  name: string;
  bonus: number;
  summary: string;
}

export interface ArenaViewModel {
  theme: StageTheme;
  players: BoardPlayer[];
  links: TeamLink[];
  timeText: string;
  hintText: string;
  selfRankText: string;
  fortuneBag: FortuneBag | null;
  bagCountdown: string;
  /** 机缘福袋待确认面板；对应小程序端的「机缘卷」两步领取流程。 */
  pendingOpportunity: PendingOpportunityView | null;
  /** 顶部安全区下移量（设计单位） */
  offsetY: number;
  width: number;
  height: number;
}

export interface OpportunityPanelLayout {
  panel: Rect;
  confirm: Rect;
  close: Rect;
}

export function resolveOpportunityPanelLayout(
  width: number,
  height: number,
  offsetY: number
): OpportunityPanelLayout {
  const panelWidth = Math.min(560, width - 80);
  const panelHeight = 320;
  const panelX = (width - panelWidth) / 2;
  const panelY = offsetY + Math.min(220, height * 0.22);
  const buttonHeight = 76;
  const buttonWidth = (panelWidth - 72) / 2;
  const buttonY = panelY + panelHeight - buttonHeight - 24;
  return {
    panel: {x: panelX, y: panelY, width: panelWidth, height: panelHeight},
    close: {x: panelX + 24, y: buttonY, width: buttonWidth, height: buttonHeight},
    confirm: {x: panelX + panelWidth - buttonWidth - 24, y: buttonY, width: buttonWidth, height: buttonHeight},
  };
}

export function renderArena(ctx: Canvas2DContext, model: ArenaViewModel): void {
  const backdrop = ctx.createLinearGradient(0, 0, 0, model.height);
  backdrop.addColorStop(0, model.theme.deep);
  backdrop.addColorStop(1, model.theme.ink);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, model.width, model.height);

  renderBoardRing(ctx, model);
  renderLinks(ctx, model);
  renderFortuneBag(ctx, model);
  renderPlayers(ctx, model);
  renderOpportunityPanel(ctx, model);
  renderTimer(ctx, model);
}

function renderOpportunityPanel(ctx: Canvas2DContext, model: ArenaViewModel): void {
  const opportunity = model.pendingOpportunity;
  if (!opportunity) {
    return;
  }
  const layout = resolveOpportunityPanelLayout(model.width, model.height, model.offsetY);
  const {panel, confirm, close} = layout;
  ctx.save();
  ctx.fillStyle = model.theme.shadow;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, 0, model.width, model.height);
  ctx.globalAlpha = 1;

  fillRoundRect(ctx, panel, 28, model.theme.panelSolid);
  ctx.fillStyle = model.theme.primary;
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(opportunity.name, panel.x + panel.width / 2, panel.y + 56);

  ctx.fillStyle = model.theme.ink;
  ctx.font = '24px sans-serif';
  ctx.fillText(`固定积分加成 +${opportunity.bonus}`, panel.x + panel.width / 2, panel.y + 108);
  ctx.fillText(ellipsize(ctx, opportunity.summary, panel.width - 56), panel.x + panel.width / 2, panel.y + 148);

  fillRoundRect(ctx, close, 20, model.theme.chip);
  fillRoundRect(ctx, confirm, 20, model.theme.bright);
  ctx.fillStyle = model.theme.ink;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('稍后再说', close.x + close.width / 2, close.y + close.height / 2);
  ctx.fillText('领取福袋', confirm.x + confirm.width / 2, confirm.y + confirm.height / 2);
  ctx.restore();
}

function renderBoardRing(ctx: Canvas2DContext, model: ArenaViewModel): void {
  const layout = getLayoutForPlayerCount(model.players.length);
  const centerY = layout.centerY + model.offsetY;
  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.centerX, centerY, layout.radiusX, 0, Math.PI * 2);
  ctx.strokeStyle = model.theme.glow;
  ctx.lineWidth = 26;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(layout.centerX, centerY, layout.radiusX, 0, Math.PI * 2);
  ctx.strokeStyle = model.theme.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function renderLinks(ctx: Canvas2DContext, model: ArenaViewModel): void {
  ctx.save();
  ctx.lineCap = 'round';
  const selfId = model.players.find((player) => player.isSelf)?.id;
  model.links.forEach((link) => {
    const selfTeam = !!selfId && link.pairKey.split('::').includes(selfId);
    ctx.beginPath();
    ctx.moveTo(link.geometry.from.x, link.geometry.from.y + model.offsetY);
    ctx.lineTo(link.geometry.to.x, link.geometry.to.y + model.offsetY);
    ctx.strokeStyle = selfTeam ? model.theme.bright : model.theme.soft;
    ctx.lineWidth = selfTeam ? 8 : 5;
    ctx.globalAlpha = selfTeam ? 0.95 : 0.7;
    ctx.stroke();
  });
  ctx.restore();
}

function renderFortuneBag(ctx: Canvas2DContext, model: ArenaViewModel): void {
  const bag = model.fortuneBag;
  if (!bag) {
    return;
  }
  const centerY = bag.y + model.offsetY;
  ctx.save();
  ctx.beginPath();
  ctx.arc(bag.x, centerY, BAG_RADIUS + 18, 0, Math.PI * 2);
  ctx.fillStyle = model.theme.glow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(bag.x, centerY, BAG_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = model.theme.panelSolid;
  ctx.fill();
  ctx.strokeStyle = model.theme.bright;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = model.theme.primary;
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('福', bag.x, centerY);

  ctx.font = 'bold 26px sans-serif';
  ctx.fillStyle = model.theme.title;
  ctx.fillText(model.bagCountdown, bag.x, centerY + BAG_RADIUS + 28);
  ctx.restore();
}

function resolveLabelAnchor(namePos: string, center: Point, labelWidth: number): Point {
  switch (namePos) {
    case 'left':
      return {x: center.x - NODE_RADIUS - LABEL_GAP - labelWidth / 2, y: center.y};
    case 'right':
      return {x: center.x + NODE_RADIUS + LABEL_GAP + labelWidth / 2, y: center.y};
    case 'lower-left':
      return {x: center.x - NODE_RADIUS, y: center.y + NODE_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2};
    case 'lower-right':
      return {x: center.x + NODE_RADIUS, y: center.y + NODE_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2};
    default:
      return {x: center.x, y: center.y + NODE_RADIUS + LABEL_GAP + LABEL_HEIGHT / 2};
  }
}

function renderPlayers(ctx: Canvas2DContext, model: ArenaViewModel): void {
  ctx.textAlign = 'center';
  model.players.forEach((player) => {
    const center = getNodeCenter(player);
    const nodeY = center.y + model.offsetY;

    ctx.save();
    if (player.isSelf) {
      ctx.beginPath();
      ctx.arc(player.x, nodeY, NODE_RADIUS + 8, 0, Math.PI * 2);
      ctx.fillStyle = model.theme.glow;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(player.x, nodeY, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = model.theme.panelSolid;
    ctx.fill();
    ctx.strokeStyle = player.isSelf ? model.theme.bright : model.theme.border;
    ctx.lineWidth = player.isSelf ? 5 : 3;
    ctx.stroke();

    ctx.fillStyle = model.theme.deep;
    ctx.font = 'bold 30px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(player.isSelf ? '我' : player.name.slice(0, 1), player.x, nodeY);
    ctx.restore();

    const labelText = ellipsize(ctx, player.scoreLabel, LABEL_MAX_WIDTH - 24);
    ctx.font = '24px sans-serif';
    const labelWidth = Math.min(LABEL_MAX_WIDTH, ctx.measureText(labelText).width + 24);
    const anchor = resolveLabelAnchor(player.namePos, {x: player.x, y: nodeY}, labelWidth);
    // 边缘节点的名牌按 namePos 摆好后可能出画，这里统一夹回画布内。
    const labelX = Math.min(
      Math.max(anchor.x, labelWidth / 2 + LABEL_EDGE_PADDING),
      model.width - labelWidth / 2 - LABEL_EDGE_PADDING
    );
    fillRoundRect(
      ctx,
      {
        x: labelX - labelWidth / 2,
        y: anchor.y - LABEL_HEIGHT / 2,
        width: labelWidth,
        height: LABEL_HEIGHT,
      },
      LABEL_HEIGHT / 2,
      model.theme.panel
    );
    ctx.fillStyle = model.theme.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, labelX, anchor.y);

    if (player.emoteText) {
      const bubbleText = ellipsize(ctx, player.emoteText, BUBBLE_MAX_WIDTH - 24);
      const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, ctx.measureText(bubbleText).width + 24);
      const bubbleY = nodeY - NODE_RADIUS - LABEL_GAP - BUBBLE_HEIGHT;
      fillRoundRect(
        ctx,
        {x: player.x - bubbleWidth / 2, y: bubbleY, width: bubbleWidth, height: BUBBLE_HEIGHT},
        BUBBLE_HEIGHT / 2,
        model.theme.bright
      );
      ctx.fillStyle = model.theme.ink;
      ctx.fillText(bubbleText, player.x, bubbleY + BUBBLE_HEIGHT / 2);
    }
  });
}

function renderTimer(ctx: Canvas2DContext, model: ArenaViewModel): void {
  const panelWidth = 300;
  const panelHeight = 76;
  const panelX = model.width / 2 - panelWidth / 2;
  const panelY = model.offsetY - panelHeight - 8;

  fillRoundRect(ctx, {x: panelX, y: panelY, width: panelWidth, height: panelHeight}, panelHeight / 2, model.theme.panel);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = model.theme.primary;
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(model.timeText, model.width / 2, panelY + 28);

  const subText = model.selfRankText || model.hintText;
  if (subText) {
    ctx.fillStyle = model.theme.ink;
    ctx.font = '22px sans-serif';
    ctx.fillText(ellipsize(ctx, subText, panelWidth - 24), model.width / 2, panelY + 58);
  }
  ctx.restore();
}

/** 顶部信息条：仅在需要时单独绘制（例如未开局时的提示）。 */
export function renderBanner(ctx: Canvas2DContext, text: string, theme: StageTheme, width: number, offsetY: number): void {
  if (!text) {
    return;
  }
  const height = 60;
  ctx.save();
  ctx.fillStyle = theme.ink;
  ctx.globalAlpha = 0.72;
  ctx.fillRect(0, offsetY - height - 8, width, height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.title;
  ctx.font = '26px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ellipsize(ctx, text, width - 48), width / 2, offsetY - height / 2 - 8);
  ctx.restore();
}
