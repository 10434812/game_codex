const test = require('node:test');
const assert = require('node:assert/strict');

const {buildBoardPlayers} = require('../utils/board-layout');

function makePlayers(count) {
  return Array.from({length: count}, (_, index) => ({
    id: `player-${index + 1}`,
    name: `玩家${index + 1}`,
    score: 100 + index,
    isSelf: index === 0,
  }));
}

test('多人棋盘使用更舒展的椭圆站位', () => {
  const players = buildBoardPlayers(makePlayers(10));
  const xs = players.map((player) => player.x);
  const ys = players.map((player) => player.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);

  assert.ok(ySpan > xSpan + 70);
  assert.ok(ySpan >= 620);
  assert.ok(Math.max(...ys) <= 730);
  assert.ok(Math.min(...xs) >= 98);
  assert.ok(Math.max(...xs) <= 622);
});

test('多人棋盘下半圈玩家标签会向下外扩避让', () => {
  const players = buildBoardPlayers(makePlayers(10));
  const lowerPlayers = players.filter((player) => player.y > 380);

  assert.ok(lowerPlayers.length >= 5);
  assert.ok(
    lowerPlayers.every((player) => {
      if (player.x < 288) {
        return player.namePos === 'lower-left';
      }
      if (player.x > 432) {
        return player.namePos === 'lower-right';
      }
      return player.namePos === 'lower-center';
    })
  );
});
