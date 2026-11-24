const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api-client');
const privacy = require('../utils/privacy-consent');
const shop = require('../utils/shop-store');
const stats = require('../utils/player-stats');
const store = require('../utils/game-store');
const {buildExpProgress} = require('../utils/progression');

function setup(t) {
  const storage = new Map();
  global.wx = {getStorageSync: (k) => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: (k) => storage.delete(k), showToast() {}, redirectTo() {}};
  global.getCurrentPages = () => [{options: {sessionId: 'session-88'}}];
  t.mock.method(privacy, 'isDevelopmentPreview', () => false);
  t.mock.method(privacy, 'assertAllowed', () => {});
  t.after(() => {store.pauseGame(); delete global.Page; delete global.wx; delete global.getCurrentPages;});
}
function page(file) {
  let def; global.Page = (value) => {def = value;};
  delete require.cache[require.resolve(file)]; require(file);
  return {...def, data: structuredClone(def.data), setData(patch) {Object.assign(this.data, patch);}};
}
async function flush() {for (let i = 0; i < 15; i++) await Promise.resolve();}

test('建房和邀请入房响应绑定账号，换号后不覆盖房间或启动轮询', async (t) => {
  setup(t);
  const runtime = require('../utils/runtime-config');
  t.mock.method(runtime, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(runtime, 'isApiSupported', () => true);
  for (const invited of [false, true]) {
    for (const fail of [false, true]) {
      api.setToken('first');
      let resolve, reject;
      const post = t.mock.method(api, 'post', () => new Promise((yes, no) => {resolve = yes; reject = no;}));
      const p = page('../pages/room/index');
      if (invited) {p.inviteRoomId = '1024'; p.inviteBackendRoomId = '88';}
      const poll = t.mock.method(p, 'pollRoom');
      const pending = p.initRoom(true); await flush();
      api.setToken('second');
      const toast = t.mock.method(wx, 'showToast');
      p.setData = () => {throw new Error('旧账号请求不得覆盖房间');};
      if (fail) reject(new Error('旧账号网络错误'));
      else resolve({room: {id: 88, status: 'waiting'}, players: []});
      await pending;
      assert.equal(poll.mock.callCount(), 0);
      assert.equal(toast.mock.callCount(), 0);
      assert.equal(p.roomInitialized, false);
      post.mock.restore(); toast.mock.restore();
    }
  }
});

test('建房未完成时强制重试不重复建房，失败后可重新连接', async (t) => {
  setup(t); api.setToken('account');
  const runtime = require('../utils/runtime-config');
  t.mock.method(runtime, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(runtime, 'isApiSupported', () => true);
  const p = page('../pages/room/index'); p.pollRoom = () => {};
  let reject;
  const post = t.mock.method(api, 'post', () => new Promise((_yes, no) => {reject = no;}));
  const first = p.initRoom(true); await flush();
  const duplicate = p.initRoom(true); await flush();
  assert.equal(post.mock.callCount(), 1);
  reject(new Error('断网')); await Promise.all([first, duplicate]);
  assert.equal(p.roomInitialized, false); assert.equal(p.roomInitPending, false);
  post.mock.restore();
  t.mock.method(api, 'post', async () => ({room: {id: 88, status: 'waiting'}, players: []}));
  await p.initRoom(true);
  assert.equal(p.roomInitialized, true); assert.equal(p.data.backendRoomId, '88');
});

test('离页后可开始新的进房请求，旧请求不能解除新请求的连接锁', async (t) => {
  setup(t); api.setToken('account');
  const runtime = require('../utils/runtime-config');
  t.mock.method(runtime, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(runtime, 'isApiSupported', () => true);
  const p = page('../pages/room/index'); p.pollRoom = () => {};
  const resolves = [];
  const post = t.mock.method(api, 'post', () => new Promise((resolve) => {resolves.push(resolve);}));
  const first = p.initRoom(true); await flush();
  p.onHide();
  const second = p.initRoom(true); await flush();
  assert.equal(post.mock.callCount(), 2);
  resolves[0]({room: {id: 77}, players: []}); await first;
  assert.equal(p.roomInitPending, true);
  assert.equal(p.data.backendRoomId, '');
  resolves[1]({room: {id: 88}, players: []}); await second;
  assert.equal(p.roomInitPending, false);
  assert.equal(p.data.backendRoomId, '88');
});

test('建房和手动重连离页后，迟到的收尾逻辑不得再写页面', async (t) => {
  setup(t); api.setToken('account');
  for (const method of ['createOnlineRoom', 'retryRoomConnection']) {
    const p = page('../pages/room/index');
    let finish;
    if (method === 'createOnlineRoom') p.initRoom = () => new Promise((resolve) => {finish = resolve;});
    else {
      p.setData({backendRoomId: '88'});
      p.pollRoom = () => new Promise((resolve) => {finish = resolve;});
    }
    const pending = p[method](); await flush();
    p.onHide();
    p.setData = () => {throw new Error('离页后不得写加载状态');};
    finish(); await pending;
  }
});

test('进房请求登录过期后显示登录入口，不能被换号保护误吞', async (t) => {
  setup(t); api.setToken('expired');
  const runtime = require('../utils/runtime-config');
  t.mock.method(runtime, 'fetchRemoteConfig', async () => ({}));
  t.mock.method(runtime, 'isApiSupported', () => true);
  t.mock.method(api, 'post', async () => {api.clearToken(); throw Object.assign(new Error('登录已过期'), {statusCode: 401});});
  const p = page('../pages/room/index');
  await p.initRoom(true);
  assert.equal(p.data.joinLoginRequired, true);
  assert.equal(p.roomInitPending, false);
  assert.equal(p.roomInitialized, false);
});

test('准备和开始请求离页或换账号后，迟到成功与失败均不得更新旧页面', async (t) => {
  setup(t);
  for (const method of ['toggleReady', 'onStartGame']) {
    for (const scenario of ['hide', 'unload', 'account', 'room']) {
      for (const fail of [false, true]) {
        api.setToken('account');
        const p = page('../pages/room/index');
        p.setData({backendRoomId: '88'});
        let resolve, reject;
        const post = t.mock.method(api, 'post', () => new Promise((yes, no) => {resolve = yes; reject = no;}));
        const get = t.mock.method(api, 'get', async () => {throw new Error('旧请求不得继续取房间');});
        const pending = p[method](); await flush();
        if (scenario === 'hide') p.onHide();
        if (scenario === 'unload') p.onUnload();
        if (scenario === 'account') api.setToken('other');
        if (scenario === 'room') p.setData({backendRoomId: '99'});
        const toast = t.mock.method(wx, 'showToast');
        const redirect = t.mock.method(wx, 'redirectTo');
        p.setData = () => {throw new Error('旧页面不得更新');};
        if (fail) reject(new Error('旧请求失败')); else resolve({sessionId: 'session-99'});
        await pending;
        assert.equal(get.mock.callCount(), 0, `${method}/${scenario}`);
        assert.equal(toast.mock.callCount(), 0, `${method}/${scenario}/toast`);
        assert.equal(redirect.mock.callCount(), 0, `${method}/${scenario}/redirect`);
        post.mock.restore(); get.mock.restore(); toast.mock.restore(); redirect.mock.restore();
      }
    }
  }
});

test('准备和开始请求未完成时，重复点击只发出一次操作', async (t) => {
  setup(t); api.setToken('account');
  for (const method of ['toggleReady', 'onStartGame']) {
    const p = page('../pages/room/index'); p.setData({backendRoomId: '88'});
    let finish;
    const post = t.mock.method(api, 'post', () => new Promise((resolve) => {finish = resolve;}));
    const get = t.mock.method(api, 'get', async () => ({room: {id: 88, status: 'waiting'}, players: []}));
    const pending = p[method](); await flush();
    const duplicate = p[method](); await flush();
    assert.equal(post.mock.callCount(), 1, method);
    finish({sessionId: 'session-99'}); await Promise.all([pending, duplicate]);
    post.mock.restore(); get.mock.restore();
  }
});

test('房间断线显示错误、串行重试；恢复后清除错误，失效后停止轮询', async (t) => {
  setup(t); api.setToken('account');
  t.mock.timers.enable({apis: ['setTimeout']});
  const p = page('../pages/room/index');
  t.after(() => p.clearPollTimer());
  let resolveRoom;
  const get = t.mock.method(api, 'get', () => new Promise((resolve) => {resolveRoom = resolve;}));
  const pending = p.pollRoom('88', true);
  await flush();
  assert.equal(get.mock.callCount(), 1);
  t.mock.timers.tick(20000); await flush();
  assert.equal(get.mock.callCount(), 1, '请求未结束时不启动另一轮');
  resolveRoom({room: {id: 88, status: 'waiting'}, players: []}); await pending;
  get.mock.restore();
  let fail = true;
  t.mock.method(api, 'get', async () => {
    if (fail) throw new Error('网络断开');
    return {room: {id: 88, status: 'waiting'}, players: []};
  });
  p.setData({starting: true, startButtonText: '倒计时 2s'});
  t.mock.timers.tick(2000); await flush();
  assert.match(p.data.roomConnectionError, /网络|连接/);
  assert.equal(p.data.starting, false, '断线时取消尚未完成的开局倒计时');
  fail = false;
  await p.retryRoomConnection();
  assert.equal(p.data.roomConnectionError, '');
  t.mock.method(api, 'get', async () => {throw Object.assign(new Error('房间不存在'), {statusCode: 404});});
  t.mock.timers.tick(2000); await flush();
  assert.equal(p.data.roomUnavailable, true);
  assert.equal(p.pollTimer, null);
});

test('页面停止轮询后，迟到房间响应不得更新或恢复定时器', async (t) => {
  setup(t); api.setToken('account');
  t.mock.timers.enable({apis: ['setTimeout']});
  let finish;
  t.mock.method(api, 'get', () => new Promise((resolve) => {finish = resolve;}));
  const p = page('../pages/room/index');
  t.after(() => p.clearPollTimer());
  const pending = p.pollRoom('88', true); await flush();
  p.clearPollTimer();
  p.setData = () => {throw new Error('已离开的页面不应更新');};
  finish({room: {id: 88}, players: []}); await pending;
  assert.equal(p.pollTimer, null);
});

test('账号汇总失败不回落游客经验；首页显示同步失败，重试后恢复服务端等级', async (t) => {
  setup(t);
  stats.recordSettlement({resultId: 'guest', exp: 999, income: 100});
  api.setToken('account');
  t.mock.method(api, 'get', async () => {throw new Error('断网');});
  assert.equal(await stats.fetchSummary(), null);
  const p = page('../pages/home/index');
  await p.syncServerSummary();
  assert.equal(p.data.levelText, '--');
  assert.match(p.data.summaryError, /同步/);
  t.mock.method(api, 'get', async () => ({totalExp: 400, totalIncome: 200, recordCount: 2}));
  await p.syncServerSummary();
  assert.equal(p.data.levelText, `Lv.${buildExpProgress(400).level}`);
  assert.equal(p.data.summaryError, '');
});

test('联机结算经验使用服务端累计值，经验接口失败不会抹掉已确认奖励', async (t) => {
  setup(t); api.setToken('account');
  let failSummary = false;
  t.mock.method(api, 'get', async (url) => {
    if (url === '/stats/summary') {
      if (failSummary) throw new Error('汇总暂不可用');
      return {totalExp: 600, totalIncome: 20, recordCount: 1};
    }
    return {ranking: [{id: 'self', isSelf: true, rank: 1, score: 100}], gain: 30, coins: 20, resultId: 'result88', stage: {id: 1}};
  });
  const p = page('../pages/result/index');
  p.animateNumber = (_v, _f, field) => {p.setData({[field]: String(_v)}); return null;};
  await p.refreshResult();
  assert.deepEqual(p.data.expProgress, buildExpProgress(600));
  failSummary = true;
  await p.refreshResult();
  assert.equal(p.data.expProgress, null);
  assert.match(p.data.expError, /同步/);
  assert.equal(p.data.incomeAmountText, '20');
  assert.equal(p.data.rankList.length, 1);
});

test('资金明细支持翻页与去重，加载更多失败保留第一页并允许重试', async (t) => {
  setup(t); api.setToken('account');
  t.mock.method(shop, 'refreshInventory', async () => ({coins: 100}));
  let fail = false;
  const requests = [];
  t.mock.method(api, 'get', async (_url, options) => {
    requests.push(options.page);
    if (options.page === 2 && fail) throw new Error('断网');
    return options.page === 1
      ? {records: [{id: 1, amount: 10}, {id: 2, amount: 20}], total: 3}
      : {records: [{id: 2, amount: 20}, {id: 3, amount: 30}], total: 3};
  });
  const p = page('../pages/income/index');
  await p.syncRecords();
  assert.equal(p.data.hasMore, true);
  fail = true; await p.loadMoreRecords();
  assert.equal(p.data.records.length, 2);
  assert.match(p.data.moreError, /重试/);
  fail = false; await p.loadMoreRecords();
  assert.deepEqual(p.data.records.map((r) => r.id), [1, 2, 3]);
  assert.equal(p.data.hasMore, false);
  assert.deepEqual(requests, [1, 2, 2]);
});

test('余额接口延迟或失败时，已到达的资金明细仍可查看和翻页', async (t) => {
  setup(t); api.setToken('account');
  let failBalance;
  t.mock.method(shop, 'refreshInventory', () => new Promise((_, reject) => {failBalance = reject;}));
  t.mock.method(api, 'get', async (_url, {page}) => ({records: [{id: page, amount: 10}], total: 2}));
  const p = page('../pages/income/index');
  const pending = p.syncRecords();
  await flush();
  assert.equal(p.data.loading, false);
  assert.equal(p.data.accountLabel, '余额同步中…');
  await p.loadMoreRecords();
  failBalance(new Error('库存接口暂不可用'));
  await pending;
  assert.deepEqual(p.data.records.map((record) => record.id), [1, 2]);
  assert.equal(p.data.balanceAmountText, '--');
  assert.equal(p.data.accountLabel, '余额暂未同步');
});

test('本地复玩保持上一局人数，显式调整人数仍然生效', (t) => {
  setup(t);
  for (const count of [4, 6, 10]) {
    store.createRoomFromStage({id: 1}, {roomSize: count, random: () => 0.3});
    const next = store.restartGame({autoStartTimer: false, random: () => 0.3});
    assert.equal(next.players.length, count);
    store.pauseGame();
  }
  assert.equal(store.restartGame({roomSize: 8, autoStartTimer: false}).players.length, 8);
});

test('原房解散后明确切换新建好友房；网络失败不悄悄创建新房', async (t) => {
  setup(t); api.setToken('account');
  t.mock.method(require('../utils/online-navigation'), 'requireOnlineAccount', async () => {});
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  const urls = [], navigation = [];
  wx.redirectTo = ({url}) => navigation.push(url);
  t.mock.method(api, 'post', async (url, body) => {
    urls.push(url);
    if (url.endsWith('/rematch')) throw Object.assign(new Error('原房间已解散，可以新建好友房'), {statusCode: 410});
    assert.equal(body.stageId, 2); return {room: {id: 77}};
  });
  const p = page('../pages/result/index'); p.onlineSessionId = '88'; p.replayStage = {id: 2};
  await p.replay();
  assert.equal(p.data.replayNewRoom, true); assert.match(p.data.replayError, /解散/);
  assert.deepEqual(urls, ['/games/88/rematch']); assert.equal(navigation.length, 0);
  await p.replay();
  assert.deepEqual(urls, ['/games/88/rematch', '/rooms']);
  assert.deepEqual(navigation, ['/pages/room/index?backendRoomId=77']);
});

test('续玩响应迟到时，离页或换账号都不得跳转', async (t) => {
  setup(t);
  t.mock.method(require('../utils/online-navigation'), 'requireOnlineAccount', async () => {});
  t.mock.method(require('../utils/runtime-config'), 'isApiSupported', () => true);
  const navigation = []; wx.redirectTo = ({url}) => navigation.push(url);
  let finish;
  t.mock.method(api, 'post', () => new Promise((resolve) => {finish = resolve;}));
  for (const scenario of ['hide', 'account']) {
    api.setToken('account');
    const p = page('../pages/result/index'); p.onlineSessionId = '88';
    const pending = p.replay(); await flush();
    if (scenario === 'hide') p.onHide(); else api.setToken('new-account');
    finish({room: {id: 77}}); await pending;
    assert.equal(navigation.length, 0);
  }
});

test('历史流水按服务端日期显示，未知余额不伪装成当前余额', async (t) => {
  setup(t); api.setToken('account');
  t.mock.method(shop, 'refreshInventory', async () => ({coins: 999}));
  const createdAt = '2026-10-01T03:04:00.000Z';
  t.mock.method(api, 'get', async () => ({records: [{id: 1, amount: 10, createdAt, balanceAfter: null}], total: 1}));
  const p = page('../pages/income/index'); await p.syncRecords();
  assert.equal(p.data.records[0].timeText, require('../utils/format').formatDateTime(Date.parse(createdAt)));
  assert.equal(p.data.records[0].balanceText, '--');
});

test('翻页防重复请求，换账号后旧页响应不得覆盖新账号流水', async (t) => {
  setup(t); api.setToken('first');
  t.mock.method(shop, 'refreshInventory', async () => ({coins: 100}));
  let finishMore;
  const get = t.mock.method(api, 'get', async (_url, options) => {
    if (options.page === 2) return new Promise((resolve) => {finishMore = resolve;});
    return {records: [{id: api.getToken(), amount: 10}], total: 2};
  });
  const p = page('../pages/income/index'); await p.syncRecords();
  const pending = p.loadMoreRecords(); await p.loadMoreRecords();
  assert.equal(get.mock.callCount(), 2);
  api.setToken('second'); await p.syncRecords();
  finishMore({records: [{id: 'first-old', amount: 50}], total: 2}); await pending;
  assert.deepEqual(p.data.records.map((r) => r.id), ['second']);
});

test('流水请求登录失效后结束加载，显示手动登录入口', async (t) => {
  setup(t); api.setToken('expired');
  t.mock.method(shop, 'refreshInventory', async () => ({coins: 0}));
  t.mock.method(api, 'get', async () => {api.clearToken(); throw Object.assign(new Error('登录失效'), {statusCode: 401});});
  const p = page('../pages/income/index'); await p.syncRecords();
  assert.equal(p.data.loading, false);
  assert.equal(p.data.recordsLoginRequired, true);
  assert.equal(p.data.records.length, 0);
  assert.equal(p.data.accountLabel, '账号资产');
});

test('换账号后迟到的经验汇总不能覆盖新账号页面', async (t) => {
  setup(t); api.setToken('first');
  let finish;
  t.mock.method(api, 'get', () => new Promise((resolve) => {finish = resolve;}));
  const p = page('../pages/home/index');
  const pending = p.syncServerSummary(); await flush();
  api.setToken('second');
  finish({totalExp: 900, totalIncome: 0, recordCount: 1}); await pending;
  p.syncOverview();
  assert.equal(p.data.levelText, '--');
  assert.equal(p.serverSummary, undefined);
});
