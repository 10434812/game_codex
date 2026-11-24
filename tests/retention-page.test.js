const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const runtime = require('../utils/runtime-config');
function fixture(t) {
  const oldWx = global.wx, oldPage = global.Page, storage = new Map(), toasts = [];
  global.wx = {getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key), showToast: (value) => toasts.push(value.title)};
  api.setToken('account-a'); t.mock.method(runtime, 'isApiSupported', () => true);
  let definition; global.Page = (value) => {definition = value;};
  delete require.cache[require.resolve('../pages/tasks/index')]; require('../pages/tasks/index');
  const page = {...definition, data: structuredClone(definition.data), active: true, tasksOwner: 'account-a', setData(patch) {Object.assign(this.data, patch);}};
  t.after(() => {global.wx = oldWx; global.Page = oldPage;}); return {page, toasts};
}
test('签到防重复点击，收到幂等回执只提示已到账，刷新前释放按钮锁', async (t) => {
  const {page, toasts} = fixture(t); let resolve;
  const post = t.mock.method(api, 'post', () => new Promise((done) => {resolve = done;}));
  let refreshes = 0; page.loadTasks = async () => {assert.equal(page.data.retentionClaiming, ''); refreshes++;};
  const event = {currentTarget: {dataset: {id: 'checkin'}}};
  const pending = page.claimRetention(event); page.claimRetention(event);
  assert.equal(post.mock.callCount(), 1); assert.equal(post.mock.calls[0].arguments[0], '/retention/checkin');
  resolve({reward: 20, alreadyClaimed: true, coins: 120}); await pending;
  assert.deepEqual(toasts, ['奖励已领取并到账']); assert.equal(refreshes, 1); assert.equal(page.data.retentionClaiming, '');
});
test('切后台或换号后，旧的成长领取响应不提示奖励、不刷新新账号页面', async (t) => {
  const {page, toasts} = fixture(t); let resolve;
  t.mock.method(api, 'post', () => new Promise((done) => {resolve = done;}));
  page.loadTasks = () => assert.fail('stale reward must not reload');
  const pending = page.claimRetention({currentTarget: {dataset: {id: 'first_game'}}});
  page.onHide(); api.setToken('account-b'); resolve({reward: 50, alreadyClaimed: false, coins: 150}); await pending;
  assert.equal(toasts.length, 0); assert.equal(page.data.retentionClaiming, '');
});
test('任务读取可带成长数据，经验榜按需获取，旧账号榜单响应被忽略', async (t) => {
  const {page} = fixture(t); const requests = []; let finishRank;
  const retention = {checkin: {claimed: true}, milestones: []};
  t.mock.method(api, 'get', async (path, params) => {
    requests.push({path, params});
    if (path === '/tasks') return {date: '2026-11-14', tasks: [], retention};
    return new Promise((done) => {finishRank = done;});
  });
  await page.loadTasks(); assert.equal(page.data.retention, retention); assert.equal(requests.length, 1);
  assert.equal(requests[0].params.includeRetention, 1);
  const pending = page.showLeaderboard(); assert.equal(requests[1].params.type, 'exp');
  api.setToken('account-b'); finishRank([{id: 7, nickName: '旧账号榜单', totalExp: 100}]); await pending;
  assert.deepEqual(page.data.leaderboard, []);
});

test('同账号自动续签后，更新任务和经验榜', async (t) => {
  const {page} = fixture(t);
  t.mock.method(api, 'isRecoveredToken', (previous, current) => previous === 'account-a' && current === 'renewed');
  t.mock.method(api, 'get', async (path) => {
    if (path === '/tasks') {
      api.setToken('renewed');
      return {date: '2026-11-18', tasks: [{id: 'one', progress: 1, target: 1}]};
    }
    return [{id: 1, totalExp: 10}];
  });
  await page.loadTasks();
  assert.equal(page.data.tasks[0].buttonText, '领取');
  assert.equal(page.tasksOwner, 'renewed');
  api.setToken('account-a');
  const pending = page.showLeaderboard();
  api.setToken('renewed');
  await pending;
  assert.equal(page.data.leaderboard[0].rank, 1);
});

test('领取期间同账号续签，显示奖励并从服务端刷新为已领取', async (t) => {
  const {page, toasts} = fixture(t);
  t.mock.method(api, 'isRecoveredToken', (previous, current) => previous === 'account-a' && current === 'renewed');
  t.mock.method(api, 'post', async () => {
    api.setToken('renewed');
    return {reward: 20};
  });
  t.mock.method(api, 'get', async () => ({tasks: [{id: 'one', progress: 1, target: 1, claimed: true}]}));
  await page.claimReward({currentTarget: {dataset: {id: 'one'}}});
  assert.deepEqual(toasts, ['获得 20 锦鲤币']);
  assert.equal(page.data.tasks[0].buttonText, '已领取');
  assert.equal(page.data.claiming, '');
});

test('任务加载续签失败后结束加载并引导重新登录', async (t) => {
  const {page} = fixture(t);
  page.data.leaderboard = [{id: 'old'}];
  t.mock.method(api, 'get', async () => {
    api.clearToken();
    throw Object.assign(new Error('Unauthorized'), {statusCode: 401});
  });
  await page.loadTasks();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.loginRequired, true);
  assert.match(page.data.error, /重新微信登录/);
  assert.deepEqual(page.data.leaderboard, []);
});
