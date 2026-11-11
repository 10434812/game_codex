import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';
import {renderRunArena} from '../dist/render/run-arena-renderer.js';
import {createRunWorld} from '../dist/core/RunArena.js';
import {ARENA_DROP_ASSETS} from '../dist/render/arena-effects.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.scratch/drop-assets-v2');
fs.mkdirSync(output, {recursive: true});
GlobalFonts.registerFromPath('/Library/Fonts/Arial Unicode.ttf', 'sans-serif');
const images = Object.fromEntries(await Promise.all(Object.values(ARENA_DROP_ASSETS).map(async (asset) =>
  [asset, await loadImage(path.join(root, asset.slice(1)))])));
const canvas = createCanvas(900, 680), ctx = canvas.getContext('2d');
ctx.fillStyle = '#f6ebd1'; ctx.fillRect(0, 0, 900, 340);
ctx.textAlign = 'center'; ctx.fillStyle = '#51361e'; ctx.font = 'bold 30px sans-serif';
ctx.fillText('新掉落素材 · 透明 PNG', 450, 42);
for (const [i, asset] of Object.values(ARENA_DROP_ASSETS).entries()) {
  ctx.drawImage(images[asset], i * 300 + 50, 66, 200, 200);
  ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#51361e';
  ctx.fillText(['燃线雷 · −10', '红金福袋 · +10', '缎带礼盒 · +20'][i], i * 300 + 150, 304);
}
const backdrop = await loadImage(path.join(root, 'assets/stages/great-wall-bg.jpg'));
ctx.save(); ctx.beginPath(); ctx.rect(0, 340, 900, 340); ctx.clip();
ctx.drawImage(backdrop, 0, 340, 900, 340); ctx.fillStyle = '#071321c4'; ctx.fillRect(0, 340, 900, 340);
ctx.fillStyle = '#fff0cf'; ctx.font = 'bold 27px sans-serif';
ctx.fillText('对局中的掉落物 · 正式渲染器预览', 450, 392);
const world = createRunWorld([]); world.elapsedMs = 1000;
world.drops = ['bomb', 'bag', 'gift'].map((kind, i) => ({id: kind, kind, x: (150 + i * 300) / .9,
  y: 500, value: [-10, 10, 20][i], speed: 0, warningUntil: 0}));
renderRunArena(ctx, world, [], {x: 0, y: 60, width: 900, height: 1080}, {images});
ctx.textAlign = 'center'; ctx.fillStyle = '#fff0cf'; ctx.font = '24px sans-serif';
for (let i = 0; i < 3; i++) ctx.fillText(['躲开雷', '接福袋', '抢礼物'][i], i * 300 + 150, 603);
ctx.restore();
const target = path.join(output, 'drops-preview.png');
fs.writeFileSync(target, canvas.toBuffer('image/png'));
console.log(`掉落素材预览：${target}`);
