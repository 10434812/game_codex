/**
 * Canvas 2D 绘制基础件。
 *
 * 这里声明的是「本项目用到的」2D 上下文子集，而不是完整 DOM 类型：
 * 小游戏没有 DOM lib，而微信 Canvas 与 Node 侧的无头 Canvas 都满足这个结构。
 */

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface ImageLike {
  width: number;
  height: number;
}

export interface Canvas2DContext {
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string | CanvasGradientLike;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): {width: number};
  drawImage(image: ImageLike, x: number, y: number, width: number, height: number): void;
  drawImage(image: ImageLike, sourceX: number, sourceY: number, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pathRoundRect(ctx: Canvas2DContext, rect: Rect, radius: number): void {
  const limit = Math.min(radius, rect.width / 2, rect.height / 2);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  ctx.beginPath();
  ctx.moveTo(rect.x + limit, rect.y);
  ctx.lineTo(right - limit, rect.y);
  ctx.quadraticCurveTo(right, rect.y, right, rect.y + limit);
  ctx.lineTo(right, bottom - limit);
  ctx.quadraticCurveTo(right, bottom, right - limit, bottom);
  ctx.lineTo(rect.x + limit, bottom);
  ctx.quadraticCurveTo(rect.x, bottom, rect.x, bottom - limit);
  ctx.lineTo(rect.x, rect.y + limit);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + limit, rect.y);
  ctx.closePath();
}

export function fillRoundRect(ctx: Canvas2DContext, rect: Rect, radius: number, fill: string): void {
  ctx.fillStyle = fill;
  pathRoundRect(ctx, rect, radius);
  ctx.fill();
}

/** 命中判定半径：玩家节点与福袋都用节点半径的一半，避免误触。 */
export function hitTestCircle(
  pointerX: number,
  pointerY: number,
  centerX: number,
  centerY: number,
  radius: number
): boolean {
  const dx = pointerX - centerX;
  const dy = pointerY - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

export function hitTestRect(pointerX: number, pointerY: number, rect: Rect): boolean {
  return (
    pointerX >= rect.x &&
    pointerX <= rect.x + rect.width &&
    pointerY >= rect.y &&
    pointerY <= rect.y + rect.height
  );
}

export function ellipsize(ctx: Canvas2DContext, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  const characters = Array.from(text);
  while (characters.length > 1) {
    characters.pop();
    const candidate = `${characters.join('')}…`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      return candidate;
    }
  }
  return '…';
}
