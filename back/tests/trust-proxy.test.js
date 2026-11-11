const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTrustProxy } = require('../src/config/trust-proxy');

test('TRUST_PROXY 未设置或空值时默认不信任代理', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(null), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('   '), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('0'), false);
});

test('TRUST_PROXY 支持跳数与布尔值', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('true'), true);
});

test('TRUST_PROXY 支持 Express 子网/预设字符串', () => {
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('10.0.0.0/8'), '10.0.0.0/8');
  assert.equal(parseTrustProxy(' 1 '), 1);
});

test('app.js 将信任策略写入 Express 且生产环境缺少配置时告警', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const config = fs.readFileSync(path.join(__dirname, '../src/config/index.js'), 'utf8');

  assert.match(app, /app\.set\('trust proxy', config\.trustProxy\)/);
  assert.match(app, /TRUST_PROXY 未配置/);
  assert.match(config, /trustProxy: parseTrustProxy\(process\.env\.TRUST_PROXY\)/);
});
