const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness() {
  const storage = new Map(), requests = [];
  let allowed = false, token = 'account-a';
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../utils/analytics'), 'utf8'), {
    module, setTimeout, clearTimeout, Date, Math, Set, Promise, unescape, encodeURIComponent,
    require(name) {
      if (name === './privacy-consent') return {isAllowed: () => allowed};
      if (name === './api-client') return {getToken: () => token, getBaseUrl: () => 'https://example.test/api'};
      if (name === './play-flow') return require('../utils/play-flow');
      throw new Error(name);
    },
    wx: {getStorageSync: (k) => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), request: (options) => requests.push(options)},
  });
  return {analytics: module.exports, storage, requests, consent: () => {allowed = true;}, token: (next) => {token = next;}};
}
test('analytics creates no identifier and sends nothing before consent; flush later sends queued events', async (t) => {
  const h = harness(); t.after(h.analytics.__resetForTests);
  h.analytics.track('app_launch'); assert.equal(await h.analytics.flush(), false);
  assert.equal(h.storage.size, 0); assert.equal(h.requests.length, 0);
  h.consent(); const pending = h.analytics.flush(); const request = h.requests[0];
  assert.equal(request.data.events[0].name, 'app_launch'); assert.equal(request.header.Authorization, undefined);
  assert.equal(h.storage.size, 1); assert.equal(request.data.client, 'miniprogram');
  request.success({statusCode: 200, data: {code: 0}}); assert.equal(await pending, true);
});
test('analytics retains failed batches, avoids concurrent sends and never logs out on 401', async (t) => {
  const h = harness(); t.after(h.analytics.__resetForTests); h.consent();
  h.analytics.track('game_start', {sessionId: '7'});
  const first = h.analytics.flush(); assert.equal(h.analytics.flush(), first);
  const batch = JSON.stringify(h.requests[0].data.events);
  h.requests[0].success({statusCode: 401, data: {code: 401}}); assert.equal(await first, false);
  const retry = h.analytics.flush(); assert.equal(JSON.stringify(h.requests[1].data.events), batch);
  assert.equal(h.requests[1].header.Authorization, 'Bearer account-a');
  h.requests[1].success({statusCode: 200, data: {code: 0}}); await retry;
  assert.equal(await h.analytics.flush(), false);
});
test('analytics keeps account batches separate and strips personal/error credentials', async (t) => {
  const h = harness(); t.after(h.analytics.__resetForTests); h.consent();
  h.analytics.reportError({message: 'failed https://test/?token=private', stack: 'Bearer private', openid: 'private'});
  h.token('account-b'); h.analytics.track('game_finish', {sessionId: '7', openid: 'private'});
  const first = h.analytics.flush();
  assert.equal(h.requests[0].data.events.length, 1); assert.equal(h.requests[0].header.Authorization, 'Bearer account-a');
  assert.equal(JSON.stringify(h.requests[0].data.events).includes('private'), false);
  h.requests[0].success({statusCode: 200, data: {code: 0}}); await first;
  const second = h.analytics.flush(); assert.equal(h.requests[1].header.Authorization, 'Bearer account-b');
  assert.equal(h.requests[1].data.events[0].props.openid, undefined);
  h.requests[1].fail(); await second;
});
test('analytics caps offline queue to 200, sends <=50, and discards on consent revocation', async (t) => {
  const h = harness(); t.after(h.analytics.__resetForTests);
  for (let i = 0; i < 250; i++) h.analytics.track('home_view', {score: i});
  h.consent(); const sent = h.analytics.flush();
  assert.equal(h.requests[0].data.events.length, 50); assert.equal(h.requests[0].data.events[0].props.score, 50);
  h.analytics.discard(); h.requests[0].fail(); await sent;
  assert.equal(await h.analytics.flush(), false);
});
