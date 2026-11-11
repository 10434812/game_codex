const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(options = {}) {
  let definition;
  const calls = {login: 0, launch: 0, authorize: 0, preload: 0, exit: 0, destinations: []};
  const storage = new Map(options.consent ? [['legal-consent-version', 'p1:a1']] : []);
  const legal = {isReady: () => options.ready !== false, legalConfig: {privacyVersion: 'p1', agreementVersion: 'a1'}};
  const wx = {
    getAccountInfoSync: () => ({miniProgram: {envVersion: options.envVersion || 'release'}}),
    getPrivacySetting({success, fail}) {
      if (options.settingError) fail(new Error('offline'));
      else success(options.setting === undefined ? {needAuthorization: true} : options.setting);
    },
    requirePrivacyAuthorize({success, fail}) {
      calls.authorize++;
      if (options.authorizationError) fail(new Error('rejected'));
      else success({});
    },
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    exitMiniProgram({fail}) { calls.exit++; if (options.exitError) fail(); },
    reLaunch({url}) { calls.launch++; calls.destinations.push(url); }, navigateTo() {},
  };
  if (options.unsupported) { delete wx.getPrivacySetting; delete wx.requirePrivacyAuthorize; }
  const consentModule = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/privacy-consent.js'), 'utf8'), {
    module: consentModule, require: () => legal, wx,
  });
  const deps = {
    '../../utils/boot-loader': {
      createBootLoader: () => ({start: async () => { calls.preload++; }}),
      createImagePreloadTask: () => async () => {}, getBootAssetQueue: () => [],
    },
    '../../utils/game-store': {getState: () => ({})},
    '../../utils/api-client': {isLoggedIn: () => false},
    '../../utils/user-profile': {
      login: async () => { calls.login++; },
      hasLogoutIntent: () => Boolean(options.logoutIntent),
      clearLogoutIntent: () => { options.logoutIntent = false; calls.clearedLogoutIntent = (calls.clearedLogoutIntent || 0) + 1; },
    },
    '../../utils/runtime-config': {getBoolean: () => true, fetchRemoteConfig: async () => {}},
    '../../utils/audio': {playVoice() {}}, '../../utils/nav': {getNavLayout: () => ({})},
    '../../utils/legal-config': legal,
    '../../utils/privacy-consent': consentModule.exports,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/boot/index.js'), 'utf8'), {
    require: (name) => deps[name], Page(value) { definition = value; }, wx, console,
    setTimeout(fn) { queueMicrotask(fn); return 1; }, clearTimeout() {},
  });
  const page = {...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); }};
  return {page, calls, storage, wx, privacy: consentModule.exports};
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test('开发版在协议筹备期间可主动进入本地预览，保留正式授权状态且保持退出可取消', async () => {
  const h = harness({ready: false, envVersion: 'develop'});
  h.page.onLoad();
  await flush();
  assert.equal(h.page.data.previewAvailable, true);
  assert.equal(h.calls.launch, 0);
  h.page.onEnterDevelopmentPreview();
  await flush();
  assert.equal(h.calls.launch, 1);
  assert.equal(h.calls.destinations[0], '/pages/home/index');
  assert.equal(h.calls.login, 0);
  assert.equal(h.calls.authorize, 0);
  assert.equal(h.storage.has('legal-consent-version'), false);
  assert.equal(h.page.data.consentGranted, false);
  h.page.onUnload();
  assert.equal(h.privacy.canEnter(), true);
  assert.equal(h.privacy.isAllowed(), false);
});

for (const options of [{unsupported: true}, {settingError: true}, {setting: {}}, {ready: false}]) {
  test(`startup fails closed for unavailable consent prerequisites: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    h.page.onLoad();
    await flush();
    assert.equal(h.calls.login, 0);
    assert.equal(h.calls.launch, 0);
    assert.equal(h.calls.preload, 0);
    assert.equal(h.page.data.privacyRequired, true);
    assert.ok(h.page.data.privacyError);
    h.page.onUnload();
  });
}

test('showing the application agreement alone never logs in; platform authorization is required', async () => {
  const h = harness();
  h.page.onLoad();
  await flush();
  assert.equal(h.calls.login, 0);
  assert.equal(h.calls.authorize, 0);
  await h.page.onAgreePrivacy();
  await flush();
  assert.equal(h.calls.authorize, 1);
  assert.equal(h.calls.login, 1);
  assert.equal(h.calls.launch, 1);
  assert.equal(h.storage.get('legal-consent-version'), 'p1:a1');
});

test('a prior WeChat grant does not bypass acceptance of this policy version', async () => {
  const h = harness({setting: {needAuthorization: false}});
  h.page.onLoad();
  await flush();
  assert.equal(h.calls.login, 0);
  await h.page.onAgreePrivacy();
  await flush();
  assert.equal(h.calls.login, 1);
});

test('failed WeChat authorization does not persist consent or unlock login', async () => {
  const h = harness({authorizationError: true});
  h.page.onLoad();
  await flush();
  await h.page.onAgreePrivacy();
  await flush();
  assert.equal(h.calls.login, 0);
  assert.equal(h.calls.launch, 0);
  assert.equal(h.storage.has('legal-consent-version'), false);
  assert.ok(h.page.data.privacyError);
  h.page.onUnload();
});

test('rejection exits and keeps the user logged out even if automatic exit fails', async () => {
  const h = harness({exitError: true});
  h.page.onLoad();
  h.page.onRejectPrivacy();
  await flush();
  assert.equal(h.calls.exit, 1);
  assert.equal(h.calls.login, 0);
  assert.equal(h.calls.launch, 0);
  assert.ok(h.page.data.privacyError);
  h.page.onUnload();
});

test('a rejected user can retry and then complete genuine authorization', async () => {
  const h = harness({exitError: true});
  h.page.onLoad();
  h.page.onRejectPrivacy();
  await flush();
  h.page.retryPrivacy();
  await flush();
  await h.page.onAgreePrivacy();
  await flush();
  assert.equal(h.calls.login, 1);
  assert.equal(h.calls.launch, 1);
});

test('accepted current documents plus confirmed WeChat authorization allow returning-user login', async () => {
  const h = harness({consent: true, setting: {needAuthorization: false}});
  h.page.onLoad();
  await flush();
  assert.equal(h.calls.authorize, 0);
  assert.equal(h.calls.login, 1);
  assert.equal(h.calls.launch, 1);
});

test('unloading while waiting for consent never logs in', async () => {
  const h = harness();
  h.page.onLoad();
  h.page.onUnload();
  await flush();
  assert.equal(h.calls.login, 0);
  assert.equal(h.calls.launch, 0);
});

test('accepted shared-room entry restores the room query only after consent', async () => {
  const h = harness();
  h.page.onLoad({returnTo: '/pages/room/index?backendRoomId=28&roomId=1234'});
  await flush();
  assert.equal(h.calls.launch, 0);
  await h.page.onAgreePrivacy();
  await flush();
  assert.equal(h.calls.destinations[0], '/pages/room/index?backendRoomId=28&roomId=1234');
});

test('用户主动退出登录后，冷启动不会自动换回账号；重新同意协议后清除退出标记并恢复自动登录（I-5）', async () => {
  const blocked = harness({consent: true, logoutIntent: true});
  blocked.page.onLoad();
  await flush();
  assert.equal(blocked.calls.login, 0);
  assert.equal(blocked.calls.launch, 0);
  blocked.page.onUnload();

  const reconsent = harness({logoutIntent: true});
  reconsent.page.onLoad();
  await flush();
  await reconsent.page.onAgreePrivacy();
  await flush();
  assert.equal(reconsent.calls.clearedLogoutIntent, 1);
  assert.equal(reconsent.calls.login, 1);
  reconsent.page.onUnload();
});
