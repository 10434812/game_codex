import assert from 'node:assert/strict';
import test from 'node:test';
import {OnlineGame, type OnlineTransport} from '../src/core/OnlineGame';
import * as api from '../src/core/ApiClient';
import * as privacy from '../src/core/PrivacyConsent';
import {legalConfig} from '../src/core/LegalConfig';
import {resolveViewport} from '../src/platform/device';

async function harness() {
  const storage = new Map<string, unknown>();
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key),
    requirePrivacyAuthorize: (options: {success: () => void}) => options.success(),
  });
  Object.assign(legalConfig, {configured: true, operatorName: '测试主体', contact: 'test', effectiveDate: '2020-01-01', privacyVersion: 'test-p', agreementVersion: 'test-a',
    privacySections: [{heading: '测试', text: '测试文本'}], agreementSections: [{heading: '测试', text: '测试文本'}]});
  await privacy.authorize(); api.setToken('test-user-1');
  const room = {room: {id: 7, room_code: '1234', stage_id: 1, status: 'waiting'}, players: [{user_id: 1, nick_name: '玩家甲', is_self: 1, is_host: 1, is_ready: 1}], sessionId: null as number | null};
  const state = {sessionId: 9, roomId: 7, stage: {id: 1}, status: 'playing', stateVersion: 1, timeLeft: 170, duration: 180, round: 3,
    players: [{id: '1', name: '玩家甲', isSelf: true, score: 120, seat: 1}, {id: '2', name: '玩家乙', score: 100, seat: 2}],
    teams: [{id: 'team-1', memberIds: ['1', '2']}], visibleScoreIds: ['2'], fortuneBag: {id: 'offer-1', remainingSeconds: 10, opportunity: {name: '好运', bonus: 60}}};
  const calls: string[] = [];
  let customGet: ((path: string) => Promise<unknown>) | null = null;
  let customPost: OnlineTransport['post'] | null = null;
  const transport: OnlineTransport = {
    token: api.getToken,
    async get(path) {
      calls.push(`GET ${path}`);
      if (customGet) return customGet(path);
      if (/\/rooms\//.test(path)) return structuredClone(room);
      if (path.endsWith('/result')) return {resultId: 'session-9-user-1', gain: 60, coins: 180, ranking: [{id: '1', isSelf: true, score: 180, rank: 1}]};
      return structuredClone(state);
    },
    async post(path, data) {
      calls.push(`POST ${path}`);
      if (customPost) return customPost(path, data);
      if (path.endsWith('/rematch')) {room.sessionId = null; room.room.status = 'waiting'; return structuredClone(room);}
      if (path === '/rooms' || path.endsWith('/join')) return structuredClone(room);
      if (path.endsWith('/start')) {room.sessionId = 9; room.room.status = 'playing'; return {sessionId: 9};}
      return structuredClone(state);
    },
  };
  const game = new OnlineGame(transport);
  return {game, room, state, calls, setGet: (callback: typeof customGet) => {customGet = callback;}, setPost: (callback: typeof customPost) => {customPost = callback;}};
}

test('联机主流程从真实房间响应进入对局，结算读取个人结果', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); assert.equal(h.game.getSnapshot().room?.players[0].self, true);
    await h.game.startGame(); assert.equal(h.game.getState().status, 'playing');
    assert.equal(h.game.getState().players[0].id, '1'); assert.equal(h.game.getOffer()?.id, 'offer-1');
    h.state.status = 'finished'; h.state.stateVersion++;
    await h.game.refresh();
    assert.equal(h.game.getState().status, 'finished'); assert.equal(h.game.getSnapshot().result?.coins, 180);
    assert.ok(h.calls.includes('GET /games/9/result'));
  } finally {h.game.clear();}
});

test('切换账号后，旧房间请求的迟到响应保持隔离', async () => {
  const h = await harness(); let resolve!: (value: unknown) => void;
  h.setGet(() => new Promise((done) => {resolve = done;}));
  const pending = h.game.joinRoom('1234'); await Promise.resolve();
  api.setToken('test-user-2'); resolve(h.room); await pending;
  assert.equal(h.game.getSnapshot().room, null);
  assert.equal(h.calls.some((call) => call.includes('/join')), false);
  h.game.clear();
});

test('已有联机房间时打开另一个邀请，保留原房间和对局连接', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    h.setGet(async () => {throw new Error('房间不存在');});
    await assert.rejects(h.game.joinRoom('9999'));
    assert.equal(h.game.getSnapshot().room?.id, '7');
    assert.equal(h.game.getSnapshot().sessionId, '9');
    assert.equal(h.game.getState().status, 'playing');
  } finally {h.game.clear();}
});

test('停止后的旧对局响应保持隔离，恢复后重新读取服务端', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    let resolve!: (value: unknown) => void;
    h.setGet(() => new Promise((done) => {resolve = done;}));
    const pending = h.game.refresh(); h.game.hide();
    resolve({...h.state, stateVersion: 99, timeLeft: 1}); await pending;
    assert.equal(h.game.getState().timeLeft, 170);
    h.setGet(null); h.state.timeLeft = 150; h.state.stateVersion = 2;
    h.game.show(); await new Promise((done) => setTimeout(done, 0));
    assert.equal(h.game.getState().timeLeft, 150);
  } finally {h.game.clear();}
});

test('操作响应的旧版本保持隔离，错误保留恢复入口', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    h.state.stateVersion = 0; h.state.players[0].score = 9999;
    await h.game.setSelfTeam('2'); assert.equal(h.game.getState().players[0].score, 120);
    h.setGet(async () => {throw new Error('网络离线');});
    await h.game.refresh(); assert.match(h.game.getSnapshot().error, /网络离线/);
    h.setGet(null); h.state.stateVersion = 3; h.state.players[0].score = 180;
    await h.game.refresh(); assert.equal(h.game.getSnapshot().error, '');
    assert.equal(h.game.getState().players[0].score, 180);
  } finally {h.game.clear();}
});

test('安全区以像素换算设计单位，避开实际胶囊与底部手势区', () => {
  const viewport = resolveViewport({windowWidth: 360, windowHeight: 800, screenWidth: 360, screenHeight: 800, pixelRatio: 3, statusBarHeight: 44,
    safeArea: {top: 44, bottom: 766, left: 0, right: 360}}, {bottom: 88});
  assert.equal(viewport.scale, 0.5); assert.ok(viewport.safeTop * viewport.scale > 88);
  assert.ok(viewport.safeBottom * viewport.scale > 34);
});

test('新一轮前台恢复在旧请求结束前即可读取最新快照', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    let resolve!: (value: unknown) => void;
    h.setGet(() => new Promise((done) => {resolve = done;}));
    const pending = h.game.refresh(); h.game.hide();
    h.setGet(null); h.state.timeLeft = 100; h.state.stateVersion = 20;
    h.game.show(); await new Promise((done) => setTimeout(done, 0));
    assert.equal(h.game.getState().timeLeft, 100);
    resolve({...h.state, timeLeft: 1, stateVersion: 99}); await pending;
    assert.equal(h.game.getState().timeLeft, 100);
  } finally {h.game.clear();}
});

test('结算确认后迟到的操作响应保持完成状态', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    h.state.status = 'finished'; await h.game.refresh();
    h.state.status = 'playing'; h.state.stateVersion = 99;
    await h.game.setSelfTeam('2');
    assert.equal(h.game.getState().status, 'finished');
    assert.equal(h.game.getSnapshot().result?.resultId, 'session-9-user-1');
  } finally {h.game.clear();}
});

test('小游戏续玩保留原房、清除旧场次结果，仍可进入新场次', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    h.state.status = 'finished'; await h.game.refresh();
    assert.ok(h.game.getSnapshot().result);
    await h.game.rematch();
    assert.ok(h.calls.includes('POST /games/9/rematch'));
    assert.equal(h.calls.some((call) => /\/leave|POST \/rooms$/.test(call)), false);
    assert.equal(h.game.getSnapshot().room?.id, '7');
    assert.equal(h.game.getSnapshot().sessionId, ''); assert.equal(h.game.getSnapshot().result, null);
    assert.equal(h.game.getState().status, 'room'); assert.equal(h.game.getState().result, null);
    h.state.sessionId = 10; h.room.sessionId = 10; h.room.room.status = 'playing'; h.state.status = 'playing'; h.state.stateVersion = 1;
    await h.game.refresh();
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(h.game.getSnapshot().sessionId, '10');
    assert.equal(h.game.getState().status, 'playing');
  } finally {h.game.clear();}
});

test('小游戏续玩响应隔离旧账号，原房失效时保留成绩和新建入口', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    h.state.status = 'finished'; await h.game.refresh();
    h.setPost(async () => {throw Object.assign(new Error('原房间已解散'), {statusCode: 410});});
    await assert.rejects(h.game.rematch(), /解散/);
    assert.equal(h.game.getSnapshot().rematchUnavailable, true);
    assert.ok(h.game.getSnapshot().result);
    let finish!: (value: unknown) => void;
    h.setPost(() => new Promise((resolve) => {finish = resolve;}));
    const pending = h.game.rematch(); api.setToken('other-account');
    finish(h.room); await pending;
    assert.equal(h.game.getState().status, 'finished');
    assert.equal(h.game.getSnapshot().sessionId, '9');
  } finally {h.game.clear();}
});

test('收到新鲜WS快照时跳过定时HTTP，快照停更后恢复HTTP', async (t) => {
  const h = await harness();
  let opened: () => void = () => {}, message: (event: {data: string}) => void = () => {};
  Object.assign(Reflect.get(globalThis, 'wx'), {connectSocket: () => ({
    onOpen(callback: () => void) {opened = callback;}, onMessage(callback: typeof message) {message = callback;},
    onClose() {}, onError() {}, close() {}, send() {},
  })});
  t.mock.timers.enable({apis: ['setTimeout', 'Date'], now: Date.now()});
  try {
    await h.game.joinRoom('1234'); await h.game.startGame(); opened();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const before = h.calls.filter((call) => call === 'GET /games/9').length;
    t.mock.timers.tick(1000);
    message({data: JSON.stringify({event: 'game_state', data: h.state})});
    t.mock.timers.tick(500);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(h.calls.filter((call) => call === 'GET /games/9').length, before);
    t.mock.timers.tick(1500);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(h.calls.filter((call) => call === 'GET /games/9').length, before + 1);
  } finally {h.game.clear(); t.mock.timers.reset();}
});

test('快速匹配接受服务端房间并可取消；换号后的匹配响应不进入旧房', async () => {
  const h = await harness();
  try {
    h.setPost(async (path) => {
      if (path === '/matchmaking') return {...h.room, room: {...h.room.room, match_due_at: '2026-11-14T12:00:00'}};
      return {};
    });
    await h.game.quickMatch(h.game.getState().stage);
    assert.equal(h.game.getSnapshot().room?.matching, true);
    assert.ok(h.calls.includes('POST /matchmaking'));
    await h.game.leave(); assert.equal(h.game.getSnapshot().room, null);
    assert.ok(h.calls.includes('POST /rooms/7/leave'));
    h.setPost(async (path, data) => {
      if (path !== '/matchmaking') return {};
      assert.deepEqual(data, {stageId: h.game.getState().stage.id, createFriendRoomIfEmpty: true});
      return {...h.room, autoCreatedFriendRoom: true};
    });
    assert.equal(await h.game.quickMatch(h.game.getState().stage, undefined, {createFriendRoomIfEmpty: true}), true);
    assert.equal(h.game.getSnapshot().room?.matching, false);
    await h.game.leave();
    let finish!: (value: unknown) => void;
    h.setPost(() => new Promise((resolve) => {finish = resolve;}));
    const pending = h.game.quickMatch(h.game.getState().stage); api.setToken('new-account');
    finish(h.room); await pending;
    assert.equal(h.game.getSnapshot().room, null);
  } finally {h.game.clear();}
});

test('再匹配失败保留已确认的结算结果，成功后清除旧场次', async () => {
  const h = await harness();
  try {
    await h.game.joinRoom('1234'); await h.game.startGame(); h.state.status = 'finished'; await h.game.refresh();
    const result = h.game.getSnapshot().result;
    h.setPost(async () => {throw new Error('匹配暂不可用');});
    await assert.rejects(h.game.quickMatch(h.game.getState().stage), /不可用/);
    assert.equal(h.game.getSnapshot().result, result); assert.equal(h.game.getState().status, 'finished');
    h.setPost(async () => ({...h.room, sessionId: null, room: {...h.room.room, status: 'waiting', match_due_at: 'soon'}}));
    await h.game.quickMatch(h.game.getState().stage);
    assert.equal(h.game.getSnapshot().result, null); assert.equal(h.game.getSnapshot().sessionId, '');
    assert.equal(h.game.getSnapshot().room?.matching, true);
  } finally {h.game.clear();}
});

test('恢复前台立即发送新方向，旧移动失败与finally不能影响新队列', async () => {
  const h = await harness();
  const moves: {resolve: (value: unknown) => void; reject: (error: Error) => void}[] = [];
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  try {
    await h.game.joinRoom('1234'); await h.game.startGame();
    h.setPost(() => new Promise((resolve, reject) => moves.push({resolve, reject})));
    h.game.setRunDirection(1, 0);
    h.game.hide(); h.game.show(); await tick();
    h.game.setRunDirection(-1, 0);
    assert.equal(moves.length, 2, '新输入不等待旧生命周期请求结束');
    moves[0].reject(new Error('旧移动请求超时')); await tick();
    assert.equal(h.game.getSnapshot().error, '');
    h.game.setRunDirection(0, 1);
    assert.equal(moves.length, 2, '旧finally不能释放新移动的锁');
    moves[1].resolve(h.state); await tick();
    assert.equal(moves.length, 3);
    moves[2].resolve(h.state); await tick();
  } finally {h.game.clear();}
});
