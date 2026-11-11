import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, Image} from '@napi-rs/canvas';
import {renderMenu} from '../dist/render/menu-scenes.js';
import {DEFAULT_STAGE} from '../dist/core/Constants.js';
import * as game from '../dist/core/GameStore.js';
import * as shop from '../dist/core/ShopStore.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceSetter = Object.getOwnPropertyDescriptor(Image.prototype, 'src').set;
const storage = new Map();
// 本地历史素材的文件名与线上已校正的封面不同，按实际画面提供离线测试素材。
const localCoverFixtures = {
  '/assets/stages/great-wall-bg.jpg': '/assets/stages/mount-fuji-bg.jpg',
  '/assets/stages/mount-fuji-bg.jpg': '/assets/stages/eiffel-bg.jpg',
  '/assets/stages/eiffel-bg.jpg': '/assets/stages/great-wall-bg.jpg',
};
globalThis.wx = {
  getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key),
  createImage() {
    const image = new Image();
    Object.defineProperty(image, 'src', {set(url) {
      const requested = new URL(url).pathname;
      const path = root + (localCoverFixtures[requested] || requested).slice(1);
      if (existsSync(path)) sourceSetter.call(image, readFileSync(path));
      else image.onerror?.(new Error('本地缺少该资源'));
    }});
    return image;
  },
};
const font = ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc'].find(existsSync);
if (font) GlobalFonts.registerFromPath(font, 'sans-serif');
game.createRoomFromStage(DEFAULT_STAGE, {roomSize: 6, random: () => 0.4});
game.startGame({autoStartTimer: false, random: () => 0.4});
for (let second = 0; second < 180; second++) game.tick({random: () => 0.4});
const model = {screen: 'home', stage: DEFAULT_STAGE, local: game.getState(), online: {room: null, sessionId: '', connection: '未连接', error: '', result: null}, mode: 'local',
  profile: {nickName: '验收玩家', avatarUrl: ''}, inventory: shop.getStoreState(), goods: shop.buildGoodsView('skin'), category: 'skin',
  summary: {totalIncome: 3240, totalExp: 1080, recordsCount: 1}, history: [{id: 'fixture', stageName: '万里长城', income: 3240, exp: 1080, createdAt: Date.now(), achievement: '第 1 名', modeText: '本地体验'}],
  result: game.getState().result, loggedIn: false, busy: false, error: '', scroll: 0, roomSize: 6, hasMoreHistory: false};
const output = '/tmp/jinli-minigame-pages'; mkdirSync(output, {recursive: true});
for (const height of [1280, 1560]) {
  const viewport = {designWidth: 720, designHeight: height, scale: 0.5, pixelRatio: 2, safeTop: 180, safeBottom: 60};
  const canvas = createCanvas(720, height), ctx = canvas.getContext('2d');
  for (const screen of ['boot', 'home', 'room', 'result', 'shop', 'income', 'profile', 'privacy', 'agreement', 'tasks']) {
    const current = {...model, screen, loggedIn: screen === 'tasks' || (screen === 'profile' && height === 1560), dailyTasks: {date: '2026-10-30', tasks: [{id: 'play1', title: '完成 1 局', target: 1, progress: 1, reward: 20, claimed: true}, {id: 'play3', title: '完成 3 局', target: 3, progress: 2, reward: 50, claimed: false}, {id: 'team1', title: '组队完成 1 局', target: 1, progress: 1, reward: 30, claimed: false}]}, result: screen === 'home' ? null : model.result};
    let frame = renderMenu(ctx, viewport, current);
    await new Promise((resolve) => setTimeout(resolve, 20));
    frame = renderMenu(ctx, viewport, current);
    assert.ok(frame.hits.length > 0, `${screen} 应有可操作入口`);
    frame.hits.forEach(({rect}) => {assert.ok(rect.y >= viewport.safeTop); assert.ok(rect.y + rect.height <= height - viewport.safeBottom + 1);});
    const buffer = canvas.toBuffer('image/png'); assert.ok(buffer.length > 10000);
    writeFileSync(`${output}/${height}-${screen}.png`, buffer);
    if (frame.maxScroll > 0) {
      const bottom = renderMenu(ctx, viewport, {...current, scroll: frame.maxScroll});
      assert.ok(bottom.hits.length > 0); writeFileSync(`${output}/${height}-${screen}-bottom.png`, canvas.toBuffer('image/png'));
    }
  }
}
console.log(`页面渲染与可操作区域检查通过：${output}（测试数据）`);
