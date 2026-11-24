const test = require('node:test');
const assert = require('node:assert/strict');
const {selectGrowthGoal} = require('../utils/growth-goal');
const goal = (extra = {}) => ({id: 'ten_games', title: '十场同行', target: 10, progress: 9, reward: 150, claimed: false, ...extra});
test('结算目标优先待领取项，其次按现有服务端进度选择，奖励和剩余局数不虚构', () => {
  const next = selectGrowthGoal({milestones: [goal(), goal({id: 'first_game', target: 1, progress: 1, reward: 50, title: '初次接福'})]});
  assert.equal(next.ready, true); assert.match(next.text, /50 锦鲤币/);
  const remaining = selectGrowthGoal({milestones: [goal(), goal({claimed: true})]});
  assert.equal(remaining.ready, false); assert.equal(remaining.text, '再完成 1 局可领取 150 锦鲤币');
  assert.equal(selectGrowthGoal({milestones: [goal({id: 'thousand_exp', target: 1000, progress: 950})]}).text, '再获得 50 经验可领取 150 锦鲤币');
});
test('全部领取或异常成长数据不显示奖励承诺', () => {
  for (const value of [null, {}, {milestones: [goal({claimed: true})]}, {milestones: [goal({progress: 99})]}, {milestones: [goal({reward: NaN})]}, {milestones: [goal({claimed: 'false'})]}]) assert.equal(selectGrowthGoal(value), null);
});
test('结算目标异步响应隔离换号、离页和旧结算；服务不可用不请求', async t => {
  const api = require('../utils/api-client'), runtime = require('../utils/runtime-config');
  const previousWx = global.wx, previousPage = global.Page; let definition, token = 'account-a', finish;
  global.wx = {getStorageSync() {}, setStorageSync() {}};
  global.Page = p => {definition = p;};
  delete require.cache[require.resolve('../pages/result/index')]; require('../pages/result/index');
  const page = {...definition, pageActive: true, resultRequestId: 1, data: structuredClone(definition.data), setData(patch) {Object.assign(this.data, patch);}};
  t.after(() => {global.wx = previousWx; global.Page = previousPage;});
  t.mock.method(api, 'getToken', () => token); t.mock.method(api, 'isRecoveredToken', () => false);
  t.mock.method(runtime, 'isApiSupported', () => true);
  const get = t.mock.method(api, 'get', () => new Promise(resolve => {finish = resolve;}));
  for (const change of [() => {token = 'account-b';}, () => {page.pageActive = false;}, () => {page.resultRequestId++;}]) {
    token = 'account-a'; page.pageActive = true; page.resultRequestId = 1;
    const pending = page.loadGrowthGoal(); change(); finish({milestones: [goal()]}); await pending;
    assert.equal(page.data.growthGoal, null);
  }
  token = 'account-a'; page.pageActive = true;
  const pending = page.loadGrowthGoal(); finish({milestones: [goal()]}); await pending;
  assert.match(page.data.growthGoal.text, /再完成 1 局/);
  const calls = get.mock.callCount(); t.mock.method(runtime, 'isApiSupported', () => false);
  await page.loadGrowthGoal(); assert.equal(get.mock.callCount(), calls);
});
