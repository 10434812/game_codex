/**
 * API 客户端行为测试：用替身 wx 驱动真实的网络/存储/隐私链路。
 *
 * 覆盖小程序端已有的语义：`code === 0` 才算成功、401 清 token、
 * 幂等 GET 退避重试一次、4xx 不重试、上传返回字符串 body 也能解析、
 * 未完成隐私授权时除公开配置外一律拒绝。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as api from '../src/core/ApiClient';
import * as privacy from '../src/core/PrivacyConsent';
import {legalConfig} from '../src/core/LegalConfig';

interface RecordedRequest {
  url: string;
  method: string;
  header: Record<string, string>;
  data: unknown;
}

type Outcome = {statusCode: number; data: unknown} | {fail: string};

interface StubState {
  storage: Map<string, unknown>;
  requests: RecordedRequest[];
  respond: (url: string, method: string) => Outcome;
}

function installStubWx(state: StubState): void {
  const wxStub = {
    createCanvas: () => ({width: 0, height: 0, getContext: () => null}),
    getStorageSync: (key: string) => state.storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      state.storage.set(key, value);
    },
    removeStorageSync: (key: string) => {
      state.storage.delete(key);
    },
    getPrivacySetting: (options: {success?: (res: {needAuthorization: boolean}) => void}) =>
      options.success?.({needAuthorization: false}),
    requirePrivacyAuthorize: (options: {success?: () => void}) => options.success?.(),
    request: (options: {
      url: string;
      method?: string;
      header?: Record<string, string>;
      data?: unknown;
      success?: (res: {statusCode: number; data: unknown}) => void;
      fail?: (error: {errMsg: string}) => void;
    }) => {
      const method = String(options.method || 'GET').toUpperCase();
      state.requests.push({
        url: options.url,
        method,
        header: options.header || {},
        data: options.data,
      });
      const outcome = state.respond(options.url, method);
      if ('fail' in outcome) {
        options.fail?.({errMsg: outcome.fail});
        return;
      }
      options.success?.(outcome);
    },
    uploadFile: (options: {
      url: string;
      method?: string;
      success?: (res: {statusCode: number; data: unknown}) => void;
      fail?: (error: {errMsg: string}) => void;
    }) => {
      state.requests.push({url: options.url, method: 'UPLOAD', header: {}, data: null});
      const outcome = state.respond(options.url, 'UPLOAD');
      if ('fail' in outcome) {
        options.fail?.({errMsg: outcome.fail});
        return;
      }
      options.success?.(outcome);
    },
  };
  Reflect.set(globalThis, 'wx', wxStub);
}

function createState(respond: StubState['respond']): StubState {
  return {storage: new Map(), requests: [], respond};
}

function enableLegalConfig(): void {
  const chinaToday = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  legalConfig.configured = true;
  legalConfig.operatorName = '测试运营主体';
  legalConfig.contact = 'test@example.com';
  legalConfig.effectiveDate = chinaToday;
  legalConfig.privacyVersion = '1.0.0';
  legalConfig.agreementVersion = '1.0.0';
  legalConfig.privacySections = [{heading: '信息收集', text: '仅用于对局。'}];
  legalConfig.agreementSections = [{heading: '服务说明', text: '娱乐用途。'}];
}

test('旧账号的请求与上传 401 保留当前账号会话', async () => {
  const state = createState(() => {api.setToken('current-account'); return {statusCode: 401, data: {code: 401}};});
  installStubWx(state); enableLegalConfig(); await privacy.authorize();
  try {
    for (const kind of ['request', 'upload']) {
      api.setToken('old-account');
      await assert.rejects(kind === 'request' ? api.get('/old-session') : api.uploadFile('/old-avatar', '/tmp/a.png'),
        (error: Error) => (error as api.ApiError).statusCode === 401);
      assert.equal(api.getToken(), 'current-account');
    }
  } finally {Reflect.deleteProperty(globalThis, 'wx'); disableLegalConfig(); privacy.revoke();}
});

function disableLegalConfig(): void {
  legalConfig.configured = false;
  legalConfig.operatorName = '';
  legalConfig.contact = '';
  legalConfig.effectiveDate = '';
  legalConfig.privacyVersion = '';
  legalConfig.agreementVersion = '';
  legalConfig.privacySections = [];
  legalConfig.agreementSections = [];
}

test('隐私授权：未配置法律文档时拒绝授权', async () => {
  const state = createState(() => ({statusCode: 200, data: {code: 0, data: {}}}));
  installStubWx(state);
  disableLegalConfig();
  privacy.revoke();
  await assert.rejects(() => privacy.authorize(), /正式法律文档尚未配置/);
  assert.equal(privacy.isAllowed(), false);
  Reflect.deleteProperty(globalThis, 'wx');
});

test('API 请求：鉴权头、错误码与 token 生命周期', async () => {
  const state = createState((url, method) => {
    if (url.endsWith('/configs/public')) {
      return {statusCode: 200, data: {code: 0, data: {configs: {a: '1'}}}};
    }
    if (url.endsWith('/user/profile') && method === 'GET') {
      return {statusCode: 200, data: {code: 0, data: {nickName: '锦鲤玩家'}}};
    }
    if (url.endsWith('/auth/expired')) {
      return {statusCode: 401, data: {code: 401, message: 'token expired'}};
    }
    if (url.endsWith('/shop/buy')) {
      return {statusCode: 400, data: {code: 400, message: '金币不足'}};
    }
    return {statusCode: 200, data: {code: 0, data: null}};
  });
  installStubWx(state);
  enableLegalConfig();
  privacy.revoke();

  // 未授权时：公开配置可读，其它接口被拒绝
  const publicConfig = await api.get('/configs/public');
  assert.deepStrictEqual(publicConfig, {configs: {a: '1'}});
  await assert.rejects(() => api.get('/user/profile'), (error: Error) => {
    assert.equal((error as api.ApiError).statusCode, 403);
    return true;
  });

  // 完成授权后可正常请求
  await privacy.authorize();
  assert.equal(privacy.isAllowed(), true);

  api.setBaseUrl('https://example.test/api/');
  assert.equal(api.getBaseUrl(), 'https://example.test/api');
  api.setToken('token-1');
  assert.equal(api.isLoggedIn(), true);

  await api.get('/user/profile');
  const profileRequest = state.requests.find((item) => item.url.endsWith('/user/profile'));
  assert.ok(profileRequest);
  assert.equal(profileRequest.header.Authorization, 'Bearer token-1');

  // 401 清 token 并抛错
  await assert.rejects(() => api.get('/auth/expired'), (error: Error) => {
    assert.equal((error as api.ApiError).statusCode, 401);
    return true;
  });
  assert.equal(api.isLoggedIn(), false);
  assert.equal(api.getToken(), '');

  // 业务失败：带 message
  await assert.rejects(() => api.post('/shop/buy', {id: 1}), /金币不足/);

  api.setBaseUrl('');
  assert.equal(api.getBaseUrl(), 'https://xcx.ukb88.com/api');
  Reflect.deleteProperty(globalThis, 'wx');
});

test('网络失败：GET 退避重试一次，POST 不重试', async () => {
  const state = createState(() => ({fail: 'request:fail timeout'}));
  installStubWx(state);
  enableLegalConfig();
  privacy.revoke();
  await privacy.authorize();

  state.requests.length = 0;
  await assert.rejects(() => api.get('/stats/summary'), /网络超时，请稍后重试/);
  assert.equal(state.requests.length, 2, 'GET 应重试一次');

  state.requests.length = 0;
  await assert.rejects(() => api.post('/games/start', {}), /网络超时，请稍后重试/);
  assert.equal(state.requests.length, 1, 'POST 不应重试');

  Reflect.deleteProperty(globalThis, 'wx');
});

test('GET 参数拼接与空值过滤', async () => {
  const state = createState(() => ({statusCode: 200, data: {code: 0, data: {records: []}}}));
  installStubWx(state);
  enableLegalConfig();
  privacy.revoke();
  await privacy.authorize();

  state.requests.length = 0;
  await api.get('/stats/history', {page: 2, limit: undefined, keyword: 'a b', empty: null});
  const request = state.requests[0];
  assert.ok(request);
  assert.equal(request.url, 'https://xcx.ukb88.com/api/stats/history?page=2&keyword=a%20b');

  Reflect.deleteProperty(globalThis, 'wx');
});

test('上传：字符串 body 可解析，401 清 token', async () => {
  const state = createState((url) => {
    if (url.endsWith('/user/avatar')) {
      return {statusCode: 200, data: JSON.stringify({code: 0, data: {avatarUrl: 'https://a/b.png', avatarReview: 'pending'}})};
    }
    if (url.endsWith('/user/avatar-bad')) {
      return {statusCode: 200, data: 'not json'};
    }
    return {statusCode: 401, data: {code: 401}};
  });
  installStubWx(state);
  enableLegalConfig();
  privacy.revoke();
  await privacy.authorize();
  api.setToken('token-2');

  const uploaded = await api.uploadFile('/user/avatar', '/tmp/a.png');
  assert.deepStrictEqual(uploaded, {avatarUrl: 'https://a/b.png', avatarReview: 'pending'});
  assert.equal(api.isLoggedIn(), true);

  await assert.rejects(() => api.uploadFile('/user/avatar-bad', '/tmp/a.png'), /上传失败/);
  assert.equal(api.isLoggedIn(), true);

  await assert.rejects(() => api.uploadFile('/user/expired', '/tmp/a.png'), /上传失败\(401\)/);
  assert.equal(api.isLoggedIn(), false, '上传 401 应清 token');

  Reflect.deleteProperty(globalThis, 'wx');
  disableLegalConfig();
  privacy.revoke();
});
