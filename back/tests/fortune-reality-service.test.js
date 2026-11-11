const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const fortuneService = require('../src/services/fortune-reality-service');

const {
  buildHeuristicDigest,
  buildPublicOpportunities,
  generateSimulatedSnapshot,
  fetchSourceSnapshot,
} = fortuneService.__private;

test('buildPublicOpportunities maps reality categories into fictional game fortune categories', () => {
  const opportunities = buildPublicOpportunities([
    {
      sourceKey: 'wonder_moon_spring',
      category: 'real_estate',
      name: '月下灵泉',
      metricLabel: '月下灵泉 福缘值',
      metricValue: 88.21,
      changePercent: -0.82,
      trend: 'down',
      summary: '月下灵泉 福缘值回落',
      observedAt: '2026-05-15 09:00:00',
    },
  ]);

  assert.equal(opportunities[0].category, '奇遇');
  assert.equal(opportunities[0].riskLevel, 'low');
  assert.equal(opportunities[0].sourceKey, 'wonder_moon_spring');
});

test('buildHeuristicDigest gives a usable fallback when AI key is not configured', () => {
  const report = buildHeuristicDigest([
    { name: '神秘古井', trend: 'up', changePercent: 3.2 },
    { name: '祥云福地', trend: 'down', changePercent: -0.4 },
  ]);

  assert.equal(report.modelProvider, 'local-rule');
  assert.equal(report.sourceCount, 2);
  assert.match(report.summary, /神秘古井/);
  assert.equal(report.sentiment, 'positive');
});

test('fortune reality SQL migration defines source, snapshot, and AI report tables', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/005_fortune_reality.sql'), 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS fortune_sources/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fortune_snapshots/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS fortune_ai_reports/);
  assert.match(sql, /fortune\.ai_digest_enabled/);
  assert.match(sql, /ai\.api_key/);
  assert.match(sql, /simulated/);
  assert.match(sql, /神秘古井/);
  assert.match(sql, /金鳞洞天/);
});

test('generateSimulatedSnapshot produces internal fictional data without external calls', () => {
  const snapshot = generateSimulatedSnapshot({
    id: 7,
    source_key: 'myth_ancient_well',
    name: '神秘古井',
    category: 'crypto',
    parser_config: JSON.stringify({ baseValue: 108, volatility: 0.05, currency: '福缘', unit: 'point', label: '神秘古井 福缘值' }),
  });

  assert.equal(snapshot.sourceKey, 'myth_ancient_well');
  assert.equal(snapshot.category, 'crypto');
  assert.equal(snapshot.currency, '福缘');
  assert.ok(Number.isFinite(snapshot.metricValue));
  assert.ok(Number.isFinite(snapshot.changePercent));
  assert.ok(snapshot.metricValue > 90 && snapshot.metricValue < 126, 'metric value stays near baseValue');
  assert.ok(Math.abs(snapshot.changePercent) <= 5.1, 'change stays within volatility');
  assert.match(snapshot.summary, /神秘古井/);
  assert.equal(snapshot.rawJson.simulated, true);
});

test('source execution rejects every legacy provider before any network access', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('unexpected network call');
  });
  const dns = require('node:dns');
  const lookupMock = t.mock.method(dns.promises, 'lookup', async () => {
    throw new Error('unexpected DNS lookup');
  });
  for (const provider of ['coingecko', 'sina_quote', 'stooq', 'json', 'csv', 'rss', 'manual', undefined, '']) {
    await assert.rejects(
      fetchSourceSnapshot({ provider, endpoint_url: 'https://example.com/finance' }),
      /仅允许 simulated/
    );
  }
  const snapshot = await fetchSourceSnapshot({
    id: 7, provider: 'simulated', source_key: 'myth_ancient_well', name: '神秘古井', category: 'crypto',
  });
  assert.equal(snapshot.rawJson.simulated, true);
  assert.match(snapshot.summary, /模拟.*纯娱乐/);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(lookupMock.mock.callCount(), 0);
});

test('snapshot consumers exclude historical external data and unmarked legacy snapshots', async (t) => {
  const db = require('../src/models/db');
  t.mock.method(db, 'execute', async () => [{}]);
  const queries = [];
  t.mock.method(db, 'queryAll', async (sql) => {
    queries.push(sql);
    return [];
  });
  await fortuneService.listSnapshots({ category: 'crypto' });
  await fortuneService.getLatestSnapshots();
  for (const sql of queries) {
    assert.match(sql, /provider = 'simulated'/);
    assert.match(sql, /JSON_EXTRACT\(.+raw_json, '\$\.simulated'\) = true/);
  }
});

test('digest persists a distinct entertainment report type and retains the local fallback', async (t) => {
  const db = require('../src/models/db');
  const configService = require('../src/services/admin-config-service');
  let insertedParams;
  t.mock.method(db, 'execute', async (sql, params) => {
    if (sql.includes('INSERT INTO fortune_ai_reports')) insertedParams = params;
    return [{ insertId: 1 }];
  });
  t.mock.method(db, 'queryAll', async () => []);
  t.mock.method(db, 'queryOne', async () => null);
  t.mock.method(configService, 'getConfig', async () => false);
  await fortuneService.generateDigestReport();
  assert.equal(insertedParams.length, 9);
  assert.equal(insertedParams[0], 'entertainment_digest');
  assert.equal(insertedParams[4], 'local-rule');
  const reportQueries = [];
  t.mock.method(db, 'queryOne', async (sql) => {
    reportQueries.push(sql);
    return null;
  });
  await fortuneService.getLatestReport();
  assert.match(reportQueries[0], /report_type = 'entertainment_digest'/);
});

test('public feed is disabled by default and does not read historical reports', async (t) => {
  const db = require('../src/models/db');
  const configService = require('../src/services/admin-config-service');
  const queryMock = t.mock.method(db, 'queryAll', async () => {
    throw new Error('disabled feed must not read snapshots');
  });
  t.mock.method(configService, 'getConfig', async () => undefined);
  assert.deepEqual(await fortuneService.getLatestPublicFeed(), { enabled: false, opportunities: [], report: null });
  assert.equal(queryMock.mock.callCount(), 0);
});

test('entertainment migration disables old sources without deleting their audit history', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/010_simulated_fortune_only.sql'), 'utf8');
  assert.match(sql, /WHERE provider <> 'simulated'/);
  assert.match(sql, /SET is_active = 0/);
  assert.match(sql, /endpoint_url = ''/);
  assert.match(sql, /SET config_value = 'false'/);
  assert.match(sql, /entertainment_digest/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE/);
});
