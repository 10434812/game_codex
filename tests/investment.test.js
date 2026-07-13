const test = require('node:test');
const assert = require('node:assert/strict');
const {buildOpportunityFromReality} = require('../utils/investment');

test('buildOpportunityFromReality turns crypto feed into a game bitcoin fortune bag', () => {
  const opportunity = buildOpportunityFromReality(300, {
    sourceKey: 'crypto_btc',
    realityCategory: 'crypto',
    name: 'Bitcoin BTC',
    metricLabel: 'BTC 最新价',
    metricValue: 80771,
    changePercent: 4.2,
    summary: 'BTC 上行',
    observedAt: '2026-05-15 09:00:00',
  }, () => 0.2);

  assert.equal(opportunity.category, '比特币');
  assert.equal(opportunity.name, 'Bitcoin BTC');
  assert.equal(opportunity.riskLevel, 'high');
  assert.equal(opportunity.realitySynced, true);
  assert.equal(opportunity.realitySource.sourceKey, 'crypto_btc');
});

test('buildOpportunityFromReality keeps local fallback when no reality item exists', () => {
  const opportunity = buildOpportunityFromReality(600, null, () => 0);

  assert.equal(opportunity.realitySynced, undefined);
  assert.ok(['股票', '房产', '比特币'].includes(opportunity.category));
});
