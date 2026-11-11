const test = require('node:test');
const assert = require('node:assert/strict');

// ─── wx mock ──────────────────────────────────────────────
const storage = new Map();
let requestCalls = [];
let requestHandler = null;

global.wx = {
  getStorageSync(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  request(payload) {
    requestCalls.push(payload);
    if (requestHandler) {
      requestHandler(payload);
    }
  },
  uploadFile(payload) {
    requestCalls.push(payload);
    if (requestHandler) {
      requestHandler(payload);
    }
  },
};

const api = require('../utils/api-client');
const privacy = require('../utils/privacy-consent');
const runtimeConfig = require('../utils/runtime-config');
const originalAssertAllowed = privacy.assertAllowed;

test('开发预览使用游客资产并保持存储中的账号凭证独立，受保护请求在发送前终止', async () => {
  const originalAccountInfo = wx.getAccountInfoSync;
  const profile = require('../utils/user-profile');
  wx.getAccountInfoSync = () => ({miniProgram: {envVersion: 'develop'}});
  api.setToken('existing-account');
  storage.set('wx_user_profile_v1', {nickName: '账号昵称', avatarUrl: 'account-avatar'});
  privacy.assertAllowed = originalAssertAllowed;
  try {
    privacy.beginDevelopmentPreview();
    assert.equal(api.getToken(), '');
    assert.equal(api.isLoggedIn(), false);
    assert.equal(profile.getCachedProfile().nickName, '微信用户');
    await assert.rejects(api.get('/user/profile'), {code: 'PRIVACY_CONSENT_REQUIRED'});
    await assert.rejects(api.post('/auth/login', {code: 'preview'}), {code: 'PRIVACY_CONSENT_REQUIRED'});
    await assert.rejects(api.uploadFile('/user/avatar', '/tmp/preview.png'), {code: 'PRIVACY_CONSENT_REQUIRED'});
    assert.equal(requestCalls.length, 0);
    assert.equal(storage.get('game_codex_api_token_v1'), 'existing-account');
  } finally {
    privacy.revoke();
    wx.getAccountInfoSync = originalAccountInfo;
  }
});

test('旧账号请求和上传返回 401 时保留当前账号 token', async () => {
  for (const kind of ['request', 'upload']) {
    api.setToken('old-account');
    let pending;
    requestHandler = (payload) => {pending = payload;};
    const operation = kind === 'request' ? api.get('/old-session') : api.uploadFile('/old-avatar', '/tmp/a.png');
    api.setToken('current-account');
    pending.success({statusCode: 401, data: {code: 401}});
    await assert.rejects(operation, (error) => error.statusCode === 401);
    assert.equal(api.getToken(), 'current-account');
  }
});


test.beforeEach(() => {
  storage.clear();
  requestCalls = [];
  requestHandler = null;
  delete wx.login;
  runtimeConfig.isApiSupported = (name) => name === 'authRefresh';
  // Transport tests use a consented session; the refusal cases below restore
  // the real boundary and assert that no network operation is dispatched.
  privacy.assertAllowed = () => {};
});

test('旧后端未声明登录恢复接口时不发送续期请求', async () => {
  runtimeConfig.isApiSupported = () => false;
  api.setToken('expired-token');
  let logins = 0;
  wx.login = ({fail}) => { logins += 1; fail(new Error('不应尝试续期')); };
  requestHandler = (payload) => payload.success({statusCode: 401, data: {code: 401}});

  await assert.rejects(api.get('/rooms/8'), (error) => error.statusCode === 401);
  assert.equal(logins, 0);
  assert.equal(requestCalls.length, 1);
  assert.equal(api.getToken(), '');
});

test('并发请求遇到过期登录时只重新登录一次并恢复原操作', async () => {
  api.setToken('expired-token');
  let logins = 0;
  wx.login = ({success}) => { logins += 1; queueMicrotask(() => success({code: 'renew-code'})); };
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      assert.equal(payload.header.Authorization, 'Bearer expired-token');
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      return queueMicrotask(() => payload.success({statusCode: 401, data: {code: 401}}));
    }
    if (payload.url.endsWith('/shop/inventory')) return success(payload, {code: 0, data: []});
    return success(payload, {code: 0, data: {ok: true}});
  };

  const results = await Promise.all([api.get('/rooms/8'), api.post('/rooms/8/ready')]);
  assert.deepEqual(results, [{ok: true}, {ok: true}]);
  assert.equal(logins, 1);
  assert.equal(api.getToken(), 'renewed-token');
  assert.equal(requestCalls.filter((item) => item.url.endsWith('/rooms/8')).length, 2);
  assert.equal(requestCalls.filter((item) => item.url.endsWith('/rooms/8/ready')).length, 2);
});

test('库存同步期间登录过期，恢复后返回更新后的账号资产', async () => {
  const shop = require('../utils/shop-store');
  shop.resetAccountState();
  api.setToken('expired-token');
  wx.login = ({success}) => queueMicrotask(() => success({code: 'renew-code'}));
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      assert.equal(payload.header.Authorization, 'Bearer expired-token');
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      return queueMicrotask(() => payload.success({statusCode: 401, data: {code: 401}}));
    }
    if (payload.url.endsWith('/user/profile')) return success(payload, {code: 0, data: {coins: 77}});
    return success(payload, {code: 0, data: []});
  };

  const state = await shop.refreshInventory();
  assert.equal(state.coins, 77);
  assert.equal(state.syncStatus, 'ready');
});

test('并发旧请求的 401 晚于续期完成时，仍用同账号新凭证恢复操作', async () => {
  api.setToken('expired-token');
  let delayedRequest;
  let logins = 0;
  wx.login = ({success}) => {logins += 1; queueMicrotask(() => success({code: 'renew-code'}));};
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      if (payload.url.endsWith('/rooms/9/ready')) {delayedRequest = payload; return;}
      return queueMicrotask(() => payload.success({statusCode: 401, data: {code: 401}}));
    }
    if (payload.url.endsWith('/shop/inventory')) return success(payload, {code: 0, data: []});
    return success(payload, {code: 0, data: {ok: true}});
  };

  const slow = api.post('/rooms/9/ready');
  assert.deepEqual(await api.get('/rooms/8'), {ok: true});
  delayedRequest.success({statusCode: 401, data: {code: 401}});
  assert.deepEqual(await slow, {ok: true});
  assert.equal(logins, 1);
});

test('登录恢复进行时的新请求等待新凭证后再发送', async () => {
  api.setToken('expired-token');
  let completeLogin;
  wx.login = ({success}) => {completeLogin = success;};
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      assert.equal(payload.header.Authorization, 'Bearer expired-token');
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      return payload.success({statusCode: 401, data: {code: 401}});
    }
    if (!payload.header.Authorization) return payload.success({statusCode: 401, data: {code: 401}});
    if (payload.url.endsWith('/shop/inventory')) return success(payload, {code: 0, data: []});
    return success(payload, {code: 0, data: {ok: true}});
  };

  const first = api.get('/rooms/8');
  const second = api.post('/rooms/8/ready');
  completeLogin({code: 'renew-code'});
  assert.deepEqual(await Promise.all([first, second]), [{ok: true}, {ok: true}]);
  const readyCalls = requestCalls.filter((item) => item.url.endsWith('/rooms/8/ready'));
  assert.equal(readyCalls.length, 1);
  assert.equal(readyCalls[0].header.Authorization, 'Bearer renewed-token');
});

test('购买时登录过期，续期后只提交一次购买并返回服务器库存', async () => {
  const shop = require('../utils/shop-store');
  shop.resetAccountState();
  api.setToken('expired-token');
  let purchases = 0;
  wx.login = ({success}) => queueMicrotask(() => success({code: 'renew-code'}));
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      return payload.success({statusCode: 401, data: {code: 401}});
    }
    if (payload.url.endsWith('/shop/buy')) { purchases += 1; return success(payload, {code: 0, data: {coins: 0}}); }
    if (payload.url.endsWith('/user/profile')) return success(payload, {code: 0, data: {coins: purchases ? 0 : 77}});
    if (payload.url.endsWith('/shop/inventory')) return success(payload, {code: 0, data: purchases ? [{item_id: 'skin-test', category: 'skin'}] : []});
  };

  const result = await shop.buyViaApi('skin-test');
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(purchases, 1);
  assert.equal(result.state.coins, 0);
  assert.ok(result.state.ownedSkins.includes('skin-test'));
});

test('注销时登录过期，同账号续期后仍会清除账号资料和同意记录', async () => {
  const profile = require('../utils/user-profile');
  api.setToken('expired-token');
  storage.set('legal-consent-version', 'old-consent');
  wx.login = ({success}) => queueMicrotask(() => success({code: 'renew-code'}));
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      return payload.success({statusCode: 401, data: {code: 401}});
    }
    if (payload.url.endsWith('/shop/inventory')) return success(payload, {code: 0, data: []});
    return success(payload, {code: 0, data: {deleted: true}});
  };

  assert.deepEqual(await profile.deleteAccount(), {deleted: true});
  assert.equal(api.getToken(), '');
  assert.equal(storage.has('wx_user_profile_v1'), false);
  assert.equal(storage.has('legal-consent-version'), false);
});

test('上传遇到过期登录时恢复登录并重试原文件', async () => {
  api.setToken('expired-token');
  wx.login = ({success}) => queueMicrotask(() => success({code: 'renew-code'}));
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      assert.equal(payload.header.Authorization, 'Bearer expired-token');
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    if (payload.header.Authorization === 'Bearer expired-token') {
      return payload.success({statusCode: 401, data: JSON.stringify({code: 401})});
    }
    if (payload.url.endsWith('/shop/inventory')) return success(payload, {code: 0, data: []});
    return payload.success({statusCode: 200, data: JSON.stringify({code: 0, data: {avatarUrl: 'uploaded'}})});
  };

  assert.deepEqual(await api.uploadFile('/user/avatar', '/tmp/avatar.png'), {avatarUrl: 'uploaded'});
  const uploads = requestCalls.filter((item) => item.filePath);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].filePath, '/tmp/avatar.png');
});

test('恢复登录期间切换账号，旧操作不会用新账号重新提交', async () => {
  api.setToken('expired-token');
  let completeLogin;
  wx.login = ({success}) => {completeLogin = success;};
  requestHandler = (payload) => payload.success({statusCode: 401, data: {code: 401}});
  const pending = api.post('/rooms/8/ready');
  api.setToken('other-account');
  completeLogin({code: 'renew-code'});
  await assert.rejects(pending, (error) => error.statusCode === 401);
  assert.equal(api.getToken(), 'other-account');
  assert.equal(requestCalls.length, 1);
});

test('登录恢复失败时保留原始 401 且不循环登录', async () => {
  api.setToken('expired-token');
  let logins = 0;
  wx.login = ({fail}) => { logins += 1; fail(new Error('微信登录不可用')); };
  requestHandler = (payload) => payload.success({statusCode: 401, data: {code: 401}});

  await assert.rejects(api.get('/rooms/8'), (error) => error.statusCode === 401);
  assert.equal(logins, 1);
  assert.equal(requestCalls.length, 1);
  assert.equal(api.getToken(), '');
});

test('续期后的凭证再次被拒绝时停止，不循环登录或挂起', {timeout: 1000}, async () => {
  api.setToken('expired-token');
  let logins = 0;
  wx.login = ({success}) => { logins += 1; queueMicrotask(() => success({code: 'renew-code'})); };
  requestHandler = (payload) => {
    if (payload.url.endsWith('/auth/refresh')) {
      return success(payload, {code: 0, data: {token: 'renewed-token', user: {nickName: '旅行者', coins: 77}}});
    }
    return payload.success({statusCode: 401, data: {code: 401}});
  };
  await assert.rejects(api.post('/rooms/8/ready'), (error) => error.statusCode === 401);
  assert.equal(logins, 1);
  assert.equal(api.getToken(), '');
});

function success(payload, bodyData, statusCode = 200) {
  payload.success({
    statusCode,
    data: bodyData === undefined ? {code: 0, data: {ok: true}} : bodyData,
  });
}

function failNetwork(payload, errMsg = 'request:fail') {
  payload.fail({errMsg});
}

async function runWithImmediateTimeout(fn) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (handler) => {
    if (typeof handler === 'function') {
      handler();
    }
    return 0;
  };
  try {
    // await 让微任务链（失败 → 重试）在恢复 setTimeout 前完成
    return await fn();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

test('wx.request 带 10s 超时，wx.uploadFile 带 15s 超时', async () => {
  requestHandler = (payload) => success(payload);
  await api.get('/ping');
  await api.uploadFile('/upload', '/tmp/a.png', 'file', {k: 'v'});

  assert.equal(requestCalls.length, 2);
  assert.equal(requestCalls[0].timeout, 10000);
  assert.equal(requestCalls[1].timeout, 15000);
});

test('幂等 GET 网络失败会退避重试 1 次，第二次成功后返回数据', async () => {
  let calls = 0;
  requestHandler = (payload) => {
    calls += 1;
    if (calls === 1) {
      failNetwork(payload);
      return;
    }
    success(payload, {code: 0, data: {retried: true}});
  };

  const data = await runWithImmediateTimeout(() => api.get('/rooms/1'));
  assert.equal(calls, 2);
  assert.deepEqual(data, {retried: true});
});

test('幂等 GET 连续失败两次会拒绝，并给出可展示的错误文案', async () => {
  let calls = 0;
  requestHandler = (payload) => {
    calls += 1;
    failNetwork(payload, 'request:fail timeout');
  };

  await runWithImmediateTimeout(async () => {
    await assert.rejects(api.get('/games/1'), (err) => {
      assert.equal(calls, 2);
      assert.equal(err.message, '网络超时，请稍后重试');
      return true;
    });
  });
});

test('GET 4xx（含 401）不重试；401 会清除 token', async () => {
  storage.set('game_codex_api_token_v1', 'tok-123');
  requestHandler = (payload) => {
    payload.success({statusCode: 401, data: {code: 401, message: 'unauthorized'}});
  };

  await assert.rejects(api.get('/profile'), (err) => {
    assert.equal(requestCalls.length, 1);
    assert.equal(err.statusCode, 401);
    assert.match(err.message, /登录已过期/);
    assert.equal(storage.has('game_codex_api_token_v1'), false);
    return true;
  });
});

test('GET 404 不重试', async () => {
  requestHandler = (payload) => {
    payload.success({statusCode: 404, data: {code: 404, message: 'not found'}});
  };

  await assert.rejects(api.get('/rooms/999'), (err) => {
    assert.equal(requestCalls.length, 1);
    assert.equal(err.statusCode, 404);
    return true;
  });
});

test('GET 5xx 会重试 1 次', async () => {
  let calls = 0;
  requestHandler = (payload) => {
    calls += 1;
    if (calls === 1) {
      payload.success({statusCode: 502, data: {code: 502, message: 'bad gateway'}});
      return;
    }
    success(payload);
  };

  const data = await runWithImmediateTimeout(() => api.get('/configs/public'));
  assert.equal(calls, 2);
  assert.deepEqual(data, {ok: true});
});

test('非 GET 请求网络失败不重试', async () => {
  requestHandler = (payload) => failNetwork(payload);

  await runWithImmediateTimeout(async () => {
    await assert.rejects(api.post('/rooms', {stageId: 'x'}), (err) => {
      assert.equal(requestCalls.length, 1);
      assert.match(err.message, /网络错误/);
      return true;
    });
  });
});

test('body.code !== 0 时返回服务端 message 并可展示', async () => {
  requestHandler = (payload) => {
    payload.success({statusCode: 200, data: {code: 4001, message: '房间已满'}});
  };

  await assert.rejects(api.post('/rooms/1/join'), (err) => {
    assert.equal(err.message, '房间已满');
    return true;
  });
});

test('GET 成功时返回 body.data', async () => {
  requestHandler = (payload) => {
    success(payload, {code: 0, data: {room: {id: 7}}});
  };

  const data = await api.get('/rooms/7');
  assert.deepEqual(data, {room: {id: 7}});
});

test('request 失败时错误对象带 url，便于定位', async () => {
  requestHandler = (payload) => failNetwork(payload);
  await runWithImmediateTimeout(async () => {
    await assert.rejects(api.get('/rooms/7'), (err) => {
      assert.ok(err.url);
      assert.match(err.url, /\/rooms\/7$/);
      return true;
    });
  });
});

test('unconfirmed consent blocks login, authenticated reads and uploads before dispatch', async () => {
  privacy.assertAllowed = originalAssertAllowed;
  storage.set('game_codex_api_token_v1', 'old-token');
  for (const attempt of [
    () => api.request('POST', '/auth/login', {code: 'wx-code'}, {noAuth: true}),
    () => api.get('/user/profile'),
    () => api.uploadFile('/user/avatar', 'wxfile://avatar.png'),
  ]) {
    await assert.rejects(attempt(), {code: 'PRIVACY_CONSENT_REQUIRED'});
  }
  assert.equal(requestCalls.length, 0);
});

test('public configuration never transmits a stored identity before consent', async () => {
  privacy.assertAllowed = originalAssertAllowed;
  storage.set('game_codex_api_token_v1', 'old-token');
  requestHandler = (payload) => success(payload);
  await api.get('/configs/public');
  assert.equal(requestCalls.length, 1);
  assert.equal(requestCalls[0].header.Authorization, undefined);
});
