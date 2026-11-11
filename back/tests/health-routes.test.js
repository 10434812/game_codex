const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../src/models/db');
const routes = require('../src/routes');

test('存活检查保持可用，就绪检查反映数据库故障及恢复', async (t) => {
  let databaseAvailable = true;
  t.mock.method(db, 'execute', async (sql) => {
    assert.equal(sql, 'SELECT 1');
    if (!databaseAvailable) throw new Error('private database error');
    return [[{'1': 1}], []];
  });

  const app = express();
  app.use('/api', routes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api`;

  let response = await fetch(`${url}/ready`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'ready');

  databaseAvailable = false;
  response = await fetch(`${url}/ready`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.data.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(body), /private database error/);

  response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'healthy');

  databaseAvailable = true;
  response = await fetch(`${url}/ready`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'ready');
});
