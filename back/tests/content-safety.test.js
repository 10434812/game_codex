const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

function load(file, dependencies, extra = {}) {
  const filename = path.join(__dirname, '../src/services', file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, URL, URLSearchParams, Date, setTimeout, clearTimeout,
    __dirname: path.dirname(filename),
    require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), ...extra,
  }, { filename });
  return module.exports;
}

function safetyClient(results, settings = { appId: 'wx-app', secret: 'secret-private' }) {
  const requests = [];
  const https = { request(url, options, callback) {
    const request = new EventEmitter();
    request.destroy = (error) => { request.emit('error', error); request.emit('close'); };
    request.end = (body) => {
      requests.push({ url, options, body: body ? JSON.parse(body) : null });
      const value = results.shift();
      if (value === 'timeout') return;
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        callback(response);
        response.emit('data', JSON.stringify(value));
        response.emit('end');
        request.emit('close');
      });
    };
    return request;
  } };
  const client = load('content-safety-service.js', {
    https, './admin-config-service': { getWechatLoginSettings: async () => settings },
  }, { setTimeout: (fn) => setTimeout(fn, 5), process: { env: {} } });
  return { client, requests };
}
const token = () => ({ access_token: 'access-private', expires_in: 7200 });

test('text moderation uses real WeChat v2 fields and only explicit pass succeeds', async () => {
  for (const suggest of ['pass', 'review', 'risky', undefined]) {
    const { client, requests } = safetyClient([token(), { errcode: 0, result: { suggest } }]);
    if (suggest === 'pass') await client.checkText('锦鲤', 'openid-real');
    else await assert.rejects(client.checkText('锦鲤', 'openid-real'), { statusCode: 400 });
    assert.match(requests[1].url, /\/wxa\/msg_sec_check\?/);
    assert.equal(requests[1].body.version, 2);
    assert.equal(requests[1].body.scene, 1);
    assert.equal(requests[1].body.openid, 'openid-real');
  }
});

test('missing credentials, malformed results, provider errors and timeouts fail closed without sensitive errors', async () => {
  const cases = [
    safetyClient([], { appId: 'wx-app', secret: '' }),
    safetyClient([token(), {}]),
    safetyClient([token(), { errcode: 40001, errmsg: 'access-private secret-private' }]),
    safetyClient(['timeout']),
  ];
  for (const { client } of cases) {
    await assert.rejects(client.checkText('锦鲤', 'openid-real'), (error) => {
      assert.equal(error.statusCode, 503);
      assert.doesNotMatch(error.message, /access-private|secret-private/);
      return true;
    });
  }
});

test('image API acceptance yields only a trace id, never a passed verdict', async () => {
  const { client, requests } = safetyClient([token(), { errcode: 0, trace_id: 'trace-1' }]);
  assert.equal(await client.checkImage('https://example.com/private-token', 'openid-real'), 'trace-1');
  assert.match(requests[1].url, /\/wxa\/media_check_async\?/);
  assert.equal(requests[1].body.media_type, 2);
  await assert.rejects(safetyClient([token(), { errcode: 0 }]).client.checkImage('https://example.com/x', 'openid-real'), { statusCode: 503 });
});

test('encrypted callbacks require valid signature, padding and bound AppID', async () => {
  const key = crypto.randomBytes(32);
  const env = { WX_CONTENT_SAFETY_TOKEN: 'callback-token', WX_CONTENT_SAFETY_AES_KEY: key.toString('base64').slice(0, -1), WX_CONTENT_SAFETY_BASE_URL: 'https://example.com' };
  const client = load('content-safety-service.js', { './admin-config-service': { getWechatLoginSettings: async () => ({ appId: 'wx-app' }) } }, { process: { env } });
  function fixture(appid) {
    const text = Buffer.from(JSON.stringify({ Event: 'wxa_media_check' }));
    const header = Buffer.alloc(20);
    header.writeUInt32BE(text.length, 16);
    const plain = Buffer.concat([header, text, Buffer.from(appid)]);
    const padding = 32 - plain.length % 32;
    const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64');
    const query = { timestamp: String(Math.floor(Date.now() / 1000)), nonce: 'nonce' };
    query.msg_signature = crypto.createHash('sha1').update([env.WX_CONTENT_SAFETY_TOKEN, query.timestamp, query.nonce, encrypted].sort().join('')).digest('hex');
    return { encrypted, query };
  }
  const valid = fixture('wx-app');
  assert.equal(JSON.parse(await client.decodeCallback(valid.query, valid.encrypted)).Event, 'wxa_media_check');
  await assert.rejects(client.decodeCallback({ ...valid.query, msg_signature: 'forged' }, valid.encrypted));
  const wrongApp = fixture('other-app');
  await assert.rejects(client.decodeCallback(wrongApp.query, wrongApp.encrypted));
});

test('WeChat URL verification accepts a signed plaintext echo and rejects forged signatures', () => {
  const key = crypto.randomBytes(32);
  const env = { WX_CONTENT_SAFETY_TOKEN: 'handshake-token', WX_CONTENT_SAFETY_AES_KEY: key.toString('base64').slice(0, -1), WX_CONTENT_SAFETY_BASE_URL: 'https://example.com' };
  const client = load('content-safety-service.js', { './admin-config-service': {} }, { process: { env } });
  const query = { timestamp: String(Math.floor(Date.now() / 1000)), nonce: '1514711492', echostr: '4375120948345356249' };
  query.signature = crypto.createHash('sha1').update([env.WX_CONTENT_SAFETY_TOKEN, query.timestamp, query.nonce].sort().join('')).digest('hex');
  assert.equal(client.verifyChallenge(query), query.echostr);
  assert.throws(() => client.verifyChallenge({ ...query, signature: 'forged' }));
});

test('profile service cannot bypass avatar review and does not persist rejected nicknames', async () => {
  const writes = [];
  let rejectText = true;
  const service = load('user-service.js', {
    '../models/db': {
      queryOne: async () => ({ openid: 'openid-real', id: 1, nick_name: '旧昵称' }),
      execute: async (...args) => { writes.push(args); return [{ affectedRows: 1 }]; },
    },
    './game-service': {},
    './content-safety-service': { checkText: async () => { if (rejectText) throw Object.assign(new Error('拒绝'), { statusCode: 400 }); } },
  });
  await assert.rejects(service.updateProfile(1, { avatarUrl: 'https://arbitrary.example/x.png' }), { statusCode: 400 });
  await assert.rejects(service.updateProfile(1, { nickName: '未审核' }), { statusCode: 400 });
  await assert.rejects(service.updateProfile(1, { nickName: '' }), { statusCode: 400 });
  await assert.rejects(service.updateProfile(1, { nickName: 'x'.repeat(33) }), { statusCode: 400 });
  assert.equal(writes.length, 0);
  rejectText = false;
  await service.updateProfile(1, { nickName: '  新昵称  ' });
  assert.equal(writes[0][1][0], '新昵称');
});
