const test = require('node:test');
const assert = require('node:assert/strict');
const {sessionOrigin} = require('../src/utils/session-age');
const {actionBudget} = require('../src/utils/action-budget');
const {requestBudget} = require('../src/middleware/traffic-guard');
const {activeCount, waitForDrain} = require('../src/utils/drain');
const {plan} = require('../scripts/migrate');
test('refresh preserves first issuance, accepts legacy iat and rejects stale/future tokens', () => {
  const now = 200 * 86400;
  assert.equal(sessionOrigin({oat: now - 86400, iat: now - 1, exp: now + 100}, 30, now), now - 86400);
  assert.equal(sessionOrigin({iat: now - 10, exp: now - 1}, 30, now), now - 10);
  for (const payload of [{oat: now - 31 * 86400, exp: now + 10}, {iat: now - 8 * 86400, exp: now - 8 * 86400}, {iat: now + 1, exp: now + 10}, {exp: now}, {iat: now, exp: null}]) {
    assert.throws(() => sessionOrigin(payload, 30, now), {statusCode: 401});
  }
});
test('input budget rejects bursts across boundaries and recovers after one second', () => {
  let now = 0; const allow = actionBudget(20, 1000, () => now);
  assert.equal(Array.from({length: 21}, allow).filter(Boolean).length, 20);
  now = 999; assert.equal(allow(), false);
  now = 1000; assert.equal(allow(), true);
});
test('HTTP budget separates users, returns 429 envelope and Retry-After, recovers', () => {
  let now = 0, passed = 0;
  const limit = requestBudget({limit: 2, windowMs: 1000, now: () => now, key: (req) => req.user});
  const response = () => ({setHeader(k, v) {this[k] = v;}, status(v) {this.statusCode = v; return this;}, json(body) {this.body = body;}});
  limit({user: 1}, response(), () => passed++); limit({user: 1}, response(), () => passed++);
  const blocked = response(); limit({user: 1}, blocked, () => passed++);
  assert.equal(blocked.statusCode, 429); assert.equal(blocked.body.code, 429); assert.equal(blocked['Retry-After'], '1');
  limit({user: 2}, response(), () => passed++); assert.equal(passed, 3);
  now = 1000; limit({user: 1}, response(), () => passed++); assert.equal(passed, 4);
});
test('drain allows settlement and ignores result cache, with hard timeout', async () => {
  const games = new Map([[1, {status: 'playing'}], [2, {status: 'finished'}]]); let now = 0;
  assert.equal(activeCount(games), 1);
  assert.equal(await waitForDrain({games: () => games, timeoutMs: 1000, now: () => now, pause: async (ms) => {now += ms; games.get(1).status = 'finished';}}), true);
  assert.equal(now, 250);
  games.get(1).status = 'playing'; now = 0;
  assert.equal(await waitForDrain({games: () => games, timeoutMs: 500, now: () => now, pause: async (ms) => {now += ms;}}), false);
  assert.equal(now, 500);
});
test('migration plans checked baseline, skips applied entries, detects modified SQL', () => {
  const entries = [{name: '001_base.sql', checksum: 'a'}, {name: '002_next.sql', checksum: 'b'}];
  assert.deepEqual(plan(entries, [], '001_base.sql').map((e) => e.action), ['baseline', 'apply']);
  assert.deepEqual(plan(entries, [{name: '001_base.sql', checksum: 'a'}]).map((e) => e.action), ['skip', 'apply']);
  assert.throws(() => plan(entries, [], 'missing.sql'));
  assert.throws(() => plan(entries, [{name: '001_base.sql', checksum: 'changed'}]));
});

test('drain also waits for requests admitted before maintenance to publish their game', async () => {
  let now = 0, pending = 1; const games = new Map();
  const complete = await waitForDrain({games: () => games, pending: () => pending, timeoutMs: 1000, now: () => now,
    pause: async (ms) => {now += ms; if (pending) {pending = 0; games.set(1, {status: 'playing'});} else games.get(1).status = 'finished';}});
  assert.equal(complete, true); assert.equal(now, 500);
});
