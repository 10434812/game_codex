const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/models/db');
const configService = require('../src/services/admin-config-service');

function patchDb(stubs) {
  const originals = {};
  for (const [key, value] of Object.entries(stubs)) {
    originals[key] = db[key];
    db[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(originals)) {
      db[key] = value;
    }
  };
}

test('exportConfigs returns a portable bundle with sensitive config metadata', async (t) => {
  const restore = patchDb({
    execute: async () => [[], []],
    queryAll: async () => [
      {
        config_key: 'wechat.login_enabled',
        config_value: 'true',
        description: '是否开启微信登录',
      },
      {
        config_key: 'wechat.login_secret',
        config_value: '-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----',
        description: '小程序 AppSecret',
      },
    ],
  });
  t.after(restore);

  const bundle = await configService.exportConfigs();
  const privateKey = bundle.configs.find((item) => item.key === 'wechat.login_secret');

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.app, 'game_codex');
  assert.equal(bundle.totalConfigs, 2);
  assert.equal(privateKey.isSensitive, true);
  assert.equal(privateKey.valueType, 'password');
  assert.match(privateKey.value, /BEGIN PRIVATE KEY/);
});

test('getConfigMap returns requested config values and falls back to defaults', async (t) => {
  const restore = patchDb({
    execute: async () => [[], []],
    queryAll: async (_sql, params = []) => {
      if (params.includes('wechat.login_enabled')) {
        return [{ config_key: 'wechat.login_enabled', config_value: 'true' }];
      }
      return [];
    },
  });
  t.after(restore);

  const map = await configService.getConfigMap([
    'wechat.login_enabled',
    'wechat.login_app_id',
  ]);

  assert.equal(map['wechat.login_enabled'], 'true');
  assert.equal(map['wechat.login_app_id'], 'wxd7f500f3f21f15dd');
});

test('prepareImportConfigs accepts object exports and skips unknown keys', () => {
  const prepared = configService.__private.prepareImportConfigs({
    configs: {
      'wechat.login_enabled': true,
      'wechat.login_secret': '  -----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----  ',
      'unknown.key': 'ignored',
    },
  });

  assert.deepEqual(prepared.configs, [
    { key: 'wechat.login_enabled', value: 'true' },
    { key: 'wechat.login_secret', value: '-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----' },
  ]);
  assert.deepEqual(prepared.skipped, [
    { key: 'unknown.key', reason: 'unknown_config_key' },
  ]);
});

test('importConfigs writes valid configs and reports skipped rows', async (t) => {
  const stored = new Map();
  const restore = patchDb({
    pool: {
      getConnection: async () => ({
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => stored.clear(),
        release() {},
        execute: async (sql, [key, value]) => {
          if (sql.startsWith('INSERT')) {
            stored.set(key, value);
            return [{ affectedRows: 1 }];
          }
          return [[{ config_key: key, config_value: stored.get(key), updated_by: 7 }]];
        },
      }),
    },
  });
  t.after(restore);

  const result = await configService.importConfigs({
    configs: [
      { key: 'wechat.login_enabled', value: 1 },
      { key: 'wechat.login_app_id', value: 'wxd7f500f3f21f15dd' },
      { key: 'legacy.removed', value: 'skip' },
    ],
  }, 7);

  assert.equal(result.importedCount, 2);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.configs[0].value, 'true');
  assert.equal(result.configs[1].value, 'wxd7f500f3f21f15dd');
  assert.deepEqual(result.skipped, [
    { key: 'legacy.removed', reason: 'unknown_config_key' },
  ]);
});

test('小游戏登录配置独立读取，缺失密钥不回退到小程序配置', async (t) => {
  const restore = patchDb({
    execute: async () => [[], []],
    queryOne: async (_sql, params) => {
      const values = {'wechat.login_app_id': 'native-app', 'wechat.login_secret': 'native-test-secret',
        'wechat.minigame_app_id': 'game-app', 'wechat.minigame_secret': ''};
      return Object.hasOwn(values, params[0]) ? {config_value: values[params[0]]} : null;
    },
  });
  t.after(restore);
  const native = await configService.getWechatLoginSettings();
  const game = await configService.getWechatLoginSettings('minigame');
  assert.equal(native.appId, 'native-app'); assert.equal(native.secret, 'native-test-secret');
  assert.equal(game.appId, 'game-app'); assert.equal(game.secret, '');
  const {CONFIG_DEFINITION_MAP} = require('../src/config/system-config-definitions');
  assert.equal(CONFIG_DEFINITION_MAP['wechat.minigame_secret'].isSensitive, true);
  assert.equal(CONFIG_DEFINITION_MAP['wechat.minigame_secret'].isPublic, false);
});

test('后台区分两端登录就绪状态；小程序已配密钥不能让小游戏误报就绪', async (t) => {
  const values = new Map([['wechat.login_secret', 'native-test-secret']]);
  const restore = patchDb({execute: async () => [[], []], queryAll: async () => Array.from(values, ([config_key, config_value]) => ({config_key, config_value}))});
  t.after(restore);
  let summary = await configService.getAdminConfigSummary();
  assert.equal(summary.capabilities.login.isReady, true);
  assert.equal(summary.capabilities.minigameLogin.isReady, false);
  assert.deepEqual(summary.capabilities.minigameLogin.missingKeys, ['wechat.minigame_secret']);
  assert.equal(JSON.stringify(summary).includes('native-test-secret'), false);
  values.set('wechat.minigame_secret', 'game-test-secret');
  summary = await configService.getAdminConfigSummary();
  assert.equal(summary.capabilities.minigameLogin.isReady, true);
  assert.equal(JSON.stringify(summary).includes('game-test-secret'), false);
});
