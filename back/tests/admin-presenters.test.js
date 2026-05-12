const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapAdmin,
  mapConfig,
  mapGameSession,
  mapLog,
  mapRoom,
  mapUser,
} = require('../src/utils/admin-presenters');

test('mapUser exposes camelCase fields expected by admin web', () => {
  const user = mapUser({
    id: 7,
    nick_name: '锦鲤玩家',
    avatar_url: 'https://example.com/a.png',
    game_count: 12,
    win_count: 3,
    is_banned: 1,
    created_at: '2026-05-12T01:02:03.000Z',
  });

  assert.equal(user.uid, 7);
  assert.equal(user.nickname, '锦鲤玩家');
  assert.equal(user.avatarUrl, 'https://example.com/a.png');
  assert.equal(user.totalGames, 12);
  assert.equal(user.totalWins, 3);
  assert.equal(user.isBanned, true);
  assert.equal(user.createdAt, '2026-05-12 01:02:03');
});

test('mapRoom and mapGameSession include admin display names', () => {
  const room = mapRoom({
    id: 9,
    room_code: '123456',
    stage_id: 1,
    host_user_id: 2,
    host_name: '房主',
    player_count: 4,
  });
  const game = mapGameSession({
    id: 11,
    room_code: '123456',
    stage_id: 6,
    player_count: 8,
  });

  assert.equal(room.roomCode, '123456');
  assert.equal(room.scenicName, '万里长城');
  assert.equal(room.hostName, '房主');
  assert.equal(room.playerCount, 4);
  assert.equal(game.sessionId, 11);
  assert.equal(game.scenicName, '西湖夜游');
  assert.equal(game.playerCount, 8);
});

test('admin, config, and log presenters match UI contracts', () => {
  const admin = mapAdmin({ id: 1, username: 'admin', role: 'super', is_active: 0 });
  const config = mapConfig({ config_key: 'game.round_duration', config_value: '180' });
  const log = mapLog({
    id: 5,
    admin_id: 1,
    admin_name: 'admin',
    target_type: 'user',
    target_id: '7',
    ip_address: '127.0.0.1',
  });

  assert.equal(admin.isActive, false);
  assert.equal(admin.isBanned, true);
  assert.equal(config.key, 'game.round_duration');
  assert.equal(config.value, '180');
  assert.equal(log.adminName, 'admin');
  assert.equal(log.targetType, 'user');
  assert.equal(log.targetId, '7');
  assert.equal(log.ip, '127.0.0.1');
});
