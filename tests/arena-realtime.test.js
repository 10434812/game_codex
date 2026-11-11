const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRealtimeBaseUrl, buildArenaRealtimeUrl, buildArenaRealtimeProtocols } = require('../utils/arena-realtime');

test('buildRealtimeBaseUrl converts api origin to websocket origin', () => {
  assert.equal(buildRealtimeBaseUrl('https://xcx.ukb88.com/api'), 'wss://xcx.ukb88.com');
  assert.equal(buildRealtimeBaseUrl('http://127.0.0.1:3000/api/'), 'ws://127.0.0.1:3000');
});

test('buildArenaRealtimeUrl appends arena path and sessionId, token stays out of the URL', () => {
  assert.equal(
    buildArenaRealtimeUrl('https://xcx.ukb88.com/api', '88', 'token-1'),
    'wss://xcx.ukb88.com/ws/arena?sessionId=88'
  );
});

test('buildArenaRealtimeProtocols carries the token as an arena.* subprotocol', () => {
  assert.deepEqual(
    buildArenaRealtimeProtocols('https://xcx.ukb88.com/api', '88', 'token-1'),
    ['arena.token-1']
  );
  assert.deepEqual(buildArenaRealtimeProtocols('https://xcx.ukb88.com/api', '88', ''), []);
});

test('realtime authentication cannot bypass shared consent with a stored token', () => {
  let connected = false;
  global.wx = {
    getStorageSync: () => 'old-token',
    connectSocket() { connected = true; },
  };
  const realtime = require('../utils/arena-realtime');
  assert.throws(() => realtime.connect('88'), {code: 'PRIVACY_CONSENT_REQUIRED'});
  assert.equal(connected, false);
});
