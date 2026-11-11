import assert from 'node:assert/strict';
import test from 'node:test';
import {GameApplication} from '../src/GameApplication';
import {resolveViewport} from '../src/platform/device';
import * as privacy from '../src/core/PrivacyConsent';
import {legalConfig} from '../src/core/LegalConfig';
import * as local from '../src/core/GameStore';
import {rulesPanelLayout} from '../src/render/rules-panel';
import * as api from '../src/core/ApiClient';

function harness() {
  const storage = new Map<string, unknown>();
  let needsConsent = false;
  const audio = {src: '', loop: false, volume: 1, onError() {}, play() {}, pause() {}, stop() {}, destroy() {}};
  Reflect.set(globalThis, 'wx', {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    getPrivacySetting: (options: {success: (result: {needAuthorization: boolean}) => void}) => options.success({needAuthorization: needsConsent}),
    requirePrivacyAuthorize: (options: {success: () => void}) => options.success(),
    request: (options: {success: (result: unknown) => void}) => options.success({statusCode: 200, data: {code: 0, data: {configs: {}}}}),
    createInnerAudioContext: () => ({...audio}),
    vibrateShort() {},
    showToast() {},
    getLaunchOptionsSync: () => ({query: {}}),
  });
  privacy.revoke(); local.__resetForTests();
  Object.assign(legalConfig, {configured: true, operatorName: '测试主体', contact: '测试联系方式', effectiveDate: '2020-01-01',
    privacyVersion: 'test-p', agreementVersion: 'test-a', privacySections: [{heading: '测试', text: '测试'}], agreementSections: [{heading: '测试', text: '测试'}]});
  const app = new GameApplication(resolveViewport({windowWidth: 360, windowHeight: 780, screenWidth: 360, screenHeight: 780, pixelRatio: 2}));
  return {app, revokePlatform: () => {needsConsent = true;}};
}

test('小游戏入口要求主动授权，本地房间到结果和六页导航完成闭环', async () => {
  const {app} = harness();
  try {
    await app.initialize(); assert.equal(app.getModel().screen, 'boot');
    await app.dispatch({type: 'authorize'}); assert.equal(app.getModel().screen, 'home');
    await app.dispatch({type: 'create-local'}); assert.equal(app.getModel().screen, 'room');
    assert.equal(local.getState().players.length, 4);
    assert.equal(local.getState().players.filter((p) => p.isRobot).length, 3);
    await app.dispatch({type: 'start'}); assert.equal(app.getModel().screen, 'arena');
    assert.equal(local.getState().timeLeft, 120);
    const button = rulesPanelLayout(app.viewport).button;
    app.touchStart(10, 10); app.touchEnd(10, 10);
    assert.equal(local.getState().timeLeft, 120);
    app.touchStart(button.x + 20, button.y + 20); app.touchEnd(button.x + 20, button.y + 20);
    local.pauseGame();
    for (let i = 0; i < 120; i++) local.tick();
    assert.equal(app.getModel().screen, 'result'); assert.ok(app.getModel().result?.ranking.length);
    await app.dispatch({type: 'home'}); assert.equal(app.getModel().screen, 'home');
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
