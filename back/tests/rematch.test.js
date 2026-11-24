const test = require('node:test');
const assert = require('node:assert/strict');

function harness({status = 'finished', latest = 9, member = true, participant = true, sessionStatus = 'finished', missingRoom = false, failReady = false} = {}) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/room-service');
  const room = {id: 7, room_code: '1234', stage_id: 2, status, host_user_id: 1};
  const players = [{user_id: 1, is_host: 1, is_ready: 1}, {user_id: 2, is_host: 0, is_ready: 1}];
  let resets = 0, commits = 0, rollbacks = 0, released = 0;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {commits++;}, rollback: async () => {rollbacks++;}, release: () => {released++;},
    async execute(sql, params) {
      if (/SELECT id, deleted_at/.test(sql)) return [[{id: params[0]}]];
      if (/SELECT gs.id/.test(sql)) return [participant ? [{id: 9, room_id: 7, status: sessionStatus}] : []];
      if (/SELECT \* FROM rooms/.test(sql)) return [missingRoom ? [] : [{...room}]];
      if (/SELECT \* FROM room_players/.test(sql)) return [member ? [players.find((p) => p.user_id === params[1])] : []];
      if (/SELECT id FROM game_sessions/.test(sql)) return [[{id: latest}]];
      if (/UPDATE rooms SET status/.test(sql)) room.status = 'waiting';
      if (/UPDATE room_players SET is_ready = 0/.test(sql)) {resets++; players.forEach((p) => {p.is_ready = 0;});}
      if (/UPDATE room_players SET is_ready = 1/.test(sql)) {
        if (failReady) throw new Error('数据库暂不可用');
        players.find((p) => p.user_id === params[1]).is_ready = 1;
      }
      return [{affectedRows: 1}];
    },
  };
  const db = {execute: async () => [{affectedRows: 1}], pool: {getConnection: async () => connection}, queryOne: async () => ({...room}), queryAll: async () => players.map((p) => ({...p}))};
  delete require.cache[servicePath];
  require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: db};
  const service = require(servicePath);
  return {service, room, players, counts: () => ({resets, commits, rollbacks, released})};
}

test('原房续玩保留房号、景区和成员，只准备主动点击的玩家；重试不重置其他人', async () => {
  const h = harness();
  const first = await h.service.rematch(9, 2);
  assert.equal(first.room.id, 7); assert.equal(first.room.room_code, '1234'); assert.equal(first.room.stage_id, 2);
  assert.equal(first.room.status, 'waiting'); assert.equal(first.sessionId, null);
  assert.deepEqual(first.players.map((p) => p.is_ready), [0, 1]);
  await h.service.rematch(9, 1);
  await h.service.rematch(9, 2);
  assert.deepEqual(h.players.map((p) => p.is_ready), [1, 1]);
  assert.deepEqual(h.counts(), {resets: 1, commits: 3, rollbacks: 0, released: 3});
});

test('未结算、旧场次和进行中房间不能被续玩请求重置', async () => {
  for (const options of [{sessionStatus: 'playing'}, {latest: 10}, {status: 'playing'}]) {
    const h = harness(options);
    await assert.rejects(h.service.rematch(9, 1), {statusCode: 409});
    assert.equal(h.counts().resets, 0); assert.equal(h.counts().rollbacks, 1); assert.equal(h.counts().released, 1);
  }
});

test('未参赛账号不可探查对局，已离房或原房解散有明确恢复状态', async () => {
  for (const [options, statusCode] of [[{participant: false}, 404], [{member: false}, 410], [{missingRoom: true}, 410]]) {
    const h = harness(options);
    await assert.rejects(h.service.rematch(9, 1), {statusCode});
    assert.equal(h.counts().commits, 0); assert.equal(h.counts().resets, 0);
  }
});

test('续玩写入失败时回滚并释放连接', async () => {
  const h = harness({failReady: true});
  await assert.rejects(h.service.rematch(9, 1), /数据库暂不可用/);
  assert.equal(h.counts().commits, 0); assert.equal(h.counts().rollbacks, 1); assert.equal(h.counts().released, 1);
});
