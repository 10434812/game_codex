const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ suggest = 'pass', errcode = 0, expired = false, active = true, banned = false, latest = 1, copyError, failWrite = false, oldFilename } = {}) {
  const files = [];
  const writes = [];
  const row = { id: 1, user_id: 7, filename: '7_test.png', avatar_url: 'https://example.com/uploads/avatars/7_test.png', status: 'pending', is_valid: expired ? 0 : 1, expires_at: new Date(Date.now() + (expired ? -1000 : 60000)) };
  const user = { id: 7, avatar_url: oldFilename ? `https://example.com/uploads/avatars/${oldFilename}` : '' };
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params) => {
      if (sql.startsWith('SELECT id, avatar_url FROM users')) return [active && (!sql.includes('is_banned = 0') || !banned) ? [user] : []];
      if (sql.startsWith('SELECT *') && sql.includes('FROM avatar_reviews')) return [[row]];
      if (sql.startsWith('SELECT id FROM avatar_reviews')) return [[{ id: latest }]];
      if (sql.startsWith('SELECT status FROM avatar_reviews')) return [[{ status: row.status }]];
      if (sql.startsWith('SELECT filename FROM avatar_reviews')) return [oldFilename ? [{ filename: oldFilename }] : []];
      if (sql.startsWith('UPDATE users')) {
        if (failWrite) throw new Error('database write failed');
        user.avatar_url = params[0];
      }
      writes.push({ sql, params });
      if (sql.startsWith('UPDATE avatar_reviews SET status')) row.status = params[0];
      return [{ affectedRows: 1 }];
    },
  };
  const db = { pool: { getConnection: async () => conn }, queryOne: async (sql) => sql.includes('SELECT user_id') ? { user_id: 7 } : { status: row.status } };
  const fileSystem = { constants: fs.constants, promises: {
    mkdir: async () => {},
    copyFile: async (...args) => {
      files.push({ operation: 'copy', args });
      if (copyError) throw Object.assign(new Error('copy failed'), { code: copyError });
    },
    unlink: async (...args) => files.push({ operation: 'unlink', args }),
  } };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../src/services/avatar-review-service.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Buffer, Date, __dirname: path.dirname(filename),
    require: (name) => name === 'fs' ? fileSystem : name === '../models/db' ? db : name === './content-safety-service' ? {} : require(name),
  }, { filename });
  const event = { Event: 'wxa_media_check', MsgType: 'event', version: 2, trace_id: 'trace-1', errcode, result: { suggest } };
  return { service: module.exports, event, files, writes, row };
}

test('only an explicit pass callback publishes quarantined bytes and persists the new avatar', async () => {
  const f = fixture();
  await f.service.applyEvent(f.event);
  assert.equal(f.files.filter((item) => item.operation === 'copy').length, 1);
  assert.equal(f.writes.filter((item) => item.sql.startsWith('UPDATE users')).length, 1);
  assert.equal(f.row.status, 'approved');
  await f.service.applyEvent(f.event);
  assert.equal(f.files.filter((item) => item.operation === 'copy').length, 1, 'callback replay cannot republish');
});

test('risky, review, download errors, expired, deleted and superseded submissions never publish', async () => {
  for (const options of [{ suggest: 'risky' }, { suggest: 'review' }, { errcode: -1008 }, { expired: true }, { active: false }, { banned: true }, { latest: 2 }]) {
    const f = fixture(options);
    await f.service.applyEvent(f.event);
    assert.equal(f.files.filter((item) => item.operation === 'copy').length, 0);
    assert.equal(f.writes.filter((item) => item.sql.startsWith('UPDATE users')).length, 0);
    assert.equal(f.row.status, 'rejected');
    assert.equal(f.files.filter((item) => item.operation === 'unlink' && item.args[0].includes('/private/avatar-reviews/')).length, 1);
  }
});

test('publication failures do not delete existing or concurrently retried public bytes', async () => {
  for (const options of [{ copyError: 'EIO' }, { failWrite: true }]) {
    const f = fixture(options);
    await assert.rejects(f.service.applyEvent(f.event));
    assert.equal(f.files.filter((item) => item.operation === 'unlink').length, 0);
    assert.equal(f.row.status, 'pending');
  }
  const retry = fixture({ copyError: 'EEXIST' });
  await retry.service.applyEvent(retry.event);
  assert.equal(retry.row.status, 'approved');
  assert.equal(retry.files.filter((item) => item.operation === 'unlink' && item.args[0].includes('/uploads/avatars/')).length, 0);
});

test('successful replacement withdraws previously approved avatar files', async () => {
  const f = fixture({ oldFilename: '7_old.png' });
  await f.service.applyEvent(f.event);
  assert.equal(f.row.status, 'approved');
  assert.ok(f.files.some((item) => item.operation === 'unlink' && item.args[0].endsWith('/uploads/avatars/7_old.png')));
});

test('database expiry remains authoritative when the driver renders DATETIME in another timezone', async () => {
  const f = fixture();
  f.row.expires_at = new Date(Date.now() - 8 * 60 * 60 * 1000);
  await f.service.applyEvent(f.event);
  assert.equal(f.row.status, 'approved');
  assert.equal(f.files.filter((item) => item.operation === 'copy').length, 1);
});

test('avatar submission strips source metadata before either review or publication', async () => {
  const sharp = require('sharp');
  const source = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#335577' } })
    .withExif({ IFD0: { Artist: 'private-camera-owner', ImageDescription: 'private-location' } }).jpeg().toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  let normalized;
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql) => sql.startsWith('SELECT') ? [[{ id: 7 }]] : [{ insertId: 1 }],
  };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../src/services/avatar-review-service.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Buffer, Date, __dirname: path.dirname(filename),
    require(name) {
      if (name === '../models/db') return { pool: { getConnection: async () => conn }, queryAll: async () => [], execute: async () => [{ affectedRows: 1 }] };
      if (name === './content-safety-service') return { callbackSettings: () => ({ baseUrl: 'https://example.com' }), checkImage: async () => 'accepted-trace' };
      if (name === 'fs') return { promises: { mkdir: async () => {}, writeFile: async (_file, bytes) => { normalized = bytes; }, unlink: async () => {} } };
      return require(name);
    },
  }, { filename });
  const pending = await module.exports.submit(7, 'openid', source);
  assert.equal(pending.avatarReview, 'pending');
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.width, 512);
  normalized = undefined;
  await assert.rejects(module.exports.submit(7, 'openid', Buffer.from([0xff, 0xd8, 0xff, 0])), { statusCode: 400 });
  assert.equal(normalized, undefined, 'invalid images are not persisted');
});
