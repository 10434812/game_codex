const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(options = {}) {
  const storage = new Map(options.stored ? [['legal-consent-version', options.stored]] : []);
  const calls = {settings: 0, authorizations: 0};
  const legal = {legalConfig: {privacyVersion: 'p1', agreementVersion: 'a1'}, isReady: () => options.ready !== false};
  const wx = {
    getAccountInfoSync: () => ({miniProgram: {envVersion: options.envVersion || 'release'}}),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    getPrivacySetting(payload) {
      calls.settings++;
      if (options.pendingSetting) calls.settingCallback = payload;
      else payload.success({needAuthorization: options.needAuthorization === true});
    },
    requirePrivacyAuthorize(payload) {
      calls.authorizations++;
      if (options.pendingAuthorization) calls.authorizationCallback = payload;
      else payload.success({});
    },
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/privacy-consent.js'), 'utf8'), {
    module, wx, require: () => legal,
  });
  return {privacy: module.exports, legal, calls, storage};
}

test('开发预览只开放页面与本地玩法，账号授权独立校验', () => {
  const h = harness({ready: false, envVersion: 'develop'});
  assert.equal(h.privacy.canEnter(), false);
  h.privacy.beginDevelopmentPreview();
  assert.equal(h.privacy.canEnter(), true);
  assert.equal(h.privacy.isAllowed(), false);
  assert.throws(() => h.privacy.assertAllowed(), {code: 'PRIVACY_CONSENT_REQUIRED'});
  h.privacy.revoke();
  assert.equal(h.privacy.canEnter(), false);
});

for (const envVersion of ['trial', 'release', 'unknown']) {
  test(`${envVersion} 环境沿用正式授权入口`, () => {
    const h = harness({ready: false, envVersion});
    assert.equal(h.privacy.isDevelopmentPreviewAvailable(), false);
    assert.throws(() => h.privacy.beginDevelopmentPreview());
    assert.equal(h.privacy.canEnter(), false);
  });
}

test('stored agreement alone never unlocks this process until the platform has been checked', async () => {
  const h = harness({stored: 'p1:a1'});
  assert.equal(h.privacy.isAllowed(), false);
  assert.throws(() => h.privacy.assertAllowed(), {code: 'PRIVACY_CONSENT_REQUIRED'});
  assert.equal(await h.privacy.checkPlatformConsent(), true);
  h.privacy.assertAllowed();
  assert.equal(h.calls.settings, 1);
});

for (const options of [{stored: 'p0:a1'}, {stored: 'p1:a1', needAuthorization: true}, {}]) {
  test(`policy or platform disagreement fails closed: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    assert.equal(await h.privacy.checkPlatformConsent(), false);
    assert.equal(h.privacy.isAllowed(), false);
    await h.privacy.authorize();
    assert.equal(h.privacy.isAllowed(), true);
    h.legal.legalConfig.privacyVersion = 'p2';
    assert.equal(h.privacy.isAllowed(), false);
  });
}

test('an unconfigured operator cannot authorize or query private platform state', async () => {
  const h = harness({ready: false, stored: 'p1:a1'});
  await assert.rejects(h.privacy.authorize());
  await assert.rejects(h.privacy.checkPlatformConsent());
  assert.equal(h.calls.settings + h.calls.authorizations, 0);
  assert.equal(h.privacy.isAllowed(), false);
});

test('rejecting or unloading cancels late platform responses', async () => {
  const h = harness({stored: 'p1:a1', pendingSetting: true, pendingAuthorization: true});
  const setting = h.privacy.checkPlatformConsent();
  h.privacy.revoke();
  h.calls.settingCallback.success({needAuthorization: false});
  assert.equal(await setting, false);
  const authorization = h.privacy.authorize();
  h.privacy.revoke();
  h.calls.authorizationCallback.success({});
  await assert.rejects(authorization);
  assert.equal(h.privacy.isAllowed(), false);
});

test('share routing preserves encoded room queries and rejects arbitrary destinations', () => {
  const h = harness();
  const bootUrl = h.privacy.bootUrl({path: 'pages/room/index', query: {backendRoomId: '28', roomId: '1&2'}});
  const restored = decodeURIComponent(bootUrl.split('returnTo=')[1]);
  assert.equal(h.privacy.restoreDestination(restored), '/pages/room/index?backendRoomId=28&roomId=1%262');
  for (const invalid of ['https://other.test', '/pages/room/index/extra', '/pages/profile/index', '//pages/home/index']) {
    assert.equal(h.privacy.restoreDestination(invalid), '/pages/home/index');
  }
});

test('App routes direct shared-room launches through boot without fetching authenticated state', () => {
  const h = harness();
  let app;
  const launches = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), {
    App(value) { app = value; },
    wx: {reLaunch(payload) { launches.push(payload.url); payload.complete(); }},
    require(name) {
      if (name === './utils/privacy-consent') return h.privacy;
      if (name === './utils/runtime-config') return {getFeatures: () => ({})};
      return {};
    },
  });
  app.onLaunch({path: 'pages/room/index', query: {backendRoomId: '28'}});
  assert.equal(launches.length, 1);
  assert.equal(decodeURIComponent(launches[0].split('returnTo=')[1]), '/pages/room/index?backendRoomId=28');
  app.onShow({path: 'pages/legal/privacy/index'});
  assert.equal(launches.length, 1);
});

test('legal readiness rejects future, malformed and impossible effective dates', () => {
  const {legalConfig, isReady} = require('../utils/legal-config');
  const original = {...legalConfig};
  try {
    Object.assign(legalConfig, {
      configured: true, operatorName: '实际运营方', contact: 'privacy@example.test', privacyVersion: 'p1', agreementVersion: 'a1',
      privacySections: [{heading: '数据处理', text: '已确认说明'}], agreementSections: [{heading: '服务规则', text: '已确认规则'}],
    });
    for (const date of ['2999-01-01', '2026-02-30', 'invalid', '2026-1-1', '2026-10-19T00:00:00Z']) {
      legalConfig.effectiveDate = date;
      assert.equal(isReady(), false, date);
    }
    legalConfig.effectiveDate = '2020-01-01';
    assert.equal(isReady(), true);
  } finally {
    Object.assign(legalConfig, original);
  }
});
