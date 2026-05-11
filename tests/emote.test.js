const test = require('node:test');
const assert = require('node:assert/strict');
const {randomPick, randomInt, chooseRemoteEmote, QUICK_EMOTES} = require('../utils/emote');

function createRandom(...values) {
  let index = 0;
  return () => {
    const value = values[index];
    index = Math.min(index + 1, values.length - 1);
    return value;
  };
}

test('randomInt 在指定范围内返回整数', () => {
  const result = randomInt(0, 5, createRandom(0.5));
  assert.equal(result, 3);
});

test('randomInt 使用 seeded random 产生可预期结果', () => {
  const random = createRandom(0, 0.99, 0.5);
  assert.equal(randomInt(0, 10, random), 0);
  assert.equal(randomInt(0, 10, random), 10);
  assert.equal(randomInt(0, 10, random), 5);
});

test('randomPick 返回数组中的某个元素', () => {
  const list = ['a', 'b', 'c'];
  const result = randomPick(list, createRandom(0));
  assert.equal(result, 'a');
});

test('randomPick 对空数组返回 null', () => {
  assert.equal(randomPick([]), null);
});

test('randomPick 对非数组返回 null', () => {
  assert.equal(randomPick(null), null);
  assert.equal(randomPick(undefined), null);
  assert.equal(randomPick('string'), null);
});

test('chooseRemoteEmote 没有非自己玩家时返回 null', () => {
  const players = [{id: 'self', isSelf: true}];
  assert.equal(chooseRemoteEmote(players), null);
});

test('chooseRemoteEmote 从非自己玩家中按 seeded random 选择目标和表情', () => {
  const players = [
    {id: 'self', isSelf: true},
    {id: 'p1', isSelf: false},
    {id: 'p2', isSelf: false},
  ];
  const random = createRandom(0, 0);
  const result = chooseRemoteEmote(players, QUICK_EMOTES, random);
  assert.equal(result.playerId, 'p1');
  assert.equal(result.text, QUICK_EMOTES[0].text);
});

test('chooseRemoteEmote 使用空数组表情时返回 null', () => {
  const players = [
    {id: 'self', isSelf: true},
    {id: 'p1', isSelf: false},
  ];
  assert.equal(chooseRemoteEmote(players, [], createRandom(0)), null);
});

test('chooseRemoteEmote 对空玩家数组返回 null', () => {
  assert.equal(chooseRemoteEmote([]), null);
});

test('chooseRemoteEmote 使用默认 Math.random 不抛错', () => {
  const players = [
    {id: 'self', isSelf: true},
    {id: 'p1', isSelf: false},
  ];
  const result = chooseRemoteEmote(players);
  assert.ok(result === null || (typeof result.playerId === 'string' && typeof result.text === 'string'));
});
