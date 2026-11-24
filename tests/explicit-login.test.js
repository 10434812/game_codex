const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const privacy = require('../utils/privacy-consent');
const runtime = require('../utils/runtime-config');
const shop = require('../utils/shop-store');
const user = require('../utils/user-profile');

function setup(t) {
  const storage = new Map();
  global.wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    login: ({success}) => success({code: 'wx-code'}),
    showToast() {},
  };
  t.after(() => { user.clearLocalData(); delete global.wx; delete global.Page; });
  t.mock.method(privacy, 'assertAllowed', () => {});
  t.mock.method(privacy, 'isDevelopmentPreview', () => false);
  t.mock.method(runtime, 'getBoolean', (_key, fallback) => fallback);
  t.mock.method(shop, 'refreshInventory', async () => ({}));
  return storage;
}

function page(relativePath) {
  let definition;
  global.Page = (value) => { definition = value; };
  delete require.cache[require.resolve(relativePath)];
  require(relativePath);
  return {...definition, data: structuredClone(definition.data), setData(update) { Object.assign(this.data, update); }};
}

test('主动退出后可手动重登；重复点击只发一次登录请求，成功才清除退出标记', async (t) => {
  setup(t);
  user.logout();
  let resolveLogin;
  const post = t.mock.method(api, 'post', () => new Promise((resolve) => { resolveLogin = resolve; }));
  const first = user.ensureLogin();
  const second = user.ensureLogin();
  await new Promise(setImmediate);
  assert.equal(post.mock.callCount(), 1);
  assert.equal(user.hasLogoutIntent(), true);
  resolveLogin({token: 'account', user: {nickName: '重登玩家', coins: 0}});
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.nickName, '重登玩家');
  assert.equal(b.nickName, '重登玩家');
  assert.equal(api.getToken(), 'account');
  assert.equal(user.hasLogoutIntent(), false);
});

test('登录失败保留退出标记和游客状态，下一次点击可重试', async (t) => {
  setup(t);
  user.logout();
  const post = t.mock.method(api, 'post', async () => { throw new Error('网络不可用，请重试'); });
  await assert.rejects(user.ensureLogin(), /网络不可用/);
  assert.equal(api.getToken(), '');
  assert.equal(user.hasLogoutIntent(), true);
  post.mock.restore();
  t.mock.method(api, 'post', async () => ({token: 'retry-account', user: {nickName: '重试玩家'}}));
  await user.ensureLogin();
  assert.equal(api.getToken(), 'retry-account');
});

test('登录期间再次退出，迟到的登录响应不能恢复账号或清除退出标记', async (t) => {
  setup(t);
  let resolveLogin;
  t.mock.method(api, 'post', () => new Promise((resolve) => { resolveLogin = resolve; }));
  const pending = user.ensureLogin();
  await new Promise(setImmediate);
  user.logout();
  resolveLogin({token: 'stale-account', user: {nickName: '迟到账号'}});
  await assert.rejects(pending, /取消|重试/);
  assert.equal(api.getToken(), '');
  assert.equal(user.hasLogoutIntent(), true);
});

test('维护、登录关闭和未授权时不发起手动登录', async (t) => {
  setup(t);
  const login = t.mock.method(wx, 'login');
  const flags = t.mock.method(runtime, 'getBoolean', (key, fallback) => key === 'wechat.login_enabled' ? false : fallback);
  await assert.rejects(user.ensureLogin(), /登录.*关闭/);
  flags.mock.restore();
  t.mock.method(runtime, 'getBoolean', (key, fallback) => key === 'system.maintenance_mode' ? true : fallback);
  await assert.rejects(user.ensureLogin(), /维护/);
  t.mock.method(privacy, 'assertAllowed', () => { throw new Error('请先授权'); });
  await assert.rejects(user.ensureLogin(), /授权/);
  assert.equal(login.mock.callCount(), 0);
});

test('资料页登录成功原地恢复账号资料，失败保留登录入口', async (t) => {
  setup(t);
  let fail = true;
  t.mock.method(api, 'post', async () => {
    if (fail) throw new Error('登录暂不可用');
    return {token: 'profile-account', user: {nickName: '账号玩家'}};
  });
  const p = page('../pages/profile/index');
  await p.onLogin();
  assert.match(p.data.profileError, /登录暂不可用/);
  assert.equal(p.data.loggedIn, false);
  assert.equal(p.data.loginPending, false);
  fail = false;
  await p.onLogin();
  assert.equal(p.data.loggedIn, true);
  assert.equal(p.data.draft.nickName, '账号玩家');
});

test('任务页登录后继续加载原任务，重复点击不重复登录或加载', async (t) => {
  setup(t);
  let resolveLogin;
  t.mock.method(api, 'post', () => new Promise((resolve) => { resolveLogin = resolve; }));
  const get = t.mock.method(api, 'get', async () => ({date: '2026-11-11', tasks: [{id: 'play1', progress: 1, target: 1, claimed: false}]}));
  const p = page('../pages/tasks/index');
  await p.loadTasks();
  assert.equal(p.data.loginRequired, true);
  const pending = p.onLogin();
  await p.onLogin();
  await new Promise(setImmediate);
  resolveLogin({token: 'task-account', user: {nickName: '玩家'}});
  await pending;
  assert.equal(get.mock.callCount(), 1);
  assert.equal(p.data.loginRequired, false);
  assert.equal(p.data.tasks[0].disabled, false);
});

test('邀请好友先登录再建房；离开页面后不继续建房', async (t) => {
  setup(t);
  let resolveLogin;
  t.mock.method(api, 'post', () => new Promise((resolve) => { resolveLogin = resolve; }));
  const p = page('../pages/room/index');
  let created = 0;
  p.initRoom = async () => { created++; p.setData({backendRoomId: '88'}); };
  const pending = p.inviteFriend();
  await new Promise(setImmediate);
  assert.equal(created, 0);
  await p.inviteFriend();
  resolveLogin({token: 'invite-account', user: {nickName: '玩家'}});
  await pending;
  assert.equal(created, 1);
  assert.equal(p.data.creatingOnlineRoom, false);
  user.logout();
  p.setData({backendRoomId: ''});
  const late = p.inviteFriend();
  await new Promise(setImmediate);
  p.pageEpoch = (p.pageEpoch || 0) + 1;
  resolveLogin({token: 'late-account', user: {nickName: '玩家'}});
  await late;
  assert.equal(created, 1);
});

test('好友链接未登录时给出登录提示；登录后加入原房间，不新建房间', async (t) => {
  setup(t);
  t.mock.method(runtime, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(runtime, 'isApiSupported', () => true);
  const requests = [];
  t.mock.method(api, 'post', async (url) => {
    requests.push(url);
    if (url === '/auth/login') return {token: 'joining-account', user: {nickName: '受邀玩家'}};
    if (!api.isLoggedIn()) throw Object.assign(new Error('请重新登录'), {statusCode: 401});
    return {room: {id: 88, room_code: '1024'}, players: [{nick_name: '受邀玩家', is_self: true}]};
  });
  const p = page('../pages/room/index');
  p.inviteRoomId = '1024';
  p.inviteBackendRoomId = '88';
  p.pollRoom = () => {};
  await p.initRoom();
  assert.equal(p.data.joinLoginRequired, true);
  // 加入已有邀请与分享开关无关，使用专门的登录并加入入口。
  t.mock.method(runtime, 'getBoolean', (key, fallback) => key === 'wechat.share_enabled' ? false : fallback);
  await p.createOnlineRoom();
  assert.equal(p.data.backendRoomId, '88');
  assert.equal(p.data.joinLoginRequired, false);
  assert.deepEqual(requests, ['/auth/login', '/rooms/88/join']);
});

test('已登录用户继续操作时不重复微信登录；库存同步失败保留已成功登录的账号', async (t) => {
  setup(t);
  const login = t.mock.method(wx, 'login', ({success}) => success({code: 'wx-code'}));
  const post = t.mock.method(api, 'post', async () => ({token: 'account', user: {nickName: '玩家'}}));
  t.mock.method(shop, 'refreshInventory', async () => { throw new Error('资产同步失败'); });
  await user.ensureLogin();
  await user.ensureLogin();
  assert.equal(api.getToken(), 'account');
  assert.equal(user.hasLogoutIntent(), false);
  assert.equal(post.mock.callCount(), 1);
  assert.equal(login.mock.callCount(), 1);
});

test('任务页离开后，迟到登录成功不会重新加载或更新已卸载页面', async (t) => {
  setup(t);
  let resolveLogin;
  t.mock.method(api, 'post', () => new Promise((resolve) => { resolveLogin = resolve; }));
  const get = t.mock.method(api, 'get', async () => { throw new Error('不应加载旧页面'); });
  const p = page('../pages/tasks/index');
  const pending = p.onLogin();
  await new Promise(setImmediate);
  p.onUnload();
  p.setData = () => { throw new Error('不应更新旧页面'); };
  resolveLogin({token: 'task-account', user: {nickName: '玩家'}});
  await pending;
  assert.equal(get.mock.callCount(), 0);
});

test('受邀体验拒绝登录时弹窗展示体验编号并可复制', async (t) => {
  setup(t);
  const modals = [];
  const clipboard = [];
  global.wx.showModal = (options) => { modals.push(options); options.success({confirm: true}); };
  global.wx.setClipboardData = ({data}) => clipboard.push(data);
  const error = Object.assign(new Error('当前为受邀体验，你的体验编号是 42，请发给管理员开通'), {
    statusCode: 403, responseBody: {code: 403, data: {code: 'TRIAL_ACCESS_REQUIRED', trialUserId: 42}},
  });
  t.mock.method(api, 'post', async () => { throw error; });
  await assert.rejects(user.ensureLogin(), /体验编号是 42/);
  assert.equal(modals.length, 1);
  assert.match(modals[0].content, /体验编号是 42/);
  assert.deepEqual(clipboard, ['42']);
  assert.equal(api.getToken(), '');
  assert.equal(user.readTrialUserId(new Error('网络不可用')), 0);
  assert.equal(user.readTrialUserId({responseBody: {data: {code: 'OTHER', trialUserId: 9}}}), 0);
});
