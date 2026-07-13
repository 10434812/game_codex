const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const fortuneService = require('../src/services/fortune-reality-service');

const {
  buildHeuristicDigest,
  buildPublicOpportunities,
  parseCoinGeckoJson,
  parseSinaQuoteText,
  parseStooqCsv,
} = fortuneService.__private;

test('parseStooqCsv normalizes quote CSV into a fortune snapshot', () => {
  const snapshot = parseStooqCsv(
    'Symbol,Date,Time,Open,High,Low,Close,Volume\nSPY.US,2026-05-14,22:00:18,743.65,749.53,743.56,748.17,45307603\n',
    {
      id: 1,
      source_key: 'stock_spy',
      name: '标普500 ETF SPY',
      category: 'stock',
      parser_config: JSON.stringify({ currency: 'USD', unit: 'price', label: 'SPY 最新价' }),
    }
  );

  assert.equal(snapshot.sourceKey, 'stock_spy');
  assert.equal(snapshot.metricValue, 748.17);
  assert.equal(snapshot.trend, 'up');
  assert.equal(snapshot.currency, 'USD');
  assert.match(snapshot.summary, /SPY/);
});

test('parseCoinGeckoJson reads simple price payload with 24h change', () => {
  const snapshot = parseCoinGeckoJson(
    {
      bitcoin: {
        usd: 80771,
        usd_24h_change: 1.7018,
        last_updated_at: 1778821677,
      },
    },
    {
      id: 2,
      source_key: 'crypto_btc',
      name: 'Bitcoin BTC',
      category: 'crypto',
      parser_config: JSON.stringify({ coinId: 'bitcoin', vsCurrency: 'usd', currency: 'USD', label: 'BTC 最新价' }),
    }
  );

  assert.equal(snapshot.metricValue, 80771);
  assert.equal(snapshot.changePercent, 1.7018);
  assert.equal(snapshot.trend, 'up');
  assert.equal(snapshot.currency, 'USD');
});

test('parseSinaQuoteText reads China stock quote text into a fortune snapshot', () => {
  const snapshot = parseSinaQuoteText(
    'var hq_str_sh510300="沪深300ETF华泰柏瑞,4.845,4.869,4.871,4.882,4.840,4.871,4.872,959720086,4664422387.000,70500,4.871,255700,4.870,395100,4.869,156800,4.868,181500,4.867,1563109,4.872,624800,4.873,431100,4.874,771300,4.875,282600,4.876,2026-05-20,15:00:00,00,";',
    {
      id: 3,
      source_key: 'cn_stock_hs300',
      name: '沪深300 ETF 510300',
      category: 'stock',
      parser_config: JSON.stringify({ currency: 'CNY', unit: 'price', label: '沪深300 ETF 最新价' }),
    }
  );

  assert.equal(snapshot.sourceKey, 'cn_stock_hs300');
  assert.equal(snapshot.metricValue, 4.871);
  assert.equal(snapshot.trend, 'flat');
  assert.equal(snapshot.currency, 'CNY');
  assert.match(snapshot.summary, /沪深300 ETF 510300/);
});

test('buildPublicOpportunities maps reality categories into game fortune categories', () => {
  const opportunities = buildPublicOpportunities([
    {
      sourceKey: 'real_estate_vnq',
      category: 'real_estate',
      name: '美国房地产 ETF VNQ',
      metricLabel: 'VNQ 最新价',
      metricValue: 88.21,
      changePercent: -0.82,
      trend: 'down',
      summary: 'VNQ 回落',
      observedAt: '2026-05-15 09:00:00',
    },
  ]);

  assert.equal(opportunities[0].category, '房产');
  assert.equal(opportunities[0].riskLevel, 'low');
  assert.equal(opportunities[0].sourceKey, 'real_estate_vnq');
});

test('buildHeuristicDigest gives a usable fallback when AI key is not configured', () => {
  const report = buildHeuristicDigest([
    { name: 'Bitcoin BTC', trend: 'up', changePercent: 3.2 },
    { name: '标普500 ETF SPY', trend: 'down', changePercent: -0.4 },
  ]);

  assert.equal(report.modelProvider, 'local-rule');
  assert.equal(report.sourceCount, 2);
  assert.match(report.summary, /Bitcoin BTC/);
  assert.equal(report.sentiment, 'positive');
});

test('fortune reality SQL migration defines source, snapshot, and AI report tables', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/005_fortune_reality.sql'), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS fortune_sources/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fortune_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fortune_ai_reports/);
  assert.match(sql, /fortune\.ai_digest_enabled/);
  assert.match(sql, /ai\.api_key/);
  assert.match(sql, /sina_quote/);
  assert.match(sql, /沪深300 ETF 510300/);
  assert.match(sql, /万科A 000002/);
});
