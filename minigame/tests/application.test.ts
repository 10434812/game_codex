import assert from 'node:assert/strict';
import test from 'node:test';
import {GameApplication} from '../src/GameApplication';
import {resolveViewport} from '../src/platform/device';
import * as privacy from '../src/core/PrivacyConsent';
import {legalConfig} from '../src/core/LegalConfig';
import * as local from '../src/core/GameStore';
import * as api from '../src/core/ApiClient';
import * as runtime from '../src/core/RuntimeConfig';

function harness() {
  const storage = new Map<string, unknown>();
  let needsConsent = false;
  const audio = {src: '', loop: false, volume: 1, onError() {}, play() {}, pause() {}, stop() {}, destroy() {}};
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    getPrivacySetting: (options: {success: (result: {needAuthorization: boolean}) => void}) => options.success({needAuthorization: needsConsent}),
    requirePrivacyAuthorize: (options: {success: () => void}) => options.success(),
    request: (options: {success: (result: unknown) => void}) => options.success({statusCode: 200, data: {code: 0, data: {configs: {}, features: {api: {roomRematch: true}}}}}),
    createInnerAudioContext: () => ({...audio}),
    vibrateShort() {},
    showToast() {},
    getLaunchOptionsSync: () => ({query: {}}),
  });
  privacy.revoke(); local.__resetForTests(); runtime.__resetForTests();
  Object.assign(legalConfig, {configured: true, operatorName: '测试主体', contact: '测试联系方式', effectiveDate: '2020-01-01',
    privacyVersion: 'test-p', agreementVersion: 'test-a', privacySections: [{heading: '测试', text: '测试'}], agreementSections: [{heading: '测试', text: '测试'}]});
  const app = new GameApplication(resolveViewport({windowWidth: 360, windowHeight: 780, screenWidth: 360, screenHeight: 780, pixelRatio: 2}));
  return {app, revokePlatform: () => {needsConsent = true;}};
}

test('小游戏只提供账号房间，禁止旧体验入口，服务端对局到结果完成闭环', async () => {
  const {app} = harness();
  try {
    await app.initialize(); assert.equal(app.getModel().screen, 'boot');
    await app.dispatch({type: 'authorize'}); assert.equal(app.getModel().screen, 'home');
    await app.dispatch({type: 'create-local'}); assert.equal(app.getModel().screen, 'home');
    assert.match(app.getModel().error, /好友房间/);
    api.setToken('online-user');
    const room = {room: {id: 7, room_code: '1234', stage_id: 1, status: 'waiting'}, players: [{user_id: 1, nick_name: '玩家', is_self: true, is_host: true}]};
    const state = {sessionId: 9, roomId: 7, stage: {id: 1}, status: 'playing', stateVersion: 1, timeLeft: 120,
      players: [{id: '1', name: '玩家', isSelf: true, score: 100, rank: 1}], teams: []};
    Reflect.set(Reflect.get(globalThis, 'wx'), 'request', (options: {url: string; success: (response: unknown) => void}) => {
      const data = options.url.endsWith('/start') ? {sessionId: 9}
        : options.url.endsWith('/result') ? {resultId: 'server-9', coins: 30, gain: 10, ranking: [{id: '1', isSelf: true, rank: 1, score: 100}]}
          : options.url.endsWith('/rematch') || options.url.includes('/rooms') ? room : options.url.includes('/games/') ? state
            : options.url.includes('/shop/inventory') ? [] : options.url.includes('/user/profile') ? {nickName: '玩家', coins: 30}
              : options.url.includes('/stats/history') ? {records: [], total: 0} : {configs: {}, features: {api: {roomRematch: true}}};
      options.success({statusCode: 200, data: {code: 0, data}});
    });
    await runtime.fetchRemoteConfig(true);
    await app.dispatch({type: 'create-online'}); assert.equal(app.getModel().screen, 'room');
    await app.dispatch({type: 'start'}); assert.equal(app.getModel().screen, 'arena');
    let exported: ((response: {tempFilePath: string}) => void) | undefined;
    const ctx = {save() {}, restore() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, arc() {}, fill() {}, stroke() {}, createLinearGradient: () => ({addColorStop() {}}), fillText() {}, measureText: () => ({width: 30})};
    Reflect.set(Reflect.get(globalThis, 'wx'), 'createCanvas', () => ({width: 0, height: 0, getContext: () => ctx,
      toTempFilePath: (options: {success: (response: {tempFilePath: string}) => void}) => {exported = options.success;}}));
    state.status = 'finished'; state.stateVersion++;
    await app.online.refresh();
    assert.equal(app.getModel().screen, 'result');
    assert.equal(app.getModel().result?.coins, 30);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(exported);
    exported({tempFilePath: 'wxfile://result-card.png'});
    assert.match(app.shareData().title, /100分，第1名/);
    assert.equal(app.shareData().imageUrl, 'wxfile://result-card.png');
    api.setToken('other-account');
    assert.equal(app.shareData().imageUrl, undefined);
    assert.doesNotMatch(app.shareData().title, /100分/);
    api.setToken('online-user');

    await app.dispatch({type: 'play-again'});
    assert.equal(app.getModel().screen, 'room');
    assert.equal(app.getModel().online.room?.id, '7');
    assert.equal(app.getModel().online.sessionId, '');
    assert.equal(app.getModel().result, null);
    await app.dispatch({type: 'home'});
    for (const screen of ['shop', 'profile', 'income'] as const) {
      await app.dispatch({type: screen}); assert.equal(app.getModel().screen, screen);
    }
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('恢复前台重新查询平台隐私状态，撤回后进入授权页', async () => {
  const h = harness();
  try {
    await privacy.authorize(); await h.app.initialize(); assert.equal(h.app.getModel().screen, 'home');
    h.app.hide(); h.revokePlatform(); await h.app.show();
    assert.equal(h.app.getModel().screen, 'boot'); assert.equal(privacy.isAllowed(), false);
    await h.app.dispatch({type: 'create-local'});
    assert.equal(h.app.getModel().screen, 'boot');
  } finally {h.app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('首页能力来自服务端，重试连接只刷新配置且不触发登录或建房', async () => {
  const {app} = harness();
  try {
    await privacy.authorize(); await app.initialize();
    assert.equal(app.getModel().onlineAvailable, false);
    assert.equal(app.getModel().quickMatchAvailable, false);
    const paths: string[] = [];
    let capabilities = {onlineArena: true, quickMatch: false};
    Reflect.set(Reflect.get(globalThis, 'wx'), 'request', (options: {url: string; success: (response: unknown) => void}) => {
      paths.push(options.url);
      assert.ok(options.url.endsWith('/configs/public'), '重试不应请求登录或房间接口');
      options.success({statusCode: 200, data: {code: 0, data: {configs: {}, features: {api: capabilities}}}});
    });
    await app.dispatch({type: 'retry-service'});
    assert.equal(app.getModel().onlineAvailable, true);
    assert.equal(app.getModel().quickMatchAvailable, false);
    capabilities.quickMatch = true;
    await app.dispatch({type: 'retry-service'});
    assert.equal(app.getModel().quickMatchAvailable, true);
    capabilities.onlineArena = false;
    await app.dispatch({type: 'retry-service'});
    assert.equal(app.getModel().quickMatchAvailable, false);
    assert.match(app.getModel().error, /对战服务暂时不可用/);
    assert.equal(paths.length, 3, '连续重试均应绕过60秒缓存');
    assert.equal(app.getModel().screen, 'home');
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('从其他邀请恢复前台时返回原房间，不清空连接或跳回授权页', async () => {
  const {app} = harness();
  try {
    await privacy.authorize(); await app.initialize(); api.setToken('test-user');
    const requests: string[] = [];
    const room = {room: {id: 7, room_code: '1234', stage_id: 1, status: 'waiting'}, players: [{user_id: 1, is_self: true, is_host: 1}]};
    Reflect.set(Reflect.get(globalThis, 'wx'), 'request', (options: {url: string; success: (response: unknown) => void}) => {
      requests.push(options.url);
      const invalid = options.url.includes('9999');
      options.success({statusCode: invalid ? 404 : 200, data: {code: invalid ? 404 : 0, message: '房间不存在', data: room}});
    });
    await app.dispatch({type: 'create-online'});
    assert.equal(app.getModel().online.room?.id, '7');
    app.hide(); await app.show({roomCode: '9999'});
    assert.equal(app.getModel().screen, 'room');
    assert.equal(app.getModel().online.room?.id, '7');
    assert.ok(requests.every((url) => !url.includes('9999')));
    assert.match(app.getModel().error, /已返回当前联机房间/);
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});



test('每日任务支持游客提示、账号进度刷新和异常数据反馈', async () => {
  const {app} = harness();
  try {
    await privacy.authorize(); await app.initialize();
    await app.dispatch({type: 'tasks'});
    assert.equal(app.getModel().screen, 'tasks');
    assert.equal(app.getModel().dailyTasks, undefined);
    api.setToken('task-user');
    const data = {date: '2026-10-30', tasks: [{id: 'play1', title: '完成 1 局', target: 1, progress: 1, reward: 20, claimed: false}]};
    Reflect.set(Reflect.get(globalThis, 'wx'), 'request', (options: {success: (response: unknown) => void}) => {
      options.success({statusCode: 200, data: {code: 0, data}});
    });
    await app.dispatch({type: 'refresh'});
    assert.deepEqual(app.getModel().dailyTasks, data);
    data.tasks[0].progress = -1;
    await app.dispatch({type: 'refresh'});
    assert.match(app.getModel().error, /任务数据异常/);
    assert.equal(app.getModel().dailyTasks, undefined);
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('小游戏签到、成长领取与经验榜使用服务端结果，换号不展示旧成长', async () => {
  const {app} = harness();
  const retention = {date: '2026-11-14', level: 1, totalExp: 100, games: 1, wins: 0,
    checkin: {claimed: false, streak: 0, day: 1, reward: 20, calendar: [20, 25, 30, 35, 40, 45, 60].map((reward, index) => ({day: index + 1, reward, current: index === 0, claimed: false}))},
    milestones: [{id: 'first_game', title: '初次接福', target: 1, progress: 1, reward: 50, claimed: false}]};
  let coins = 100; const paths: string[] = [];
  Reflect.set(Reflect.get(globalThis, 'wx'), 'request', (options: {url: string; data?: unknown; success: (response: unknown) => void}) => {
    paths.push(options.url); let data: unknown = {};
    if (options.url.includes('/configs/public')) data = {configs: {}, features: {api: {retention: true}}};
    else if (options.url.includes('/tasks')) data = {date: retention.date, tasks: [], retention};
    else if (options.url.includes('/retention/')) {
      assert.deepEqual(options.data, {});
      if (options.url.includes('/checkin')) {retention.checkin.claimed = true; coins += 20;}
      else {retention.milestones[0].claimed = true; coins += 50;}
      data = {alreadyClaimed: false, reward: options.url.includes('/checkin') ? 20 : 50, coins};
    } else if (options.url.includes('/shop/inventory')) data = [];
    else if (options.url.includes('/user/profile')) data = {id: 7, coins, nickName: '验收玩家'};
    else if (options.url.includes('/leaderboard')) data = [{id: 7, nickName: '验收玩家', totalExp: 100, level: 1}];
    options.success({statusCode: 200, data: {code: 0, data}});
  });
  try {
    await privacy.authorize(); await app.initialize(); api.setToken('growth-account');
    await app.dispatch({type: 'tasks'}); assert.equal(app.getModel().dailyTasks?.retention?.checkin.claimed, false);
    assert.ok(paths.some((path) => path.includes('includeRetention=1')));
    await app.dispatch({type: 'claim-retention', value: 'checkin'});
    assert.equal(app.getModel().dailyTasks?.retention?.checkin.claimed, true); assert.equal(app.getModel().inventory.coins, 120);
    await app.dispatch({type: 'claim-retention', value: 'first_game'});
    assert.equal(app.getModel().dailyTasks?.retention?.milestones[0].claimed, true); assert.equal(app.getModel().inventory.coins, 170);
    await app.dispatch({type: 'leaderboard'}); assert.equal(app.getModel().leaderboard?.[0].totalExp, 100);
    api.setToken('another-growth-account');
    assert.equal(app.getModel().dailyTasks, undefined); assert.equal(app.getModel().leaderboard, undefined);
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('退出登录与撤回隐私授权不触发递归栈溢出且完整清理状态', async () => {
  const {app} = harness();
  Reflect.set(Reflect.get(globalThis, 'wx'), 'showModal', (options: {success: (res: {confirm: boolean}) => void}) => {
    options.success({confirm: true});
  });
  try {
    await privacy.authorize(); await app.initialize(); api.setToken('logout-user');
    await app.dispatch({type: 'logout'});
    assert.equal(api.isLoggedIn(), false);
    assert.equal(app.getModel().screen, 'profile');
    assert.equal(app.getModel().error, '');

    api.setToken('revoke-user');
    await app.dispatch({type: 'revoke'});
    assert.equal(api.isLoggedIn(), false);
    assert.equal(privacy.isAllowed(), false);
    assert.equal(app.getModel().screen, 'boot');
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('前台邀请码失效时保留已授权页面，不把用户踢回隐私授权页', async () => {
  const {app} = harness();
  Reflect.set(Reflect.get(globalThis, 'wx'), 'request', (options: {url: string; success: (response: unknown) => void}) => {
    if (options.url.includes('/configs/public')) {
      options.success({statusCode: 200, data: {code: 0, data: {configs: {}, features: {api: {onlineArena: true}}}}});
      return;
    }
    options.success({statusCode: 404, data: {code: 404, message: '房间不存在', data: null}});
  });
  try {
    await privacy.authorize(); await app.initialize(); api.setToken('invite-user');
    assert.equal(app.getModel().screen, 'home');
    app.hide();
    await app.show({roomCode: '9999'});
    assert.equal(app.getModel().screen, 'home');
    assert.equal(privacy.isAllowed(), true);
    assert.match(app.getModel().error, /房间不存在|加入房间失败/);
  } finally {app.dispose(); privacy.revoke(); Reflect.deleteProperty(globalThis, 'wx');}
});

test('全面屏下退出组队按钮位于快捷表情拦截区域上方', async () => {
  const {ArenaScene} = await import('../src/scenes/arena-scene');
  const {runFieldRect} = await import('../src/render/run-arena-renderer');
  local.__resetForTests();
  const safeTop = 100, safeBottom = 83, designHeight = 1558;
  let cleared = 0;
  const state = local.getState();
  state.status = 'playing';
  state.players = [{id: '1', name: '我', score: 0, avatar: '', isSelf: true, isBot: false, skinId: 'skin-default', ringId: '', petId: ''}];
  state.runWorld = {
    elapsedMs: 1000, durationMs: 120000, sprint: false, drops: [], effects: [], nextId: 1,
    runners: [{id: '1', name: '我', x: 100, y: 100, dx: 0, dy: 0, score: 0, targetId: '2', mateId: '', boosted: false, combo: 0, lastPickupMs: 0, shieldUntilMs: 0, speedUntilMs: 0, magnetUntilMs: 0, stats: {bags: 0, gifts: 0, bombs: 0, teamEvents: 0, teamGain: 0}}],
  };
  const scene = new ArenaScene({
    width: 720, height: designHeight, offsetY: safeTop + 48, safeBottom,
    source: {
      getState: () => state, subscribe: () => () => {},
      setRunDirection: () => {}, setSelfTeam: () => {},
      clearSelfTeam: () => {cleared++;},
    },
  });
  const rect = runFieldRect(720, designHeight - 100 - safeBottom, safeTop + 48 + 140);
  const exitTop = rect.y + rect.height + 42;
  const exitBottom = exitTop + 48;
  const emoteInterceptTop = designHeight - safeBottom - 106;
  assert.ok(exitBottom <= emoteInterceptTop, `exitBottom (${exitBottom}) should be <= emoteInterceptTop (${emoteInterceptTop})`);
  assert.equal(scene.handleTap(360, exitTop + 24), true);
  assert.equal(cleared, 1);
  scene.dispose();
});
