const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');

test('冷启动配置失败后，下次调用立即重试并恢复联机能力', async (t) => {
  t.mock.method(console, 'warn', () => {});
  delete require.cache[require.resolve('../utils/runtime-config')];
  const config = require('../utils/runtime-config');
  let requests = 0;
  t.mock.method(api, 'get', async () => {
    if (++requests === 1) throw new Error('network unavailable');
    return {configs: {}, features: {api: {onlineArena: true}}};
  });
  await config.fetchRemoteConfig();
  assert.equal(config.isApiSupported('onlineArena'), false);
  await config.fetchRemoteConfig();
  assert.equal(requests, 2);
  assert.equal(config.isApiSupported('onlineArena'), true);
  await config.fetchRemoteConfig();
  assert.equal(requests, 2, '成功后仍应复用60秒缓存');
});

test('过期配置刷新失败保留已知能力，但不延长失败缓存', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  delete require.cache[require.resolve('../utils/runtime-config')];
  const config = require('../utils/runtime-config');
  let requests = 0;
  t.mock.method(api, 'get', async () => {
    requests++;
    if (requests === 2) throw new Error('temporary outage');
    return {configs: {'wechat.share_title': String(requests)}, features: {api: {onlineArena: true}}};
  });
  await config.fetchRemoteConfig();
  now += 60001;
  await config.fetchRemoteConfig();
  assert.equal(config.getValue('wechat.share_title'), '1');
  assert.equal(config.isApiSupported('onlineArena'), true);
  await config.fetchRemoteConfig();
  assert.equal(requests, 3);
  assert.equal(config.getValue('wechat.share_title'), '3');
});

test('公共配置仅启用后端明确声明支持的接口', async (t) => {
  global.wx = {
    getAccountInfoSync: () => ({miniProgram: {envVersion: 'release'}}),
  };
  for (const [features, expected] of [
    [{}, [false, false, false, false]],
    [{api: {announcements: true, currentGame: true, authRefresh: true, onlineArena: true}}, [true, true, true, true]],
    [{api: {announcements: 'true', currentGame: false, authRefresh: 'true', onlineArena: 'true'}}, [false, false, false, false]],
  ]) {
    delete require.cache[require.resolve('../utils/runtime-config')];
    const config = require('../utils/runtime-config');
    t.mock.method(api, 'get', async (path) => {
      assert.equal(path, '/configs/public');
      return {configs: {}, features};
    });
    await config.fetchRemoteConfig();
    assert.deepEqual([
      config.isApiSupported('announcements'), config.isApiSupported('currentGame'), config.isApiSupported('authRefresh'),
      config.isApiSupported('onlineArena'),
    ], expected);
    assert.equal(config.isApiSupported('unknown'), false);
  }
});
