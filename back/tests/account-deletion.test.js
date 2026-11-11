const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = '7_0123456789abcdef0123456789abcdef.png';
const publicFile = path.resolve(__dirname, '../uploads/avatars', filename);
const privateFile = path.resolve(__dirname, '../private/avatar-reviews', filename);

function harness(options = {}) {
  const state = {committed: false, rolledBack: false, released: false, writes: [], files: new Map(options.files || [])};
  const games = options.games || new Map();
  const conn = {
    async beginTransaction() {},
    async execute(sql, args) {
      state.writes.push({sql, args});
      if (sql.startsWith('SELECT id, nick_name')) return [[{id: 7, nick_name: '同名', avatar_url: options.avatar || '', deleted_at: null}]];
      if (sql.startsWith('SELECT room_id FROM room_players')) {
        const fresh = sql.includes('FOR UPDATE');
        return [fresh && options.currentRooms ? options.currentRooms : (options.rooms || [])];
      }
      if (sql.startsWith('SELECT user_id FROM room_players')) {
        const fresh = sql.includes('FOR UPDATE');
        return [(fresh && options.currentMembers) || options.members || []];
      }
      if (sql.startsWith('SELECT gs.id')) {
        if (options.settling && sql.includes('FOR UPDATE')) throw new Error('waiting on settlement would invert the user/session lock order');
        return [options.active ? [{id: 9}] : []];
      }
      if (sql.startsWith('SELECT DISTINCT session_id')) return [[{session_id: 9}]];
      if (sql.startsWith('SELECT id, result_json')) return [[{id: 3, result_json: options.result === undefined ? {ranking: [
        {id: '7', name: '历史昵称', avatar: 'old-avatar'},
        {id: '8', name: '同名', avatar: 'same-avatar'},
      ], top3: {first: {id: '7', name: '历史昵称', avatar: 'old-avatar'}}, title: '同名'} : options.result}]];
      if (sql.startsWith('SELECT id, events_json')) return [[{id: 4, events_json: [{actorId: '7', delta: 5}, {actorId: '8', actorName: '同名'}]}]];
      if (sql.startsWith('SELECT filename')) return [(options.reviews || []).map((name) => ({filename: name}))];
      if (options.writeError && sql.startsWith('UPDATE game_results')) throw new Error('write failed');
      return [{affectedRows: 1}];
    },
    async commit() { if (options.commitError) throw new Error('commit failed'); state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; },
  };
  const io = {
    async lstat(file) {
      if (!state.files.has(file)) throw Object.assign(new Error('missing'), {code: 'ENOENT'});
      return {isFile: () => true, isSymbolicLink: () => options.symlink === file};
    },
    async readFile(file) { return state.files.get(file); },
    async unlink(file) {
      if (options.unlinkError === file) throw Object.assign(new Error('denied'), {code: 'EACCES'});
      state.files.delete(file);
    },
    async writeFile(file, data) { assert.equal(state.files.has(file), false); state.files.set(file, data); },
  };
  const module = {exports: {}};
  const deps = {
    '../models/db': {pool: {getConnection: async () => conn}},
    './content-safety-service': {}, './game-service': {getActiveGames: () => games},
    fs: {promises: io}, path,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/user-service.js'), 'utf8'), {
    module, exports: module.exports, require(name) { if (!(name in deps)) throw new Error(name); return deps[name]; },
    __dirname: path.resolve(__dirname, '../src/services'), URL, clearTimeout, AggregateError,
  });
  return {service: module.exports, state, games};
}

test('deletion sanitizes identities including historical names without changing another same-name player', async () => {
  const h = harness({games: new Map([[9, {status: 'finished', players: [{id: '7', name: '历史昵称'}]}]])});
  await h.service.deleteAccount(7);
  const result = JSON.parse(h.state.writes.find(({sql}) => sql.startsWith('UPDATE game_results')).args[0]);
  assert.equal(result.ranking[0].name, '已注销用户');
  assert.equal(result.ranking[0].avatar, '');
  assert.equal(result.top3.first.name, '已注销用户');
  assert.equal(result.ranking[1].name, '同名');
  assert.equal(result.ranking[1].avatar, 'same-avatar');
  assert.equal(result.title, '同名');
  assert.equal(h.games.size, 0);
  assert.equal(h.state.committed, true);
  assert.equal(h.state.released, true);
});

for (const options of [{result: '{bad-json'}, {writeError: true}]) {
  test(`deletion rolls back rather than swallowing ${options.writeError ? 'anonymization write errors' : 'invalid JSON'}`, async () => {
    const h = harness(options);
    await assert.rejects(h.service.deleteAccount(7));
    assert.equal(h.state.committed, false);
    assert.equal(h.state.rolledBack, true);
    assert.equal(h.state.writes.some(({sql}) => sql.startsWith('UPDATE users SET openid')), false);
  });
}

for (const options of [{active: true}, {games: new Map([[9, {status: 'playing', players: [{id: '7'}]}]])}]) {
  test('deletion refuses active DB or memory games before changing private data', async () => {
    const h = harness(options);
    await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
    assert.equal(h.state.committed, false);
    assert.equal(h.state.rolledBack, true);
    assert.equal(h.state.writes.some(({sql}) => sql.startsWith('UPDATE game_results')), false);
  });
}

test('deletion removes owned public and pending avatar bytes and ownership rows', async () => {
  const h = harness({reviews: [filename], avatar: `https://example.test/uploads/avatars/${filename}`, files: [[publicFile, Buffer.from('public')], [privateFile, Buffer.from('pending')]]});
  await h.service.deleteAccount(7);
  assert.equal(h.state.files.size, 0);
  assert.ok(h.state.writes.some(({sql}) => sql.startsWith('DELETE FROM avatar_reviews')));
  assert.equal(h.state.committed, true);
});

test('failed commit restores removed avatar bytes and leaves cached identities intact', async () => {
  const games = new Map([[9, {status: 'finished', players: [{id: '7'}]}]]);
  const h = harness({reviews: [filename], files: [[publicFile, Buffer.from('original')]], commitError: true, games});
  await assert.rejects(h.service.deleteAccount(7), /commit failed/);
  assert.equal(h.state.files.get(publicFile).toString(), 'original');
  assert.equal(h.state.rolledBack, true);
  assert.equal(games.size, 1);
});

test('avatar unlink failure aborts deletion and restores previously removed files', async () => {
  const h = harness({reviews: [filename], files: [[publicFile, Buffer.from('public')], [privateFile, Buffer.from('pending')]], unlinkError: privateFile});
  await assert.rejects(h.service.deleteAccount(7), /denied/);
  assert.equal(h.state.files.size, 2);
  assert.equal(h.state.committed, false);
});

for (const unowned of ['8_0123456789abcdef0123456789abcdef.png', '../../secret', 'legacy.png']) {
  test(`deletion cannot follow an invalid ownership filename: ${unowned}`, async () => {
    const h = harness({reviews: [unowned]});
    await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
    assert.equal(h.state.committed, false);
  });
}

test('legacy URL alone does not authorize deleting a local file', async () => {
  const legacyFile = path.resolve(__dirname, '../uploads/avatars/legacy.png');
  const h = harness({avatar: 'https://other.test/uploads/avatars/legacy.png', files: [[legacyFile, Buffer.from('not verified')]]});
  await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
  assert.equal(h.state.files.get(legacyFile).toString(), 'not verified');
});

test('deletion refuses symlink avatars instead of reading or deleting their target', async () => {
  const h = harness({reviews: [filename], files: [[publicFile, Buffer.from('secret')]], symlink: publicFile});
  await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
  assert.equal(h.state.files.get(publicFile).toString(), 'secret');
});

test('deletion locks all candidate users in ascending order before locking any room', async () => {
  const h = harness({
    rooms: [{room_id: 2}, {room_id: 9}],
    members: [{user_id: 11}, {user_id: 3}, {user_id: 7}],
  });
  await h.service.deleteAccount(7);
  const locks = h.state.writes.filter(({sql}) => sql === 'SELECT id FROM users WHERE id = ? FOR UPDATE');
  assert.deepEqual(locks.map(({args}) => args[0]), [3, 7, 11]);
  const firstRoom = h.state.writes.findIndex(({sql}) => sql === 'SELECT id FROM rooms WHERE id = ? FOR UPDATE');
  const lastUser = h.state.writes.findLastIndex(({sql}) => sql.includes('FROM users') && sql.includes('FOR UPDATE'));
  assert.ok(lastUser < firstRoom);
  assert.equal(h.state.committed, true);
});

for (const change of [
  {currentRooms: [{room_id: 2}, {room_id: 9}]},
  {currentMembers: [{user_id: 7}, {user_id: 1}]},
]) {
  test('deletion retries safely if a concurrent join changed its discovery snapshot', async () => {
    const h = harness({rooms: [{room_id: 2}], members: [{user_id: 7}], ...change});
    await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
    assert.equal(h.state.committed, false);
    assert.equal(h.state.writes.some(({sql}) => sql.startsWith('UPDATE game_results')), false);
    assert.equal(h.state.writes.some(({sql}) => sql.startsWith('DELETE FROM room_players')), false);
  });
}

test('deletion refuses a settling active game without waiting for its session lock', async () => {
  const h = harness({active: true, settling: true});
  await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
  assert.equal(h.state.committed, false);
  assert.equal(h.state.writes.some(({sql}) => sql.startsWith('UPDATE users SET openid')), false);
});

test('encoded legacy avatar references cannot leave local bytes behind after successful deletion', async () => {
  const legacyFile = path.resolve(__dirname, '../uploads/avatars/legacy.png');
  const h = harness({avatar: 'https://other.test/uploads/avatars/legacy%2epng', files: [[legacyFile, Buffer.from('unverified')]]});
  await assert.rejects(h.service.deleteAccount(7), {statusCode: 409});
  assert.equal(h.state.committed, false);
  assert.equal(h.state.files.has(legacyFile), true);
});
