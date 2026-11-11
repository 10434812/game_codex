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
  const transport: OnlineTransport = {
    token: api.getToken,
    async get(path) {
      calls.push(`GET ${path}`);
      if (customGet) return customGet(path);
      if (/\/rooms\//.test(path)) return structuredClone(room);
      if (path.endsWith('/result')) return {resultId: 'session-9-user-1', gain: 60, coins: 180, ranking: [{id: '1', isSelf: true, score: 180, rank: 1}]};
      return structuredClone(state);
    },
    async post(path) {
      calls.push(`POST ${path}`);
      if (path === '/rooms' || path.endsWith('/join')) return structuredClone(room);
      if (path.endsWith('/start')) {room.sessionId = 9; room.room.status = 'playing'; return {sessionId: 9};}
      return structuredClone(state);
    },
  };
  const game = new OnlineGame(transport);
  return {game, room, state, calls, setGet: (callback: typeof customGet) => {customGet = callback;}};
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
