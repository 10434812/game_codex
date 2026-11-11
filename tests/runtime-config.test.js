const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');

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
