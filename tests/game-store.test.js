const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../utils/game-store');

function createRandom(...values) {
  let index = 0;
  return () => {
    const value = values[index];
    index = Math.min(index + 1, values.length - 1);
    return value;
  };
}

test('startGame 会把房间状态切到 playing 并生成队伍', () => {
  store.__resetForTests();
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});

  const state = store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  assert.equal(state.status, 'playing');
  assert.ok(state.teams.length >= 2);
  assert.equal(state.players.length >= 4, true);
});

test('tick 会在时间归零后产出 finished 结果', () => {
  store.__resetForTests();
  store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  store.startGame({
    random: createRandom(0.2, 0.2, 0.2, 0.2),
    autoStartTimer: false,
  });

  for (let index = 0; index < 180; index += 1) {
    store.tick({random: createRandom(0.2, 0.2, 0.2, 0.2)});
  }

  const state = store.getState();
  assert.equal(state.status, 'finished');
  assert.ok(state.result.top3.first);
  assert.ok(state.result.rest.length >= 1);
});

test('inviteHumanPlayer 会在房间阶段添加真人玩家', () => {
  store.__resetForTests();
  const first = store.createRoomFromStage({id: 1, code: '01', name: '万里长城'}, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  const next = store.inviteHumanPlayer({random: createRandom(0.1, 0.1, 0.1)});

  assert.equal(next.players.length, first.players.length + 1);
  const joined = next.players[next.players.length - 1];
  assert.equal(joined.isRobot, false);
  assert.equal(joined.isSelf, false);
});
