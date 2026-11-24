const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const privacy = require('../utils/privacy-consent');
const user = require('../utils/user-profile');
const runtime = require('../utils/runtime-config');
const guide = require('../utils/guide-store');
function setup(t, file) {
  const storage = new Map(), redirects = [];
  global.wx = {getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key), showToast() {}, redirectTo: ({url}) => redirects.push(url), navigateTo: ({url}) => redirects.push(url)};
  t.mock.method(privacy, 'assertAllowed', () => {}); t.mock.method(user, 'ensureLogin', async () => ({}));
  t.mock.method(runtime, 'isApiSupported', () => true); api.setToken('account-a');
  let definition; global.Page = (value) => {definition = value;};
  delete require.cache[require.resolve(file)]; require(file);
  const page = {...definition, data: structuredClone(definition.data), setData(patch) {Object.assign(this.data, patch);}};
  t.after(() => {delete global.wx; delete global.Page;}); return {page, redirects};
}
test('原生快速开始走匹配接口，好友房入口仍走建房，迟到响应隔离换号', async (t) => {
  const {page, redirects} = setup(t, '../pages/home/index'); page.syncOnlineGame = async () => 0;
  const requests = []; t.mock.method(api, 'post', async (path) => {requests.push(path); return {room: {id: 88}};});
  await page.enterGame({quick: true}); assert.equal(requests[0], '/matchmaking'); assert.match(redirects[0], /backendRoomId=88/);
  await page.enterGame(); assert.equal(requests[1], '/rooms');
  let done; t.mock.method(api, 'post', () => new Promise((resolve) => {done = resolve;}));
  const pending = page.enterGame({quick: true}); for (let i = 0; i < 8; i++) await Promise.resolve();
  api.setToken('account-b'); done({room: {id: 99}}); await pending;
  assert.equal(redirects.length, 2);
});
test('好友战绩入口按服务端景区快速匹配，成功后清除挑战入口', async (t) => {
  const {page, redirects} = setup(t, '../pages/home/index');
  const code = '123.456.signature';
  t.mock.method(privacy, 'canEnter', () => true);
  t.mock.method(runtime, 'fetchRemoteConfig', async () => null);
  page.syncOnlineGame = async () => '';
  page.fetchAnnouncements = () => {};
  page.checkMaintenance = () => {};
  t.mock.method(page, 'startGame', (options) => page.enterGame(options));
  await page.onLoad({challenge: code});
  assert.equal(page.data.challengePending, true);
  const sourceStage = page.data.stages[1].id;
  t.mock.method(api, 'get', async (path) => {
    assert.equal(path, `/matchmaking/challenge/${code}`);
    return {stageId: sourceStage};
  });
  t.mock.method(api, 'post', async (path, body) => {
    assert.equal(path, '/matchmaking');
    assert.deepEqual(body, {stageId: sourceStage, challengeCode: code});
    return {room: {id: 89}};
  });
  await page.onPrimaryEntry();
  assert.equal(page.data.challengePending, false);
  assert.deepEqual(redirects, ['/pages/room/index?backendRoomId=89']);
});
test('首页快速匹配自动建房后进入好友房并显示提示', async (t) => {
  const {page, redirects} = setup(t, '../pages/home/index');
  page.syncOnlineGame = async () => '';
  t.mock.method(api, 'post', async (path, body) => {
    assert.equal(path, '/matchmaking');
    assert.equal(body.createFriendRoomIfEmpty, true);
    return {room: {id: 88}, autoCreatedFriendRoom: true};
  });
  const toast = t.mock.method(wx, 'showToast');
  t.mock.method(wx, 'navigateTo', ({url, success}) => {
    redirects.push(url);
    success();
  });
  await page.enterGame({quick: true});
  assert.deepEqual(redirects, ['/pages/room/index?backendRoomId=88']);
  assert.equal(toast.mock.calls[0].arguments[0].title, '当前在线玩家较少，已为您自动创建房间');
});
test('原生匹配房展示自动开局并能取消，换号后的取消不跳转', async (t) => {
  const {page, redirects} = setup(t, '../pages/room/index'); page.clearPollTimer = () => {};
  page.renderBackendRoom({room: {id: 88, room_code: '1234', stage_id: 1, match_due_at: 'soon'}, players: [{user_id: 1, is_self: 1, is_host: 1, is_ready: 1}]});
  assert.equal(page.data.matchmaking, true); assert.match(page.data.roomHintText, /机器人/);
  let resolve; t.mock.method(api, 'post', () => new Promise((done) => {resolve = done;}));
  const pending = page.cancelMatch(); api.setToken('account-b'); resolve({}); await pending;
  assert.equal(redirects.length, 0);
});
test('原生随机对局再来一局重新匹配，不等待原房陌生人', async (t) => {
  const {page, redirects} = setup(t, '../pages/result/index');
  page.data.matchmaking = true; page.onlineSessionId = '9';
  t.mock.method(require('../utils/online-navigation'), 'requireOnlineAccount', async () => {});
  const calls = []; t.mock.method(api, 'post', async (path) => {calls.push(path); return {room: {id: 91}};});
  await page.replay();
  assert.deepEqual(calls, ['/matchmaking']); assert.match(redirects[0], /backendRoomId=91/);
});

test('首页按服务端能力选择首局入口，恢复进行中的对局时不显示引导', async (t) => {
  const {page, redirects} = setup(t, '../pages/home/index');
  let capabilities = {onlineArena: true, quickMatch: true};
  t.mock.method(runtime, 'isApiSupported', (name) => capabilities[name] === true);
  page.syncOnlineGame = async () => page.data.activeSessionId || '';
  t.mock.method(page, 'startGame', (options) => page.enterGame(options));
  const paths = []; t.mock.method(api, 'post', async (path) => {paths.push(path); return {room: {id: 88}};});

  page.syncGuide();
  assert.equal(page.data.guideVisible, true);
  assert.equal(page.data.quickMatchAvailable, true);
  await page.onGuidePrimary();
  assert.deepEqual(paths, ['/matchmaking']);
  assert.equal(guide.getCurrentStep(), guide.GUIDE_STEPS.ROOM);
  assert.equal(page.data.guideVisible, false);

  guide.__resetForTests(); capabilities = {onlineArena: true};
  page.syncGuide();
  assert.equal(page.data.onlineAvailable, true);
  assert.equal(page.data.quickMatchAvailable, false);
  assert.equal(page.data.guideVisible, true);
  await page.onGuidePrimary(); assert.deepEqual(paths, ['/matchmaking', '/rooms']);

  guide.__resetForTests(); page.setData({activeSessionId: '9'}); page.syncGuide();
  assert.equal(page.data.guideVisible, false);
  await page.onPrimaryEntry();
  assert.match(redirects.at(-1), /arena\/index\?sessionId=9/);
  assert.equal(paths.length, 2);

  page.setData({activeSessionId: ''}); capabilities = {quickMatch: true}; page.syncGuide();
  assert.equal(page.data.quickMatchAvailable, false);
  assert.equal(page.data.guideVisible, false);
});

test('首次登录、匹配失败或服务能力不兼容时保留首页引导，成功建房才前进', async (t) => {
  const {page} = setup(t, '../pages/home/index'); page.syncOnlineGame = async () => '';
  page.syncGuide();
  const login = t.mock.method(user, 'ensureLogin', async () => {throw new Error('登录取消');});
  await assert.rejects(page.enterGame({quick: true}), /登录取消/);
  assert.equal(guide.getCurrentStep(), guide.GUIDE_STEPS.HOME);
  assert.equal(page.data.guideVisible, true);

  login.mock.mockImplementation(async () => ({}));
  t.mock.method(runtime, 'isApiSupported', (name) => name !== 'quickMatch');
  await assert.rejects(page.enterGame({quick: true}), /快速匹配升级中/);
  assert.equal(guide.getCurrentStep(), guide.GUIDE_STEPS.HOME);

  t.mock.method(runtime, 'isApiSupported', () => true);
  const post = t.mock.method(api, 'post', async () => {throw new Error('连接中断');});
  await assert.rejects(page.enterGame({quick: true}), /连接中断/);
  assert.equal(guide.getCurrentStep(), guide.GUIDE_STEPS.HOME);
  assert.equal(page.data.guideVisible, true);
  post.mock.mockImplementation(async () => ({}));
  await assert.rejects(page.enterGame({quick: true}), /房间创建失败/);
  assert.equal(guide.getCurrentStep(), guide.GUIDE_STEPS.HOME);
  post.mock.mockImplementation(async () => ({room: {id: 99}}));
  await page.enterGame({quick: true});
  assert.equal(guide.getCurrentStep(), guide.GUIDE_STEPS.ROOM);
  assert.equal(page.data.guideVisible, false);
});

test('服务不可用时首页重试强制刷新配置，不触发登录或建房且防重复点击', async (t) => {
  const {page} = setup(t, '../pages/home/index');
  let available = false, finish;
  t.mock.method(runtime, 'isApiSupported', () => available);
  const fetch = t.mock.method(runtime, 'fetchRemoteConfig', (force) => {
    assert.equal(force, true); return new Promise((resolve) => {finish = resolve;});
  });
  t.mock.method(user, 'ensureLogin', () => assert.fail('重新连接不应触发登录'));
  t.mock.method(api, 'post', () => assert.fail('重新连接不应建房'));
  page.syncGuide();
  const pending = page.onPrimaryEntry();
  await page.onPrimaryEntry();
  assert.equal(fetch.mock.callCount(), 1); assert.equal(page.data.entryRefreshing, true);
  available = true; finish({}); await pending;
  assert.equal(page.data.entryRefreshing, false);
  assert.equal(page.data.quickMatchAvailable, true);
  assert.equal(page.data.guideVisible, true);
});
