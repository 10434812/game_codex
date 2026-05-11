const test = require('node:test');
const assert = require('node:assert/strict');
const {getLevelRequirement, buildExpProgress} = require('../utils/progression');

test('getLevelRequirement 第 1 级需要 120 经验', () => {
  assert.equal(getLevelRequirement(1), 120);
});

test('getLevelRequirement 第 2 级需要 160 经验', () => {
  assert.equal(getLevelRequirement(2), 160);
});

test('getLevelRequirement 每升一级增加 40 经验', () => {
  assert.equal(getLevelRequirement(3), 200);
  assert.equal(getLevelRequirement(10), 480);
});

test('getLevelRequirement 对非法值返回 1 级需求', () => {
  assert.equal(getLevelRequirement(0), 120);
  assert.equal(getLevelRequirement(null), 120);
  assert.equal(getLevelRequirement(undefined), 120);
  assert.equal(getLevelRequirement('abc'), 120);
});

test('buildExpProgress 0 经验对应 1 级', () => {
  const result = buildExpProgress(0);
  assert.equal(result.level, 1);
  assert.equal(result.current, 0);
  assert.equal(result.required, 120);
  assert.equal(result.left, 120);
  assert.equal(result.percent, 0);
});

test('buildExpProgress 120 经验升级到 2 级', () => {
  const result = buildExpProgress(120);
  assert.equal(result.level, 2);
  assert.equal(result.current, 0);
  assert.equal(result.required, 160);
  assert.equal(result.left, 160);
  assert.equal(result.percent, 0);
});

test('buildExpProgress 部分经验正确计算进度', () => {
  const result = buildExpProgress(150);
  assert.equal(result.level, 2);
  assert.equal(result.current, 30);
  assert.equal(result.left, 130);
  assert.equal(result.percent, 18);
});

test('buildExpProgress 跨多级升级正确计算', () => {
  const result = buildExpProgress(120 + 160 + 100);
  assert.equal(result.level, 3);
  assert.equal(result.current, 100);
  assert.equal(result.required, 200);
  assert.equal(result.left, 100);
  assert.equal(result.percent, 50);
});

test('buildExpProgress 对负数返回 0 经验', () => {
  const result = buildExpProgress(-50);
  assert.equal(result.level, 1);
  assert.equal(result.current, 0);
});

test('buildExpProgress 对非法值返回 0 经验', () => {
  const result = buildExpProgress('abc');
  assert.equal(result.level, 1);
  assert.equal(result.current, 0);
});

test('buildExpProgress 百分比不超过 100', () => {
  const result = buildExpProgress(119);
  assert.ok(result.percent < 100);
});
