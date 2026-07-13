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

test('exportConfigs returns a portable bundle with sensitive payment config metadata', async (t) => {
  const restore = patchDb({
    execute: async () => [[], []],
    queryAll: async () => [
      {
        config_key: 'wechat.pay_enabled',
        config_value: 'true',
        description: '是否开启微信支付能力',
      },
      {
        config_key: 'wechat.pay_private_key',
        config_value: '-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----',
        description: '微信支付商户 API 证书私钥 PEM（仅服务端保存）',
      },
    ],
  });
  t.after(restore);

  const bundle = await configService.exportConfigs();
  const privateKey = bundle.configs.find((item) => item.key === 'wechat.pay_private_key');

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.app, 'game_codex');
  assert.equal(bundle.totalConfigs, 2);
  assert.equal(privateKey.isSensitive, true);
  assert.equal(privateKey.valueType, 'textarea');
  assert.match(privateKey.value, /BEGIN PRIVATE KEY/);
});

test('getConfigMap returns requested config values and falls back to defaults', async (t) => {
  const restore = patchDb({
    execute: async () => [[], []],
    queryAll: async (_sql, params = []) => {
      if (params.includes('wechat.pay_enabled')) {
        return [{ config_key: 'wechat.pay_enabled', config_value: 'true' }];
      }
      return [];
    },
  });
  t.after(restore);

  const map = await configService.getConfigMap([
    'wechat.pay_enabled',
    'wechat.pay_mch_id',
  ]);

  assert.equal(map['wechat.pay_enabled'], 'true');
  assert.equal(map['wechat.pay_mch_id'], '');
});

test('prepareImportConfigs accepts object exports and skips unknown keys', () => {
  const prepared = configService.__private.prepareImportConfigs({
    configs: {
      'wechat.pay_enabled': true,
      'wechat.pay_private_key': '  -----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----  ',
      'unknown.key': 'ignored',
    },
  });

  assert.deepEqual(prepared.configs, [
    { key: 'wechat.pay_enabled', value: 'true' },
    { key: 'wechat.pay_private_key', value: '-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----' },
  ]);
  assert.deepEqual(prepared.skipped, [
    { key: 'unknown.key', reason: 'unknown_config_key' },
  ]);
});

test('importConfigs writes valid configs and reports skipped rows', async (t) => {
  const stored = new Map();
  const restore = patchDb({
    execute: async (_sql, params = []) => {
      if (params.length >= 4 && typeof params[0] === 'string') {
        stored.set(params[0], params[1]);
      }
      return [[], []];
    },
    queryOne: async (_sql, params = []) => ({
      config_key: params[0],
      config_value: stored.get(params[0]),
      description: '',
      updated_by: 7,
      updated_at: '2026-05-20T00:00:00.000Z',
    }),
  });
  t.after(restore);

  const result = await configService.importConfigs({
    configs: [
      { key: 'wechat.pay_enabled', value: 1 },
      { key: 'wechat.pay_mch_id', value: '1900000109' },
      { key: 'legacy.removed', value: 'skip' },
    ],
  }, 7);

  assert.equal(result.importedCount, 2);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.configs[0].value, 'true');
  assert.equal(result.configs[1].value, '1900000109');
  assert.deepEqual(result.skipped, [
    { key: 'legacy.removed', reason: 'unknown_config_key' },
  ]);
});
