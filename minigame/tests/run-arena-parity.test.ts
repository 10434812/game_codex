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
