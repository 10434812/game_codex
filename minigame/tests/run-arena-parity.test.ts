import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as run from '../src/core/RunArena';
import {makeRandom} from './seeded-random';
const require = createRequire(import.meta.url);
const js = require('../../utils/run-arena.js') as typeof run;
const backend = require('../../back/src/game-engine/run-arena.js') as typeof run;
test('三端实时对局在相同输入和随机源下运行 120 秒完全一致', () => {
  const source = [{id: 'a', name: '我', score: 100, teamId: null}, {id: 'b', name: '队友', score: 100, teamId: null}, {id: 'c', name: '机器人', score: 100, teamId: null, isRobot: true}];
  const modules = [run, js, backend], rngs = modules.map(() => makeRandom(326));
  let states = modules.map((m) => ({world: m.createRunWorld(source), players: source}));
  for (let t = 0; t < 120000; t += 50) {
    states = states.map((s, i) => {
      modules[i].setRunInput(s.world, 'a', Math.sin(t / 3000), Math.cos(t / 3000));
      modules[i].setRunInput(s.world, 'b', -.5, .3);
      if (t === 300) {modules[i].selectRunTarget(s.world, 'a', 'b'); modules[i].selectRunTarget(s.world, 'b', 'a');}
      if (t === 15000) modules[i].selectRunTarget(s.world, 'a', null);
      return modules[i].advanceRunArena(s.world, s.players, 50, rngs[i]);
    });
    assert.deepEqual(states[0], states[1]); assert.deepEqual(states[0], states[2]);
  }
});

test('三端多人场同轮分散掉落保持一致', () => {
  for (const count of [4, 5, 7, 8, 10]) {
    const players = Array.from({length: count}, (_, i) => ({id: String(i), name: String(i), score: 100, teamId: null}));
    const results = [run, js, backend].map((m) => {
      const world = m.createRunWorld(players); world.elapsedMs = 2990;
      return m.advanceRunArena(world, players, 50, makeRandom(701));
    });
    assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]);
    assert.equal(results[0].world.drops.length, count <= 4 ? 1 : count <= 7 ? 2 : 3);
  }
});
