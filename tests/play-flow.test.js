const test = require('node:test');
const assert = require('node:assert/strict');
const {PlayFlowTracker} = require('../utils/play-flow');
function fixture() {
  let now = 10000, owner = 'account-a'; const events = [];
  const tracker = new PlayFlowTracker({track: (name, props) => events.push({name, props}), owner: () => owner, now: () => now});
  return {tracker, events, time: (value) => {now = value;}, owner: (value) => {owner = value;}};
}
test('排队耗时从确认入队计算，服务端机器人席位与真人分开，重复快照不重复开局', () => {
  const h = fixture(), a = h.tracker.begin(1);
  h.time(10500); h.tracker.queued(a, 'room-1'); h.tracker.background('room-1');
  h.time(18500); h.tracker.started('room-1', 'game-2', [{isRobot: false}, {isRobot: false}, {isRobot: true}, {isRobot: true}]);
  h.tracker.started('room-1', 'game-2', [{isRobot: false}]);
  const starts = h.events.filter(e => e.name === 'match_started');
  assert.equal(starts.length, 1); assert.equal(starts[0].props.waitMs, 8000);
  assert.equal(starts[0].props.botCount, 2); assert.equal(starts[0].props.humanCount, 2);
  assert.equal(h.events.some(e => e.name === 'match_cancel'), false);
});
test('复玩必须关联新场次，好友续玩不混入快速匹配次数', () => {
  const h = fixture(), a = h.tracker.begin(2, false, 'game-1'); h.tracker.queued(a, 'room-1');
  h.tracker.started('room-1', 'game-1', [{isRobot: false}]);
  h.tracker.started('room-1', 'game-2', []);
  assert.deepEqual(h.events.map(e => e.name), ['replay_click']);
  h.tracker.started('room-1', 'game-2', [{isRobot: false}]);
  assert.deepEqual(h.events.map(e => e.name), ['replay_click', 'replay_started']);
  assert.equal(h.events[1].props.sourceSessionId, 'game-1');
  assert.equal(h.events[1].props.attemptId, a.id);
});
test('取消和失败是终态；失败原因使用枚举，不记录凭证或原始异常', () => {
  const h = fixture(), a = h.tracker.begin(1, true, 'game-1'); h.tracker.queued(a, 'room-1');
  h.tracker.cancel('room-1'); h.tracker.started('room-1', 'game-2', [{}]);
  assert.equal(h.events.filter(e => e.name === 'match_cancel').length, 1);
  assert.equal(h.events.filter(e => e.name === 'replay_started').length, 0);
  const failed = h.tracker.begin(1); h.tracker.failed(failed, {statusCode: 429, message: 'Bearer private'});
  h.tracker.failed(failed, {statusCode: 500});
  assert.equal(h.events.filter(e => e.name === 'match_failed').length, 1);
  assert.equal(h.events.at(-1).props.reason, 'rate_limited');
  assert.equal(JSON.stringify(h.events).includes('private'), false);
});
test('换号后的旧排队响应和旧开局不计入新账号', () => {
  const h = fixture(), a = h.tracker.begin(1); h.tracker.queued(a, 'room-1');
  const before = h.events.length; h.owner('account-b');
  h.tracker.started('room-1', 'game-2', [{}]); h.tracker.failed(a, new Error('late'));
  assert.equal(h.events.length, before);
});
