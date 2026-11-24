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
  assert.equal(old.elapsedMs, 12000); assert.equal(old.nextDropAt, 12000 + run.FIELD.firstDropDelayMs); assert.equal(old.runners[0].mateId, 'b');
  run.setRunInput(old, 'a', 1, 0); drop(old); const restored = run.restoreRunWorld(old, ps, [], 12000);
  assert.equal(restored.runners[0].dx, 0); assert.equal(restored.runners[0].inputUntil, 0); assert.equal(restored.drops.length, 1);
  const malformed = run.restoreRunWorld({...old, runners: []}, ps, [], 12000); assert.equal(malformed.runners.length, ps.length);
});

test('掉落按人数分为每轮1/2/3个，首轮2秒，间隔由2秒收紧到1.2秒，同屏不超过上限', () => {
  for (const engine of [run, server]) {
    for (const count of [4, 5, 7, 8, 10]) {
      let ps = Array.from({length: count}, (_, i) => ({id: String(i), name: String(i), score: 100, teamId: null}));
      let world = engine.createRunWorld(ps), lastSpawn = 0;
      const perWave = count <= 4 ? 1 : count <= 7 ? 2 : 3;
      for (let elapsed = 20; elapsed <= 120000; elapsed += 20) {
        const before = world.sequence;
        const next = engine.advanceRunArena(world, ps, 20, () => .5);
        world = next.world; ps = next.players;
        assert.ok(world.drops.length <= run.FIELD.maxDrops);
        if (world.sequence > before) {
          const spawned = world.sequence - before;
          assert.ok(spawned >= 1 && spawned <= perWave);
          const fresh = world.drops.slice(-spawned);
          assert.equal(new Set(fresh.map((d) => d.x)).size, spawned, '同轮掉落分散落点');
          if (lastSpawn) {
            assert.ok(elapsed - lastSpawn >= run.FIELD.minDropIntervalMs);
            assert.ok(elapsed - lastSpawn <= run.FIELD.dropIntervalMs + 20);
          } else assert.equal(elapsed, run.FIELD.firstDropDelayMs);
          lastSpawn = elapsed;
        }
        if (elapsed < run.FIELD.firstDropDelayMs) assert.equal(world.sequence, 0);
      }
      // 120 秒内至少 70 轮：比旧版 24 轮密三倍左右。
      assert.ok(world.sequence >= 70, `sequence=${world.sequence}`);
    }
  }
});

test('多人掉落在场地仅剩一个空位时不突破上限，预警期不结算碰撞', () => {
  const ps = Array.from({length: 10}, (_, i) => ({id: String(i), name: String(i), score: 100, teamId: null}));
  const world = run.createRunWorld(ps);
  world.elapsedMs = 3000; world.nextDropAt = 3000;
  world.drops = Array.from({length: run.FIELD.maxDrops - 1}, (_, i) => ({id: 'held-' + i, kind: 'gift', value: 20, x: 900, y: 10, speed: 0, warningUntil: 20000}));
  const next = run.advanceRunArena(world, ps, 20, () => .5);
  assert.equal(next.world.drops.length, run.FIELD.maxDrops);
  assert.equal(next.world.sequence, 1);
  assert.ok(next.world.drops.at(-1).warningUntil > next.world.elapsedMs);
  assert.deepEqual(next.players.map((p) => p.score), ps.map((p) => p.score));
});

test('场地满额和过期掉落时间均按新间隔继续推进', () => {
  const ps = players(), world = run.createRunWorld(ps);
  world.nextDropAt = 0; world.elapsedMs = 12000;
  world.drops = Array.from({length: run.FIELD.maxDrops}, (_, i) => ({id: 'held-' + i, kind: 'bag', value: 10,
    x: 900, y: 10, speed: 1, warningUntil: 20000}));
  let next = run.advanceRunArena(world, ps, 1000, () => .5);
  assert.equal(next.world.sequence, 0);
  assert.equal(next.world.drops.length, run.FIELD.maxDrops);
  const due = next.world.nextDropAt;
  // 规则按 20ms 子帧推进：满场时在第一个子帧就按当前进度排定下一轮。
  assert.equal(due, 12020 + run.dropIntervalAt(12020));
  next.world.drops = [];
  next = run.advanceRunArena(next.world, next.players, due - 13000 - 20, () => .5);
  assert.equal(next.world.sequence, 0);
  next = run.advanceRunArena(next.world, next.players, 20, () => .5);
  assert.equal(next.world.sequence, 1);
  assert.equal(next.world.nextDropAt, due + run.dropIntervalAt(due));
});

test('连击在窗口内逐级加分并封顶，踩雷或超时清零', () => {
  for (const engine of [run, server]) {
    let {ps, world} = setup(); const scores = [];
    for (let i = 0; i < 8; i++) {
      drop(world, 'bag', 10); const next = engine.advanceRunArena(world, ps, 20);
      scores.push(next.players[0].score - ps[0].score); world = next.world; ps = next.players;
    }
    assert.deepEqual(scores, [10, 12, 14, 16, 18, 20, 20, 20]);
    assert.equal(world.effects.at(-1).combo, 8);
    drop(world, 'bomb', -10); let next = engine.advanceRunArena(world, ps, 20); assert.equal(next.world.runners[0].combo, 0);
    drop(next.world, 'bag', 10); const after = engine.advanceRunArena(next.world, next.players, 20);
    assert.equal(after.players[0].score - next.players[0].score, 10);
    after.world.elapsedMs += engine.FIELD.comboWindowMs + 1; drop(after.world, 'bag', 10);
    next = engine.advanceRunArena(after.world, after.players, 20); assert.equal(next.players[0].score - after.players[0].score, 10);
  }
});
test('最后 15 秒正向得分翻倍，雷保持 -10，联动按翻倍后的一半', () => {
  for (const engine of [run, server]) {
    const {ps, world} = setup(); world.elapsedMs = engine.FIELD.durationMs - engine.FIELD.sprintMs;
    world.runners[0].mateId = 'b'; world.runners[1].mateId = 'a'; drop(world, 'gift', 20);
    let next = engine.advanceRunArena(world, ps, 20);
    assert.equal(next.players[0].score, 140); assert.equal(next.players[1].score, 120); assert.equal(next.events[0].sprint, true);
    drop(next.world, 'bomb', -10); const hit = engine.advanceRunArena(next.world, next.players, 20);
    assert.equal(hit.players[0].score, 130); assert.equal(hit.events[0].sprint, undefined);
    assert.equal(engine.isSprint(engine.FIELD.durationMs - engine.FIELD.sprintMs - 1), false);
  }
});
test('护盾抵消一次踩雷且不记入统计，磁铁把范围内的好运吸向持有者而不吸雷', () => {
  for (const engine of [run, server]) {
    let {ps, world} = setup(); drop(world, 'shield', 0);
    let next = engine.advanceRunArena(world, ps, 20); assert.equal(next.world.runners[0].shield, true); assert.equal(next.players[0].score, 100);
    drop(next.world, 'bomb', -10); let blocked = engine.advanceRunArena(next.world, next.players, 20);
    assert.equal(blocked.players[0].score, 100); assert.equal(blocked.world.runners[0].shield, false);
    assert.equal(blocked.events[0].blocked, true); assert.equal(engine.runPerformanceMap(blocked.world).a.bombs, 0);
    drop(blocked.world, 'bomb', -10); assert.equal(engine.advanceRunArena(blocked.world, blocked.players, 20).players[0].score, 90);

    ({ps, world} = setup()); drop(world, 'magnet', 0); next = engine.advanceRunArena(world, ps, 20);
    const r = next.world.runners[0]; assert.equal(r.magnetUntil, next.world.elapsedMs + engine.FIELD.magnetMs);
    next.world.drops.push({id: 'far', kind: 'gift', value: 20, x: r.x + 150, y: r.y, speed: 0, warningUntil: 0},
      {id: 'mine', kind: 'bomb', value: -10, x: r.x - 150, y: r.y, speed: 0, warningUntil: 0},
      {id: 'out', kind: 'bag', value: 10, x: r.x, y: r.y + engine.FIELD.magnetRange + 200, speed: 0, warningUntil: 0});
    const pulled = engine.advanceRunArena(next.world, next.players, 100).world.drops;
    assert.ok(pulled.find((d) => d.id === 'far').x < r.x + 150);
    assert.equal(pulled.find((d) => d.id === 'mine').x, r.x - 150);
    assert.equal(pulled.find((d) => d.id === 'out').x, r.x);
    next.world.elapsedMs = r.magnetUntil; next.world.drops = next.world.drops.filter((d) => d.id === 'far');
    assert.equal(engine.advanceRunArena(next.world, next.players, 100).world.drops[0].x, r.x + 150);
  }
});
test('旧存档恢复补齐连击与道具字段，掉落种类比例含少量道具', () => {
  const ps = players(), world = run.createRunWorld(ps);
  const legacy = {...world, runners: world.runners.map(({combo, comboUntil, shield, magnetUntil, ...r}) => r)};
  const restored = run.restoreRunWorld(legacy, ps, [], 5000);
  assert.deepEqual([restored.runners[0].combo, restored.runners[0].shield, restored.runners[0].magnetUntil], [0, false, 0]);
  const kinds = {}; let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let w = run.createRunWorld(ps), p = ps;
  for (let t = 0; t < 120000; t += 20) {const before = w.sequence; const n = run.advanceRunArena(w, p, 20, random); w = n.world; p = n.players;
    if (w.sequence > before) for (const d of w.drops.slice(before - w.sequence)) kinds[d.kind] = (kinds[d.kind] || 0) + 1;}
  const total = Object.values(kinds).reduce((a, b) => a + b, 0);
  assert.ok(kinds.bag + kinds.gift > total * .55); assert.ok(kinds.bomb < total * .32);
  assert.ok((kinds.shield || 0) + (kinds.magnet || 0) >= 2 && (kinds.shield || 0) + (kinds.magnet || 0) < total * .2);
});
