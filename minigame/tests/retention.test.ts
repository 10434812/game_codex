import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRetention} from '../src/core/Retention';
const summary = () => ({date: '2026-11-14', level: 1, totalExp: 0, games: 0, wins: 0,
  checkin: {claimed: false, streak: 0, day: 1, reward: 20, calendar: [20, 25, 30, 35, 40, 45, 60].map((reward, index) => ({day: index + 1, reward, current: index === 0, claimed: false}))},
  milestones: [{id: 'first_game', title: '初次接福', target: 1, progress: 0, reward: 50, claimed: false}]});
test('成长数据解析保留服务端状态，拒绝超范围天数、虚假数值和领取状态', () => {
  const input = summary(); assert.deepEqual(parseRetention(input), input);
  for (const update of [(data: ReturnType<typeof summary>) => {data.checkin.day = 8;},
    (data: ReturnType<typeof summary>) => {data.milestones[0].progress = 99;},
    (data: ReturnType<typeof summary>) => {data.totalExp = NaN;},
    (data: ReturnType<typeof summary>) => {data.checkin.calendar = [];},
    (data: ReturnType<typeof summary>) => {Reflect.set(data.checkin, 'claimed', 'true');}]) {
    const malformed = summary(); update(malformed); assert.throws(() => parseRetention(malformed), /异常/);
  }
});
test('景区护照保留印章、徽章和结算推荐', () => {
  const stamp = {id: 1, name: '万里长城', stamped: true};
  const next = {id: 2, name: '富士山', stamped: false};
  const passport = {stages: [stamp, next], stampedCount: 1, badge: false, newStamp: stamp, nextStage: next};
  assert.deepEqual(parseRetention({...summary(), passport}).passport, passport);
});
