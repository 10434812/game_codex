import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createCanvas, GlobalFonts, Image} from '@napi-rs/canvas';
import {renderMenu} from '../.scratch/smoke/render/menu-scenes.js';
import {DEFAULT_STAGE} from '../.scratch/smoke/core/Constants.js';
import * as game from '../.scratch/smoke/core/GameStore.js';
import * as shop from '../.scratch/smoke/core/ShopStore.js';

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
  result: game.getState().result, loggedIn: false, busy: false, error: '', scroll: 0, roomSize: 6, hasMoreHistory: false,
  onlineAvailable: true, quickMatchAvailable: true, resultGoal: null};
const retentionFixture = {date: '2026-11-14', level: 3, totalExp: 550, games: 6, wins: 1,
  checkin: {claimed: false, streak: 3, day: 4, reward: 35, calendar: [20,25,30,35,40,45,60].map((reward,index) => ({day:index+1,reward,current:index===3,claimed:index<3}))},
  milestones: [{id:'first_game',title:'初次接福',target:1,progress:1,reward:50,claimed:true}, {id:'ten_games',title:'十场同行',target:10,progress:6,reward:150,claimed:false}, {id:'first_win',title:'初登榜首',target:1,progress:1,reward:80,claimed:false}, {id:'thousand_exp',title:'千分成长',target:1000,progress:550,reward:300,claimed:false}]};
const output = '/tmp/jinli-minigame-pages'; mkdirSync(output, {recursive: true});
for (const height of [1280, 1560]) {
  const viewport = {designWidth: 720, designHeight: height, scale: 0.5, pixelRatio: 2, safeTop: 180, safeBottom: 60};
  const canvas = createCanvas(720, height), ctx = canvas.getContext('2d');
  for (const screen of ['boot', 'home', 'room', 'result', 'shop', 'income', 'profile', 'privacy', 'agreement', 'tasks']) {
    const current = {...model, screen, loggedIn: screen === 'tasks' || (screen === 'profile' && height === 1560), dailyTasks: {date: '2026-11-14', retention: retentionFixture, tasks: [{id: 'play1', title: '完成 1 局', target: 1, progress: 1, reward: 20, claimed: true}, {id: 'play3', title: '完成 3 局', target: 3, progress: 2, reward: 50, claimed: false}, {id: 'team1', title: '组队完成 1 局', target: 1, progress: 1, reward: 30, claimed: false}]}, result: screen === 'home' ? null : model.result, leaderboard: screen === 'tasks' ? [{id:1,rank:1,nickName:'验收玩家',level:3,totalExp:550},{id:2,rank:1,nickName:'同行旅人',level:3,totalExp:550}] : undefined};
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
  const matchingRoom = {id: 'fixture-match', code: '1234', stageId: 1, status: 'waiting', matching: true,
    sessionId: '', players: [{id: 'me', name: '验收玩家', ready: true, host: true, self: true}]};
  const matching = {...model, screen: 'room', mode: 'online', loggedIn: true, online: {...model.online, room: matchingRoom}};
  const matchFrame = renderMenu(ctx, viewport, matching);
  assert.ok(matchFrame.hits.some((hit) => hit.action.type === 'leave-room'));
  assert.equal(matchFrame.hits.some((hit) => ['start', 'ready'].includes(hit.action.type)), false);
  writeFileSync(`${output}/${height}-matching.png`, canvas.toBuffer('image/png'));
  const matchRanking = [...model.result.ranking.filter((player) => !player.isSelf).slice(0, 3), model.result.ranking.find((player) => player.isSelf)].map((player, index) => ({...player, rank: index + 1}));
  const resultFrame = renderMenu(ctx, viewport, {...matching, screen: 'result', result: {...model.result, ranking: matchRanking, matchmaking: true}});
  assert.ok(resultFrame.hits.some((hit) => hit.action.type === 'play-again'));
  writeFileSync(`${output}/${height}-matching-result.png`, canvas.toBuffer('image/png'));
  for (const ready of [false, true]) {
    const resultGoal = {id: 'ten_games', title: '十场同行', reward: 150, ready,
      text: ready ? '已完成「十场同行」，可领取 150 锦鲤币' : '再完成 1 局可领取 150 锦鲤币', actionLabel: ready ? '领取成长奖励' : '查看成长目标'};
    const current = {...matching, screen: 'result', result: model.result, resultGoal};
    const top = renderMenu(ctx, viewport, current);
    const bottom = renderMenu(ctx, viewport, {...current, scroll: top.maxScroll});
    assert.ok([...top.hits, ...bottom.hits].some(hit => hit.action.type === 'tasks'));
    writeFileSync(`${output}/${height}-result-goal-${ready ? 'ready' : 'next'}.png`, canvas.toBuffer('image/png'));
  }
  for (const [state, onlineAvailable, quickMatchAvailable] of [['quick', true, true], ['friend', true, false], ['unavailable', false, false]]) {
    const home = {...model, screen: 'home', result: null, onlineAvailable, quickMatchAvailable};
    const top = renderMenu(ctx, viewport, home);
    const bottom = renderMenu(ctx, viewport, {...home, scroll: top.maxScroll});
    const actions = [...top.hits, ...bottom.hits].map((hit) => hit.action.type);
    assert.equal(actions.includes('quick-match'), quickMatchAvailable, state);
    assert.equal(actions.includes('create-online'), onlineAvailable, state);
    assert.equal(actions.includes('retry-service'), !onlineAvailable, state);
    writeFileSync(`${output}/${height}-home-${state}.png`, canvas.toBuffer('image/png'));
  }
}
console.log(`页面渲染与可操作区域检查通过：${output}（测试数据）`);
