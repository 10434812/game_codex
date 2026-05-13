const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../src/game-engine/game-engine');

function createRandom(...values) {
  let index = 0;
  return () => {
    const value = values[index];
    index = Math.min(index + 1, values.length - 1);
    return value;
  };
}

test('applyRoundEvents applies linked teammate score changes without throwing', () => {
  const players = engine.createInitialPlayers({count: 4, random: createRandom(0.1, 0.1, 0.1, 0.1)});
  const paired = engine.pairPlayers(players, {random: createRandom(0.2, 0.2, 0.2, 0.2)});
  const actorId = paired.players[0].id;
  const teammateId = paired.players[1].id;

  const result = engine.applyRoundEvents(
    paired.players,
    paired.teams,
    [{actorId, delta: 60}],
  );

  const actor = result.find((player) => player.id === actorId);
  const teammate = result.find((player) => player.id === teammateId);

  assert.equal(actor.score - paired.players[0].score, 60);
  assert.equal(teammate.score - paired.players[1].score, 30);
});
