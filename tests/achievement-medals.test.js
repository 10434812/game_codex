const test = require('node:test');
const assert = require('node:assert/strict');

const {buildAchievement, buildAchievementMedal} = require('../utils/achievement-medals');

test('成就勋章会按景区生成对应视觉数据', () => {
  const medal = buildAchievementMedal({
    stageName: '万里长城',
    gain: 120,
    rank: 4,
  });

  assert.equal(buildAchievement({name: '万里长城'}), '长城守望者');
  assert.equal(medal.achievement, '长城守望者');
  assert.equal(medal.symbol, '城');
  assert.equal(medal.shortName, '长城');
  assert.equal(medal.tierLabel, '铜章');
  assert.match(medal.accent, /^#[0-9a-f]{6}$/i);
});

test('第一名或高收益会升级为金章', () => {
  assert.equal(buildAchievementMedal({stageName: '西湖夜游', rank: 1}).tierLabel, '金章');
  assert.equal(buildAchievementMedal({stageName: '鼓浪屿', gain: 320}).tierLabel, '金章');
  assert.equal(buildAchievement({name: '未知秘境'}), '未知秘境旅者');
});
