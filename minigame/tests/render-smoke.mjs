import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, loadImage} from '@napi-rs/canvas';
import * as store from '../.scratch/smoke/core/GameStore.js';
import {ArenaScene} from '../.scratch/smoke/scenes/arena-scene.js';
import {createRunWorld, advanceRunArena, selectRunTarget} from '../.scratch/smoke/core/RunArena.js';
import {renderRunArena, runFieldRect} from '../.scratch/smoke/render/run-arena-renderer.js';
import {ARENA_EFFECT_ASSETS, ARENA_DROP_ASSETS} from '../.scratch/smoke/render/arena-effects.js';
const effectImages = Object.fromEntries(await Promise.all(Object.values(ARENA_EFFECT_ASSETS).map(async (asset) => {
  const image = await loadImage(fileURLToPath(new URL('..' + asset, import.meta.url)));
  assert.equal(image.width / image.height, 2);
  const probe = createCanvas(image.width, image.height), context = probe.getContext('2d');
  context.drawImage(image, 0, 0);
  assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0, '图集边角必须透明');
  return [asset, image];
})));
for (const asset of Object.values(ARENA_DROP_ASSETS).filter(Boolean)) {
  const image = await loadImage(fileURLToPath(new URL('..' + asset, import.meta.url)));
  assert.equal(image.width, 256); assert.equal(image.height, 256);
  const probe = createCanvas(256, 256), context = probe.getContext('2d'); context.drawImage(image, 0, 0);
  assert.equal(context.getImageData(0, 0, 1, 1).data[3], 0, '道具边角必须透明');
  effectImages[asset] = image;
}
const output = '/tmp/jinli-running-arena'; mkdirSync(output, {recursive: true});
for (const font of ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc']) {
  if (existsSync(font)) {GlobalFonts.registerFromPath(font, 'sans-serif'); break;}
}
let seed = 32; const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
store.__resetForTests(); store.createRoomFromStage({id: 1}, {roomSize: 8, random}); store.startGame({autoStartTimer: false, random});
for (let i = 0; i < 70; i++) {store.setRunDirection(i % 20 < 10 ? .8 : -.8, .15); store.advanceRunFrame(100, {random});}
for (const height of [1280, 1600]) {
  const canvas = createCanvas(720, height), ctx = canvas.getContext('2d'), scene = new ArenaScene({source: store, width: 720, height, offsetY: 70}); scene.start();
  scene.render(ctx); writeFileSync(`${output}/arena-${height}.png`, canvas.toBuffer('image/png')); scene.dispose();
}
const ps = store.getState().players.map((p) => ({...p, isRobot: false})), world = createRunWorld(ps);
world.runners[1].x = world.runners[0].x + 65; selectRunTarget(world, ps[0].id, ps[1].id); selectRunTarget(world, ps[1].id, ps[0].id);
const next = advanceRunArena(world, ps, 20, random); assert.equal(next.teams.length, 1);
next.world.drops.push({id: 'bomb', kind: 'bomb', value: -10, x: 680, y: 700, warningUntil: 0, speed: 240}, {id: 'bag', kind: 'bag', value: 10, x: 440, y: 350, warningUntil: 0, speed: 240}, {id: 'gift', kind: 'gift', value: 20, x: 250, y: 70, warningUntil: 0, speed: 240});
const canvas = createCanvas(720, 1280), ctx = canvas.getContext('2d'); ctx.fillStyle = '#f6ebd1'; ctx.fillRect(0, 0, 720, 1280);
renderRunArena(ctx, next.world, next.players, runFieldRect(720, 1280, 160), {images: effectImages}); writeFileSync(`${output}/team-burst.png`, canvas.toBuffer('image/png'));
for (let i = 0; i < 113; i++) store.tick({random}); assert.equal(store.getState().status, 'finished');
assert.equal(store.getState().result.ranking.length, 8); store.__resetForTests();
console.log(`跑动对局渲染与 120 秒结算通过：${output}`);

// 用真实碰撞产物检查四人出生点及爆炸、两种拾取反馈。
const previewPlayers = ['自己', '机器人甲', '机器人乙', '机器人丙'].map((name, i) => ({id: String(i), name, score: 100, teamId: null, isSelf: i === 0}));
const preview = createCanvas(1440, 1280), previewCtx = preview.getContext('2d');
for (const [i, kind] of ['spawn', 'bomb', 'bag', 'gift'].entries()) {
  let world = createRunWorld(previewPlayers), players = previewPlayers;
  if (kind !== 'spawn') {
    const r = world.runners[0];
    world.drops.push({id: kind, kind, value: kind === 'bomb' ? -10 : kind === 'bag' ? 10 : 20, x: r.x, y: r.y, warningUntil: 0, speed: 0});
    const next = advanceRunArena(world, players, 20, random);
    assert.equal(next.events[0].kind, kind); assert.equal(next.world.drops.length, 0);
    world = next.world; players = next.players; world.elapsedMs += 220;
  }
  const x = i % 2 * 720, y = Math.floor(i / 2) * 640;
  previewCtx.fillStyle = '#f6ebd1'; previewCtx.fillRect(x, y, 720, 640);
  previewCtx.fillStyle = '#51361e'; previewCtx.textAlign = 'center'; previewCtx.font = 'bold 30px sans-serif';
  previewCtx.fillText(['四人分散开局 · 120 秒', '碰雷 · 爆炸与扣分', '接福袋 · 光圈与加分', '接礼物 · 光圈与加分'][i], x + 360, y + 48);
  renderRunArena(previewCtx, world, players, {x: x + 24, y: y + 80, width: 672, height: 530}, {images: effectImages});
}
writeFileSync(`${output}/feedback-preview.png`, preview.toBuffer('image/png'));
