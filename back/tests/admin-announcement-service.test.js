const test = require('node:test');
const assert = require('node:assert/strict');

function loadService(dbStub) {
  const dbPath = require.resolve('../src/models/db');
  const servicePath = require.resolve('../src/services/admin-announcement-service');
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: dbStub,
  };
  return require('../src/services/admin-announcement-service');
}

function createDbStub() {
  const calls = [];
  const rows = [
    {
      id: 2, title: '维护通知', content: '今晚维护', type: 'maintenance',
      status: 'published', priority: 'urgent', created_by: 1,
      published_at: '2026-05-01 10:00:00',
    },
    {
      id: 1, title: '活动公告', content: '双倍金币', type: 'event',
      status: 'published', priority: 'normal', created_by: 1,
      published_at: '2026-05-01 09:00:00',
    },
  ];
  const dbStub = {
    queryAll: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM announcements/.test(sql)) return rows;
      return [];
    },
    queryOne: async () => null,
    execute: async () => [{ affectedRows: 1 }, []],
  };
  return { dbStub, calls };
}

test('listPublishedAnnouncements queries only published rows, newest first', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadService(dbStub);

  const records = await svc.listPublishedAnnouncements(5);

  assert.equal(records.length, 2);
  assert.equal(records[0].id, 2);
  const sql = calls[0].sql;
  assert.match(sql, /status = 'published'/);
  assert.ok(calls[0].params.includes('5'));
});

test('listPublishedAnnouncements caps the limit at 20', async () => {
  const { dbStub, calls } = createDbStub();
  const svc = loadService(dbStub);

  await svc.listPublishedAnnouncements(999);

  assert.equal(calls[0].params[0], '20');
});
