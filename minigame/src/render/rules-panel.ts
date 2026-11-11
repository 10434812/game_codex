import type {Viewport} from '../platform/device';
import {fillRoundRect, type Canvas2DContext} from './canvas-utils';

export function rulesPanelLayout(viewport: Viewport) {
  const height = Math.min(650, viewport.designHeight - viewport.safeTop - viewport.safeBottom - 32);
  const y = viewport.safeTop + (viewport.designHeight - viewport.safeTop - viewport.safeBottom - height) / 2;
  return {panel: {x: 56, y, width: 608, height}, button: {x: 88, y: y + height - 88, width: 544, height: 64}, scale: height / 650};
}

export function renderRulesPanel(ctx: Canvas2DContext, viewport: Viewport, firstRun: boolean, busy: boolean, error = ''): void {
  const {panel, button, scale} = rulesPanelLayout(viewport);
  ctx.save();
  ctx.fillStyle = 'rgba(24, 17, 10, 0.88)'; ctx.fillRect(0, 0, 720, viewport.designHeight);
  fillRoundRect(ctx, panel, 24, '#fff8ea');
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#4a2f17';
  const line = (text: string, y: number, bold = false, size = 26) => {
    ctx.font = `${bold ? 'bold ' : ''}${size * scale}px sans-serif`;
    ctx.fillText(text, 88, panel.y + y * scale);
  };
  line('120 秒，争夺积分第一！', 54, true, 34);
  line('拖动跑动，松手停住，接福袋、躲雷。', 110);
  line('最终个人积分最高者获胜。', 148);
  line('追人组队', 206, true, 28);
  line('双方互相点选同意，碰面组队并闪爆。', 244);
  line('靠近队友双方加速，可随时退出。', 280);
  line('得失联动', 330, true, 28);
  line('本人获得全额，队友额外获得一半。', 368);
  line('踩雷本人扣 10 分，队友扣 5 分。', 404);
  line('掉落预警', 454, true, 28);
  line('福 +10、礼 +20、雷 −10，碰到即生效。', 492);
  ctx.fillStyle = '#745336';
  line(error || (firstRun ? '点击开始后计时，联机等待所有人确认。' : '本局继续计时，随时回到对局调整策略。'), 536, false, 23);
  fillRoundRect(ctx, button, 12, busy ? '#745336' : '#8a4f1c');
  ctx.fillStyle = '#fff8ea'; ctx.textAlign = 'center'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText(busy ? '正在开始…' : firstRun ? '开始' : '返回对局', 360, button.y + button.height / 2);
  ctx.restore();
}
