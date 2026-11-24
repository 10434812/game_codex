const test = require('node:test');
const assert = require('node:assert/strict');
const configService = require('../src/services/admin-config-service');

test('公共配置声明已注册的公告、当前对局和登录恢复接口，保留原有配置', async (t) => {
  t.mock.method(configService, 'getPublicConfigs', async () => ({
    configs: {'wechat.login_enabled': 'false'}, features: {maintenance: {enabled: false}},
  }));
  const router = require('../src/routes/configs');
  const handler = router.stack.find((layer) => layer.route?.path === '/public').route.stack[0].handle;
  let body;
  await handler({}, {json(value) {body = value;}});
  assert.equal(body.code, 0);
  assert.deepEqual(body.data.configs, {'wechat.login_enabled': 'false'});
  assert.deepEqual(body.data.features, {
    maintenance: {enabled: false}, api: {announcements: true, currentGame: true, authRefresh: true, onlineArena: true, roomRematch: true, quickMatch: true, retention: true},
  });
});
