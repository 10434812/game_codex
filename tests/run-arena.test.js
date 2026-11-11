const test = require('node:test');
const assert = require('node:assert/strict');
const run = require('../utils/run-arena');
const server = require('../back/src/game-engine/run-arena');
function players() {return ['a', 'b', 'c'].map((id) => ({id, name: id, score: 100, teamId: null}));}
function setup() {const ps = players(), world = run.createRunWorld(ps); world.nextDropAt = 100000; return {ps, world};}
function drop(world, kind = 'bag', value = 10) {const r = world.runners[0]; world.drops.push({id: 'one', kind, value, x: r.x, y: r.y - 1, warningUntil: 0, speed: 1});}
test('开局默认四人含三名机器人，显式人数可调整，出生点分散覆盖场地', () => {
  const engine = require('../utils/game-engine');
  for (const random of [() => .1, () => .5, () => .9]) {
    const room = engine.createRoomState(null, {random});
    assert.equal(room.players.length, 4);
    assert.equal(room.players.filter((p) => p.isRobot).length, 3);
  }
  for (const count of [4, 6, 8, 10]) {
    const ps = engine.createRoomState(null, {roomSize: count}).players;
    assert.equal(ps.length, count);
    for (const impl of [run, server]) {
      const rs = impl.createRunWorld(ps).runners;
      assert.ok(Math.max(...rs.map((r) => r.y)) - Math.min(...rs.map((r) => r.y)) >= 450);
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        assert.ok(Math.hypot(rs[i].x - rs[j].x, rs[i].y - rs[j].y) >= 220);
      }
    }
  }
});
test('方向归一化、边界约束、松手与输入过期均停止移动', () => {
  let {ps, world} = setup(); run.setRunInput(world, 'a', 10000, 10000);
  let next = run.advanceRunArena(world, ps, 100); assert.ok(next.world.runners[0].x > world.runners[0].x);
  assert.ok(Math.hypot(next.world.runners[0].dx, next.world.runners[0].dy) <= 1.0001);
  run.setRunInput(next.world, 'a', 0, 0); const x = next.world.runners[0].x;
  next = run.advanceRunArena(next.world, next.players, 100); assert.equal(next.world.runners[0].x, x);
  run.setRunInput(next.world, 'a', 1, 0); next = run.advanceRunArena(next.world, next.players, 1000);
  const endX = next.world.runners[0].x; next = run.advanceRunArena(next.world, next.players, 1000); assert.equal(next.world.runners[0].x, endX);
  assert.equal(run.setRunInput(world, 'a', NaN, 0), false); assert.equal(run.setRunInput(world, 'a', '1', 0), false);
});
test('双方同意且接触才成队，单方选中、远距离同意均保持独立', () => {
  const {ps, world} = setup(); run.selectRunTarget(world, 'a', 'b');
  assert.equal(run.advanceRunArena(world, ps, 20).teams.length, 0);
  run.selectRunTarget(world, 'b', 'a'); assert.equal(run.advanceRunArena(world, ps, 20).teams.length, 0);
  world.runners[1].x = world.runners[0].x + 60;
  const next = run.advanceRunArena(world, ps, 20); assert.equal(next.teams.length, 1); assert.equal(next.events[0].type, 'team');
  assert.equal(run.selectRunTarget(next.world, 'c', 'b'), false);
  run.selectRunTarget(next.world, 'b', null); assert.equal(run.runTeams(next.world).length, 0); assert.equal(next.world.runners[0].mateId, '');
});
test('福袋 +10/+5、礼物 +20/+10、雷 -10/-5，仅拾取一次，联动逐事件执行', () => {
  for (const [kind, value] of [['bag', 10], ['gift', 20], ['bomb', -10]]) {
    const {ps, world} = setup(); world.runners[0].mateId = 'b'; world.runners[1].mateId = 'a'; drop(world, kind, value);
    const next = run.advanceRunArena(world, ps, 20); assert.equal(next.players[0].score, 100 + value); assert.equal(next.players[1].score, 100 + value / 2);
    assert.equal(next.players[2].score, 100); assert.equal(next.world.drops.length, 0);
    const repeated = run.advanceRunArena(next.world, next.players, 20); assert.deepEqual(repeated.players, next.players);
  }
});
test('独立拾取保持独立，退出后奖励与雷各自结算', () => {
  const {ps, world} = setup(); drop(world, 'bomb', -10);
  const next = run.advanceRunArena(world, ps, 20); assert.equal(next.players[0].score, 90); assert.equal(next.players[1].score, 100);
  assert.equal(next.teams.length, 0);
});
test('预警期间保持安全，出界消失，近队友加速、分开恢复原速', () => {
  const {ps, world} = setup(); drop(world, 'bomb', -10); world.drops[0].warningUntil = 700;
  assert.equal(run.advanceRunArena(world, ps, 500).players[0].score, 100);
  world.drops[0].y = 1300; world.drops[0].warningUntil = 0; assert.equal(run.advanceRunArena(world, ps, 20).world.drops.length, 0);
  world.drops = []; world.runners[0].mateId = 'b'; world.runners[1].mateId = 'a'; world.runners[1].x = world.runners[0].x + 100;
  run.setRunInput(world, 'a', 1, 0); let next = run.advanceRunArena(world, ps, 100);
  assert.ok(Math.abs(next.world.runners[0].x - world.runners[0].x - run.FIELD.speed * run.FIELD.boost * .1) < .001);
  world.runners[1].x = 900; next = run.advanceRunArena(world, ps, 100); assert.equal(next.world.runners[0].boosted, false);
});
test('服务端与小程序规则推进完全一致，源状态保持完整', () => {
  const {ps, world} = setup(); const original = JSON.stringify(world); run.setRunInput(world, 'a', 1, 0);
  const before = JSON.stringify(world), a = run.advanceRunArena(world, ps, 1000, () => .5), b = server.advanceRunArena(world, ps, 1000, () => .5);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(world), before); assert.notEqual(before, original);
});
test('旧棋盘存档迁移为可跑动场地，新存档恢复时方向归零并保留掉落物', () => {
  const ps = players(), old = run.restoreRunWorld(null, ps, [{id: 'old', memberIds: ['a', 'b']}], 12000);
  assert.equal(old.elapsedMs, 12000); assert.equal(old.nextDropAt, 15000); assert.equal(old.runners[0].mateId, 'b');
  run.setRunInput(old, 'a', 1, 0); drop(old); const restored = run.restoreRunWorld(old, ps, [], 12000);
  assert.equal(restored.runners[0].dx, 0); assert.equal(restored.runners[0].inputUntil, 0); assert.equal(restored.drops.length, 1);
  const malformed = run.restoreRunWorld({...old, runners: []}, ps, [], 12000); assert.equal(malformed.runners.length, ps.length);
});

test('组队主场开局留三秒，掉落间隔五秒，全局120秒最多24个、同屏最多10个', () => {
  for (const engine of [run, server]) {
    let ps = players(), world = engine.createRunWorld(ps), lastSpawn = 0;
    for (let elapsed = 20; elapsed <= 120000; elapsed += 20) {
      const before = world.sequence;
      const next = engine.advanceRunArena(world, ps, 20, () => .5);
      world = next.world; ps = next.players;
      assert.ok(world.drops.length <= 10);
      if (world.sequence > before) {
        if (lastSpawn) assert.ok(elapsed - lastSpawn >= 5000);
        else assert.equal(elapsed, 3000);
        lastSpawn = elapsed;
      }
      if (elapsed < 3000) assert.equal(world.sequence, 0);
    }
    assert.equal(world.sequence, 24);
  }
});

test('场地满额和过期掉落时间均按新间隔继续推进', () => {
  const ps = players(), world = run.createRunWorld(ps);
  world.nextDropAt = 0; world.elapsedMs = 12000;
  world.drops = Array.from({length: 10}, (_, i) => ({id: 'held-' + i, kind: 'bag', value: 10,
    x: 900, y: 10, speed: 1, warningUntil: 20000}));
  let next = run.advanceRunArena(world, ps, 1000, () => .5);
  assert.equal(next.world.sequence, 0);
  assert.equal(next.world.drops.length, 10);
  next.world.drops = [];
  for (let i = 0; i < 4; i++) next = run.advanceRunArena(next.world, next.players, 1000, () => .5);
  assert.equal(next.world.sequence, 0);
  next = run.advanceRunArena(next.world, next.players, 20, () => .5);
  assert.equal(next.world.sequence, 1);
  assert.equal(next.world.nextDropAt, 22020);
});
