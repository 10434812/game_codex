const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRealtimeBaseUrl, buildArenaRealtimeUrl } = require('../utils/arena-realtime');

test('buildRealtimeBaseUrl converts api origin to websocket origin', () => {
  assert.equal(buildRealtimeBaseUrl('https://xcx.ukb88.com/api'), 'wss://xcx.ukb88.com');
  assert.equal(buildRealtimeBaseUrl('http://127.0.0.1:3000/api/'), 'ws://127.0.0.1:3000');
});

test('buildArenaRealtimeUrl appends arena path and query parameters', () => {
  assert.equal(
    buildArenaRealtimeUrl('https://xcx.ukb88.com/api', '88', 'token-1'),
    'wss://xcx.ukb88.com/ws/arena?sessionId=88&token=token-1'
  );
});
