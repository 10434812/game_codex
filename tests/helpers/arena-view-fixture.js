const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const run = require('../../utils/run-arena');
const pagePath = path.resolve(__dirname, '../../pages/arena/index.js');

function applyViewPatch(data, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    for (const part of parts.slice(0, -1)) target = target[part];
    target[parts.at(-1)] = value;
  }
}
function loadArenaPage(sourcePath = pagePath) {
  global.wx ||= {getStorageSync() {}, setStorageSync() {}};
  let definition;
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    require: createRequire(pagePath), Page: (page) => {definition = page;},
    wx: global.wx, setTimeout, clearTimeout, setInterval, clearInterval,
  }, {filename: pagePath});
  const page = {...definition, data: JSON.parse(JSON.stringify(definition.data)), patches: [],
    setData(patch, callback) {this.patches.push(patch); applyViewPatch(this.data, patch); callback?.();}};
  page.appearance = {skinImage: 'https://example.test/skin.png', ringImage: 'https://example.test/ring.png',
    petImage: 'https://example.test/pet.png', petLabel: '锦鲤', images: {}, emotes: {}};
  page.fieldRect = {x: 37, y: 45, width: 338, height: 312};
  return page;
}
function makeArenaFrames(count = 240) {
  let seed = 71;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let players = Array.from({length: 10}, (_, i) => ({id: 'p' + i, name: '锦鲤玩家' + i, score: 100, teamId: null,
    isSelf: i === 0, isRobot: i > 0, avatar: 'https://example.test/avatar-' + i + '.png'}));
  let world = run.createRunWorld(players);
  const frames = [];
  for (let i = 0; i < count; i++) {
    run.setRunInput(world, 'p0', i % 100 < 50 ? 1 : -1, .2);
    if (i === 20) {run.selectRunTarget(world, 'p0', 'p1'); run.selectRunTarget(world, 'p1', 'p0');}
    const next = run.advanceRunArena(world, players, 50, random);
    world = next.world; players = next.players;
    frames.push({players, runWorld: world});
  }
  return frames;
}
module.exports = {loadArenaPage, makeArenaFrames, applyViewPatch};

// 只供规则与视图单测连接内存引擎；正式页面入口只接受服务端 sessionId。
function attachRuleSimulation(page) {
  const store = require('../../utils/game-store');
  const shop = require('../../utils/shop-store');
  page.onShow = function () {
    this.active = true;
    this.generation = (this.generation || 0) + 1;
    this.direction = {dx: 0, dy: 0};
    this.appearance = {...shop.getEquippedDisplay(), images: {}, emotes: {}};
    this.unsubscribe = store.subscribe((state) => this.acceptState(state));
    this.acceptState(store.getState());
    if (this.data.rulesFirstRun) store.pauseGame(); else store.resumeGame();
  };
  return page;
}
module.exports.attachRuleSimulation = attachRuleSimulation;
