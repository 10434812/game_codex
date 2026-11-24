const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function service(db = {}) {
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/analytics-service'), 'utf8'), {
    module, Buffer, Date, require: (name) => name === '../models/db' ? db : require(name),
  });
  return module.exports;
}
const batch = () => ({client: 'miniprogram', deviceId: 'wx_test_device', events: [{name: 'game_start', ts: Date.now(), props: {sessionId: '7'}}]});
test('analytics validates all batch entries before insertion and rejects invalid boundaries', () => {
  const analytics = service();
  for (const body of [null, {...batch(), client: 'web'}, {...batch(), deviceId: 'x'}, {...batch(), events: []}, {...batch(), events: Array(51).fill(batch().events[0])}, {...batch(), events: [{name: 'BAD', ts: 1}]}, {...batch(), events: [{name: 'app_launch', ts: '1'}]}]) {
    assert.throws(() => analytics.normalizeBatch(body), {statusCode: 400});
  }
});
test('analytics clamps client time, drops oversized props and uses deterministic retry keys', () => {
  const analytics = service(), body = batch(); body.events[0].ts = 1;
  body.events[0].props = {message: '字'.repeat(500)};
  const row = analytics.normalizeBatch(body, 1e12)[0];
  assert.equal(row[4], null); assert.equal(row[5], 1e12 - 7 * 86400000);
  assert.equal(row[0], analytics.normalizeBatch(body, 1e12 + 1000)[0][0]);
  body.events[0].ts = Number.MAX_SAFE_INTEGER;
  assert.equal(analytics.normalizeBatch(body, 1e12)[0][5], 1e12 + 60000);
});
test('analytics batches parameterized inserts, deduplicates retries and leaves received_at to MySQL', async () => {
  let sql, values;
  const analytics = service({execute: async (query, params) => {sql = query; values = params;}});
  const body = batch(); body.events.push({...body.events[0], name: 'game_finish'});
  const result = await analytics.recordBatch(body, 7);
  assert.equal(result.accepted, 2); assert.equal(values.length, 14); assert.equal(values[1], 7);
  assert.match(sql, /ON DUPLICATE KEY/); assert.equal(sql.includes('received_at'), false); assert.equal(sql.includes('game_start'), false);
});
test('analytics endpoint accepts anonymous and expired tokens, attributes valid users, limits abuse', async (t) => {
  const express = require('express'), jwt = require('jsonwebtoken');
  const secret = 'analytics-test-secret-at-least-32-chars';
  const recorded = [], analytics = service();
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/events'), 'utf8'), {
    module, require(name) {
      if (name === 'express') return express;
      if (name === 'jsonwebtoken') return jwt;
      if (name === '../config') return {jwt: {secret}};
      if (name === '../middleware/auth') return {assertActiveUser: async () => {}};
      if (name === '../middleware/traffic-guard') return require('../src/middleware/traffic-guard');
      if (name === '../utils/response') return {success: (data) => ({code: 0, data})};
      if (name === '../services/analytics-service') return {...analytics, recordBatch: async (body, userId) => {recorded.push(userId); return {accepted: body.events.length};}};
      throw new Error(name);
    },
  });
  const app = express(); app.use(express.json(), module.exports); app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({code: err.statusCode || 500}));
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.on('listening', resolve));
  t.after(() => {server.closeAllConnections(); server.close();});
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function post(token, body = batch()) {return fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify(body)});}
  assert.equal((await post()).status, 200);
  assert.equal((await post(jwt.sign({userId: 7}, secret, {expiresIn: -1}))).status, 200);
  assert.equal((await post(jwt.sign({userId: 7}, secret))).status, 200);
  assert.deepEqual(recorded, [null, null, 7]);
  assert.equal((await post('', {...batch(), events: Array(51).fill(batch().events[0])})).status, 400);
  let status = 0; for (let i = 0; i < 31; i++) status = (await post()).status;
  assert.equal(status, 429);
});
