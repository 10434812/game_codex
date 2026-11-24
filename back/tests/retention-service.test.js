const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models/db');
const service = require('../src/services/retention-service');
const {STAGES} = require('../src/game-engine/constants');
const now = () => new Date('2026-11-14T08:00:00Z');
function fixture(t) {
  let state = {coins: 100, game_count: 0, win_count: 0, total_exp: 0, checkins: [], growth: {}, ledger: [], visits: []};
  let snapshot, failLedger = false, deleted = false, releases = 0;
  const user = () => ({...state, level: 1});
  const conn = {
    beginTransaction: async () => {snapshot = structuredClone(state);}, commit: async () => {},
    rollback: async () => {state = snapshot;}, release: () => {releases++;},
    execute: async (sql, values) => {
      if (sql.startsWith('SELECT coins')) return [deleted ? [] : [user()]];
      if (sql.startsWith('SELECT DATE_FORMAT')) return [[...state.checkins].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1)];
      if (sql.startsWith('SELECT reward')) return [state.growth[values[1]] ? [{reward: state.growth[values[1]]}] : []];
      if (sql.startsWith('INSERT INTO daily_checkins')) {state.checkins.push({date: values[1], streak: values[2], reward: values[3]}); return [{affectedRows: 1}];}
      if (sql.startsWith('INSERT INTO growth_claims')) {state.growth[values[1]] = values[2]; return [{affectedRows: 1}];}
      if (sql.startsWith('UPDATE users')) {state.coins += values[0]; return [{affectedRows: 1}];}
      if (sql.startsWith('INSERT INTO coin_records')) {if (failLedger) throw new Error('ledger_failed'); state.ledger.push(values); return [{affectedRows: 1}];}
      throw new Error(sql);
    },
  };
  t.mock.method(db.pool, 'getConnection', async () => conn);
  t.mock.method(db, 'queryOne', async (sql) => sql.startsWith('SELECT coins') ? deleted ? null : user() : [...state.checkins].sort((a, b) => b.date.localeCompare(a.date))[0] || null);
  t.mock.method(db, 'queryAll', async (sql, values) => {
    if (sql.includes('game_players')) {
      assert.deepEqual(values, [7]);
      assert.match(sql, /players\.user_id = \? AND players\.`rank` IS NOT NULL AND sessions\.status = 'finished'/);
      return state.visits;
    }
    return Object.keys(state.growth).map((milestone_id) => ({milestone_id}));
  });
  return {get state() {return state;}, fail(value) {failLedger = value;}, deleteUser() {deleted = true;}, releases: () => releases};
}
test('签到以北京时间零点切日，每7日循环，中断重置，未来日期拒绝领取', () => {
  const state = service.checkinState;
  assert.equal(state(null, new Date('2026-11-14T15:59:59Z')).day, 1);
  const previous = {date: '2026-11-14', streak: 7, reward: 60};
  assert.equal(state(previous, new Date('2026-11-14T15:59:59Z')).claimed, true);
  const next = state(previous, new Date('2026-11-14T16:00:00Z'));
  assert.equal(next.claimed, false); assert.equal(next.day, 1); assert.equal(next.streak, 7); assert.equal(next.reward, 20);
  assert.equal(state(previous, new Date('2026-11-16T16:00:00Z')).streak, 0);
  assert.throws(() => state({date: '2026-11-18', streak: 8, reward: 20}, now()), {statusCode: 409});
});
test('签到重复请求返回已有回执，不重复发币或写流水', async (t) => {
  const h = fixture(t);
  const first = await service.claimCheckin(7, {now}); const repeated = await service.claimCheckin(7, {now});
  assert.equal(first.alreadyClaimed, false); assert.equal(first.reward, 20); assert.equal(first.coins, 120);
  assert.equal(repeated.alreadyClaimed, true); assert.equal(h.state.coins, 120);
  assert.equal(h.state.ledger.length, 1); assert.equal(h.state.checkins.length, 1); assert.equal(h.releases(), 2);
});
test('流水写入失败回滚签到记录、余额和奖励，重试仍可正常领取', async (t) => {
  const h = fixture(t); h.fail(true);
  await assert.rejects(service.claimCheckin(7, {now}), /ledger_failed/);
  assert.equal(h.state.coins, 100); assert.equal(h.state.checkins.length, 0);
  h.fail(false); await service.claimCheckin(7, {now}); assert.equal(h.state.coins, 120); assert.equal(h.state.ledger.length, 1);
});
test('成长目标只认服务端进度，领取一次；未达标、未知目标和失效账号不能领', async (t) => {
  const h = fixture(t);
  await assert.rejects(service.claimMilestone(7, 'first_game'), {statusCode: 409});
  await assert.rejects(service.claimMilestone(7, 'unknown'), {statusCode: 404});
  await assert.rejects(service.claimMilestone(7, ''), {statusCode: 404});
  h.state.game_count = 1;
  await service.claimMilestone(7, 'first_game'); await service.claimMilestone(7, 'first_game');
  assert.equal(h.state.coins, 150); assert.equal(h.state.ledger.length, 1);
  const summary = await service.getSummary(7, {now});
  assert.equal(summary.milestones[0].claimed, true); assert.equal(summary.milestones[1].progress, 1);
  h.deleteUser(); await assert.rejects(service.claimCheckin(7, {now}), {statusCode: 401});
});
test('景区护照展示首次结算印章、未探索推荐以及集齐徽章', async (t) => {
  const h = fixture(t);
  const read = async (sessionId) => (await service.getSummary(7, {now, sessionId})).passport;
  assert.equal((await read()).stampedCount, 0);
  assert.equal((await read()).nextStage.id, STAGES[0].id);
  h.state.visits = [{stage_id: STAGES[0].id, session_id: 91}, {stage_id: 9999, session_id: 94}];
  const first = await read(91);
  assert.equal(first.stampedCount, 1);
  assert.equal(first.newStamp.id, STAGES[0].id);
  assert.equal(first.nextStage.id, STAGES[1].id);
  assert.equal((await read(92)).newStamp, null);
  assert.equal((await read(94)).newStamp, null);
  h.state.visits = STAGES.map(({id}, index) => ({stage_id: id, session_id: 100 + index}));
  const full = await read(100 + STAGES.length - 1);
  assert.equal(full.badge, true);
  assert.equal(full.nextStage, null);
  assert.equal(full.stampedCount, STAGES.length);
});
