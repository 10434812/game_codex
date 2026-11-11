const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const privacy = require('../utils/privacy-consent');

test('每日任务页支持游客提示、加载重试和领取后刷新；领取中拦截重复点击', async (t) => {
  let pageDefinition;
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {showToast() {}};
  t.after(() => { delete global.Page; delete global.wx; });
  delete require.cache[require.resolve('../pages/tasks/index')];
  require('../pages/tasks/index');
  const page = {...pageDefinition, data: {...pageDefinition.data}, setData(update) { Object.assign(this.data, update); }};
  let token = '';
  t.mock.method(api, 'getToken', () => token);
  t.mock.method(privacy, 'canEnter', () => true);
  await page.loadTasks();
  assert.match(page.data.error, /登录/);
  assert.equal(page.data.loading, false);
  token = 'session';
  let fail = true;
  const tasks = [
    {id: 'play1', progress: 1, target: 1, claimed: false},
    {id: 'play2', progress: 1, target: 1, claimed: false},
  ];
  const semantic = (list) => list.map(({id, progress, target, claimed}) => ({id, progress, target, claimed}));
  t.mock.method(api, 'get', async () => {
    if (fail) throw new Error('网络不可用');
    return {date: '2026-10-30', tasks};
  });
  await page.loadTasks();
  assert.equal(page.data.error, '网络不可用');
  fail = false;
  await page.loadTasks();
  assert.deepEqual(semantic(page.data.tasks), semantic(tasks));
  assert.equal(page.data.tasks[0].buttonText, '领取');
  let finishClaim;
  let calls = 0;
  t.mock.method(api, 'post', () => { calls++; return new Promise((resolve) => {finishClaim = resolve;}); });
  const event = {currentTarget: {dataset: {id: 'play1'}}};
  const pending = page.claimReward(event);
  page.claimReward(event);
  assert.equal(calls, 1);
  tasks[0].claimed = true;
  finishClaim({reward: 20, coins: 120});
  await pending;
  assert.equal(page.data.tasks[0].claimed, true);
  assert.equal(page.data.claiming, '');
  // 回归 C1：领取一个任务后，其余已完成未领取的任务按钮必须仍可点击
  assert.equal(page.data.tasks[1].disabled, false);
  assert.equal(page.data.tasks[1].buttonText, '领取');
});
