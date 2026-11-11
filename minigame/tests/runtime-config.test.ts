/**
 * 运行时配置行为测试：远端覆盖、60 秒缓存、并发去重、失败回落默认值。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as api from '../src/core/ApiClient';
import * as runtimeConfig from '../src/core/RuntimeConfig';

interface StubState {
  requests: string[];
  respond: () => {statusCode: number; data: unknown} | {fail: string};
}

function installStubWx(state: StubState): void {
  Reflect.set(globalThis, 'wx', {
    createCanvas: () => ({width: 0, height: 0, getContext: () => null}),
    getStorageSync: () => undefined,
    setStorageSync: () => undefined,
    removeStorageSync: () => undefined,
    request: (options: {
      url: string;
      success?: (res: {statusCode: number; data: unknown}) => void;
      fail?: (error: {errMsg: string}) => void;
    }) => {
      state.requests.push(options.url);
      const outcome = state.respond();
      if ('fail' in outcome) {
        options.fail?.({errMsg: outcome.fail});
        return;
      }
      options.success?.(outcome);
    },
  });
}

function cleanup(): void {
  Reflect.deleteProperty(globalThis, 'wx');
  runtimeConfig.__resetForTests();
  api.setBaseUrl('');
}

test('远端配置覆盖默认值，并按 60 秒缓存', async () => {
  const state: StubState = {
    requests: [],
    respond: () => ({
      statusCode: 200,
      data: {
        code: 0,
        data: {
          configs: {'wechat.share_title': '远端标题', 'room.backend_enabled': true},
          features: {beta: true},
        },
      },
    }),
  };
  installStubWx(state);
  runtimeConfig.__resetForTests();

  const merged = await runtimeConfig.fetchRemoteConfig();
  assert.equal(merged['wechat.share_title'], '远端标题');
  assert.equal(merged['wechat.share_desc'], runtimeConfig.DEFAULT_CONFIG['wechat.share_desc']);
  assert.equal(runtimeConfig.getValue('wechat.share_title'), '远端标题');
  assert.equal(runtimeConfig.getBoolean('room.backend_enabled'), true);
  assert.equal(runtimeConfig.getBoolean('wechat.share_enabled'), true);
  assert.deepStrictEqual(runtimeConfig.getFeatures(), {beta: true});
  assert.equal(state.requests.length, 1);

  await runtimeConfig.fetchRemoteConfig();
  assert.equal(state.requests.length, 1, '60 秒内不应重复请求');

  await runtimeConfig.fetchRemoteConfig(true);
  assert.equal(state.requests.length, 2, 'force 应绕过缓存');

  cleanup();
});

test('并发调用共用同一个请求', async () => {
  const state: StubState = {
    requests: [],
    respond: () => ({statusCode: 200, data: {code: 0, data: {configs: {}}}}),
  };
  installStubWx(state);
  runtimeConfig.__resetForTests();

  await Promise.all([
    runtimeConfig.fetchRemoteConfig(),
    runtimeConfig.fetchRemoteConfig(),
    runtimeConfig.fetchRemoteConfig(),
  ]);
  assert.equal(state.requests.length, 1);

  cleanup();
});

test('拉取失败回落默认值，并记录本次尝试时间', async (t) => {
  const warnings: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  const state: StubState = {requests: [], respond: () => ({fail: 'request:fail timeout'})};
  installStubWx(state);
  runtimeConfig.__resetForTests();

  const merged = await runtimeConfig.fetchRemoteConfig();
  assert.equal(merged['wechat.share_title'], runtimeConfig.DEFAULT_CONFIG['wechat.share_title']);
  // 失败时也应更新 lastFetchTime，避免每次调用都重试
  assert.equal(state.requests.length, 2, 'GET 会退避重试一次');
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /fetchRemoteConfig error/);

  cleanup();
});

test('非法返回值不污染配置', async () => {
  const state: StubState = {
    requests: [],
    respond: () => ({statusCode: 200, data: {code: 0, data: null}}),
  };
  installStubWx(state);
  runtimeConfig.__resetForTests();

  const merged = await runtimeConfig.fetchRemoteConfig();
  assert.deepStrictEqual(merged, runtimeConfig.DEFAULT_CONFIG);
  assert.deepStrictEqual(runtimeConfig.getFeatures(), {});

  cleanup();
});
