// 对真实碰撞产物调用正式渲染器，导出两种背景的近景与逐帧动画。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';
import {createRunWorld, advanceRunArena} from '../dist/core/RunArena.js';
import {renderRunArena} from '../dist/render/run-arena-renderer.js';
import {ARENA_EFFECT_ASSETS} from '../dist/render/arena-effects.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.scratch/vfx-v2-preview');
fs.mkdirSync(path.join(output, 'frames'), {recursive: true});
GlobalFonts.registerFromPath('/Library/Fonts/Arial Unicode.ttf', 'sans-serif');
const images = Object.fromEntries(await Promise.all(Object.values(ARENA_EFFECT_ASSETS).map(async (asset) =>
  [asset, await loadImage(path.join(root, asset.slice(1)))])));
images.avatar = await loadImage(path.join(root, 'assets/bg/avatars/avatar_01.png'));
const backdrop = await loadImage(path.join(root, 'assets/stages/great-wall-bg.jpg'));
const fixtures = ['bomb', 'gift'].map((kind) => {
  const players = [{id: 'self', name: '自己', score: 100, teamId: null, isSelf: true, avatar: 'avatar'}];
  const world = createRunWorld(players), runner = world.runners[0];
  runner.x = 500; runner.y = 600; world.nextDropAt = 100000;
  world.drops.push({id: kind, kind, value: kind === 'bomb' ? -10 : 20,
    x: runner.x, y: runner.y, warningUntil: 0, speed: 0});
  return {kind, before: {world, players}, after: advanceRunArena(world, players, 20)};
});

function panel(ctx, fixture, x, y, age, light) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, 450, 430); ctx.clip();
  if (light) {ctx.fillStyle = '#f6ebd1'; ctx.fillRect(x, y, 450, 430);}
  else {
    const scale = Math.max(450 / backdrop.width, 430 / backdrop.height);
    ctx.drawImage(backdrop, x + (450 - backdrop.width * scale) / 2, y + (430 - backdrop.height * scale) / 2,
      backdrop.width * scale, backdrop.height * scale);
    ctx.fillStyle = '#071321b8'; ctx.fillRect(x, y, 450, 430);
  }
  const state = age < 0 ? fixture.before : fixture.after;
  const world = {...state.world, elapsedMs: age < 0 ? 0 : fixture.after.world.elapsedMs + age};
  renderRunArena(ctx, world, state.players, {x: x + 225 - 300, y: y + 248 - 360, width: 600, height: 720}, {images});
  ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.fillStyle = light ? '#51361e' : '#fff0cf';
  ctx.font = 'bold 27px sans-serif';
  ctx.fillText(fixture.kind === 'bomb' ? '踩雷 · 火光炸开，烟雾消散' : '礼物 · 金色星芒，流光上扬', x + 225, y + 43);
  ctx.font = '18px sans-serif'; ctx.fillStyle = light ? '#745336' : '#ebd2a9';
  ctx.fillText(`${light ? '浅色' : '景区暗色'}背景 · 正式渲染器近景`, x + 225, y + 76);
  ctx.fillText(fixture.kind === 'bomb' ? '800 ms · 独立扣分提示' : '1000 ms · 独立加分提示', x + 225, y + 399);
  ctx.restore();
}

const contact = createCanvas(900, 860), contactCtx = contact.getContext('2d');
for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
  panel(contactCtx, fixtures[column], column * 450, row * 430, 270, row === 1);
}
fs.writeFileSync(path.join(output, 'arena-effects-v2.png'), contact.toBuffer('image/png'));
for (let frame = 0; frame < 54; frame++) {
  const canvas = createCanvas(900, 430), ctx = canvas.getContext('2d');
  for (let column = 0; column < 2; column++) panel(ctx, fixtures[column], column * 450, 0, frame * 1000 / 30 - 200, false);
  fs.writeFileSync(path.join(output, 'frames', `${String(frame).padStart(3, '0')}.png`), canvas.toBuffer('image/png'));
}
console.log(`特效近景和动画帧已导出：${output}`);
