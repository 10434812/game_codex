import test from 'node:test';
import assert from 'node:assert/strict';
import {PrimaryTouch} from '../src/platform/PrimaryTouch';
import {SnapshotInterpolator} from '../src/core/SnapshotInterpolator';
import {createRunWorld, FIELD} from '../src/core/RunArena';
import {AnalyticsQueue} from '../src/core/Analytics';
const touch = (id: number) => ({identifier: id, clientX: id * 10, clientY: 10});
test('secondary finger cannot steal movement or stop primary; no automatic handover', () => {
  const input = new PrimaryTouch(), one = touch(1), two = touch(2);
  assert.equal(input.start({changedTouches: [one], touches: [one]}), one);
  assert.equal(input.start({changedTouches: [two], touches: [one, two]}), null);
  assert.equal(input.move({changedTouches: [two], touches: [one, two]}), null);
  assert.equal(input.end({changedTouches: [two], touches: [one]}), null);
  assert.equal(input.move({changedTouches: [one], touches: [one]}), one);
  assert.equal(input.end({changedTouches: [one], touches: [two]}), one);
  assert.equal(input.move({changedTouches: [two], touches: [two]}), null);
  input.start({changedTouches: [one], touches: [one]}); input.reset();
  assert.equal(input.move({changedTouches: [one], touches: [one]}), null);
});
test('remote snapshots interpolate by id, new drops appear immediately and source stays immutable', () => {
  const player = {id: 'a', name: 'a', score: 100, teamId: null};
  const before = createRunWorld([player]), next = createRunWorld([player]);
  before.elapsedMs = 100; next.elapsedMs = 200; before.runners[0].x = 100; next.runners[0].x = 200;
  next.drops = [{id: 'new', kind: 'bag', value: 10, x: 50, y: 50, warningUntil: 0, speed: 0}];
  const source = JSON.stringify([before, next]);
  const buffer = new SnapshotInterpolator(); buffer.push(before, 1000); buffer.push(next, 1100);
  assert.equal(buffer.sample('', 1100)!.runners[0].x, 100);
  assert.equal(buffer.sample('', 1150)!.runners[0].x, 150);
  assert.equal(buffer.sample('', 1200)!.runners[0].x, 200);
  assert.equal(buffer.sample('', 1150)!.drops[0].x, 50);
  assert.equal(JSON.stringify([before, next]), source);
  buffer.push(before, 1250); assert.equal(buffer.sample('', 1300)!.elapsedMs, 200);
});
test('self prediction stays within bounds, expires on stale network, resets between sessions', () => {
  const world = createRunWorld([{id: 'a', name: 'a', score: 100, teamId: null}]);
  world.runners[0].x = FIELD.width - FIELD.radius - 1;
  const buffer = new SnapshotInterpolator(); buffer.push(world, 1000); buffer.input(100, 0, 1000);
  assert.equal(buffer.sample('a', 1100)!.runners[0].x, FIELD.width - FIELD.radius);
  assert.equal(buffer.sample('a', 2000)!.runners[0].x, world.runners[0].x);
  buffer.reset(); assert.equal(buffer.sample('a', 2000), null);
});
test('self responds before the next snapshot and ignores old moving snapshots after release', () => {
  const world = createRunWorld([{id: 'a', name: 'a', score: 100, teamId: null}]);
  const buffer = new SnapshotInterpolator();
  buffer.push(world, 1000, 'a');
  const start = world.runners[0].x;
  buffer.input(1, 0, 1000);
  const moved = buffer.sample('a', 1016)!.runners[0].x;
  assert.ok(moved > start);
  buffer.input(-1, 0, 1016);
  const stopped = buffer.sample('a', 1032)!.runners[0].x;
  assert.ok(stopped < moved);
  buffer.input(0, 0, 1032);
  const late = {...world, elapsedMs: 100, runners: [{...world.runners[0], x: start + 20, dx: 1}]};
  buffer.push(late, 1140, 'a');
  assert.equal(buffer.sample('a', 1198)!.runners[0].x, stopped);
  const confirmed = {...late, elapsedMs: 200, runners: [{...late.runners[0], dx: 0}]};
  buffer.push(confirmed, 1200, 'a');
  assert.ok(buffer.sample('a', 1214)!.runners[0].x > stopped);
});
test('mini-game analytics respects consent, preserves retry batch, separates tokens and discards', async (t) => {
  let allowed = false, token = 'a', succeed = false;
  const sent: {body: unknown; token: string}[] = [];
  const queue = new AnalyticsQueue({allowed: () => allowed, token: () => token, device: () => 'test_device', send: async (body, auth) => {sent.push({body, token: auth}); return succeed;}});
  t.after(() => queue.discard()); queue.track('app_launch'); assert.equal(await queue.flush(), false); assert.equal(sent.length, 0);
  allowed = true; queue.track('game_start', {sessionId: '7', openid: 'secret'});
  assert.equal(await queue.flush(), false); assert.equal(sent[0].token, '');
  succeed = true; await queue.flush(); assert.deepEqual(sent[1], sent[0]);
  token = 'b'; queue.track('game_finish', {sessionId: '7'});
  await queue.flush(); assert.equal(sent[2].token, 'a'); assert.equal(JSON.stringify(sent[2]).includes('openid'), false);
  await queue.flush(); assert.equal(sent[3].token, 'b');
  queue.track('home_view'); queue.discard(); assert.equal(await queue.flush(), false);
});

test('platform hooks share current room, release image memory and apply updates only after confirmation', async (t) => {
  const {installPlatformLifecycle} = await import('../src/platform/lifecycle');
  const original = Reflect.get(globalThis, 'wx');
  let share: () => {title: string; query: string} = () => ({title: '', query: ''});
  let memory = () => {}, ready = () => {}, cleared = 0, applied = 0;
  let confirm: (result: {confirm: boolean}) => void = () => {};
  Reflect.set(globalThis, 'wx', {
    onShareAppMessage(callback: typeof share) {share = callback;}, onShareTimeline() {}, showShareMenu() {},
    onMemoryWarning(callback: () => void) {memory = callback;}, onError() {},
    getUpdateManager: () => ({onUpdateReady(callback: () => void) {ready = callback;}, applyUpdate() {applied++;}}),
    showModal(options: {success: typeof confirm}) {confirm = options.success;},
  });
  t.after(() => Reflect.set(globalThis, 'wx', original));
  installPlatformLifecycle(() => ({title: '锦鲤前程', query: 'roomCode=1234'}), () => {cleared++;}, () => {});
  assert.equal(share().query, 'roomCode=1234'); memory(); assert.equal(cleared, 1);
  ready(); confirm({confirm: false}); assert.equal(applied, 0); confirm({confirm: true}); assert.equal(applied, 1);
  Reflect.set(globalThis, 'wx', {}); assert.doesNotThrow(() => installPlatformLifecycle(share, () => {}, () => {}));
});
