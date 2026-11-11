const test = require('node:test');
const assert = require('node:assert/strict');
const {buildOpportunity, getFortuneBagAsset} = require('../utils/investment');

test('福袋机会使用虚构题材并提供固定奖励', () => {
  const opportunity = buildOpportunity(300, () => 0.2);

  assert.equal(opportunity.category, '秘境');
  assert.equal(opportunity.bonus, 60);
  assert.equal(opportunity.asset, getFortuneBagAsset(opportunity.category));
  assert.match(opportunity.summary, /固定积分/);
  assert.equal('cost' in opportunity, false);
  assert.equal('riskLevel' in opportunity, false);
});

test('福袋奖励与玩家分数无关，不存在投入或随机盈亏参数', () => {
  const low = buildOpportunity(80, () => 0.8);
  const high = buildOpportunity(800, () => 0.8);

  assert.equal(low.bonus, 60);
  assert.equal(high.bonus, 60);
  assert.equal('cost' in low, false);
  assert.equal('riskLevel' in low, false);
});
