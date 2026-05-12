const { STAGES } = require('../game-engine/constants');

function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  return value === true || value === 1 || value === '1';
}

function getStageName(stageId) {
  const id = toNumber(stageId);
  const stage = STAGES.find((item) => item.id === id);
  return stage ? stage.name : (id ? `景区${id}` : '');
}

function mapUser(row) {
  if (!row) return null;
  return {
    ...row,
    uid: row.id,
    nickname: row.nick_name || '',
    avatarUrl: row.avatar_url || '',
    totalGames: toNumber(row.game_count),
    totalWins: toNumber(row.win_count),
    totalIncome: toNumber(row.total_income),
    totalExp: toNumber(row.total_exp),
    isBanned: toBoolean(row.is_banned),
    bannedReason: row.banned_reason || '',
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
  };
}

function mapAdmin(row) {
  if (!row) return null;
  const isActive = toBoolean(row.is_active);
  return {
    ...row,
    isActive,
    isBanned: !isActive,
    lastLoginAt: formatDateTime(row.last_login_at),
    createdAt: formatDateTime(row.created_at),
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    ...row,
    itemId: row.item_id || '',
    imageUrl: row.image_url || '',
    isActive: toBoolean(row.is_active),
    sortOrder: toNumber(row.sort_order),
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
  };
}

function mapConfig(row, definition = null) {
  if (!row) return null;
  return {
    ...row,
    key: row.config_key,
    value: row.config_value,
    description: row.description || (definition && definition.description) || '',
    defaultValue: definition ? definition.defaultValue : row.config_value,
    valueType: definition ? definition.valueType : 'text',
    group: definition ? definition.group : (row.config_key || '').split('.')[0],
    isPublic: definition ? !!definition.isPublic : false,
    isSensitive: definition ? !!definition.isSensitive : false,
    updatedBy: row.updated_by,
    updatedAt: formatDateTime(row.updated_at),
  };
}

function mapAnnouncement(row) {
  if (!row) return null;
  return {
    ...row,
    createdBy: row.created_by,
    publishedAt: formatDateTime(row.published_at),
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
  };
}

function mapLog(row) {
  if (!row) return null;
  return {
    ...row,
    adminId: row.admin_id,
    adminName: row.admin_name || '',
    targetType: row.target_type || '',
    targetId: row.target_id || '',
    ip: row.ip_address || '',
    createdAt: formatDateTime(row.created_at),
  };
}

function mapRoom(row) {
  if (!row) return null;
  return {
    ...row,
    roomCode: row.room_code || '',
    stageId: row.stage_id,
    scenicName: getStageName(row.stage_id),
    hostUserId: row.host_user_id,
    hostName: row.host_name || '',
    hostAvatar: row.host_avatar || '',
    maxPlayers: toNumber(row.max_players),
    currentPlayers: toNumber(row.current_players),
    playerCount: toNumber(row.player_count, toNumber(row.current_players)),
    createdAt: formatDateTime(row.created_at),
    finishedAt: formatDateTime(row.finished_at),
  };
}

function mapRoomPlayer(row) {
  if (!row) return null;
  const seat = toNumber(row.seat);
  return {
    ...row,
    uid: row.user_id,
    nickname: row.nick_name || '',
    avatarUrl: row.avatar_url || '',
    seat,
    team: Math.floor(seat / 2) + 1,
    score: toNumber(row.score),
    isReady: toBoolean(row.is_ready),
    isHost: toBoolean(row.is_host),
    joinedAt: formatDateTime(row.joined_at),
  };
}

function mapGameSession(row) {
  if (!row) return null;
  return {
    ...row,
    sessionId: row.id,
    roomId: row.room_id,
    roomCode: row.room_code || '',
    stageId: row.stage_id,
    scenicName: getStageName(row.stage_id),
    playerCount: toNumber(row.player_count),
    roundCount: toNumber(row.round_count),
    startedAt: formatDateTime(row.started_at),
    finishedAt: formatDateTime(row.finished_at),
  };
}

function mapGamePlayer(row) {
  if (!row) return null;
  return {
    ...row,
    uid: row.user_id,
    nickname: row.nick_name || '',
    avatarUrl: row.avatar_url || '',
    teamId: row.team_id || '',
    score: row.final_score !== null && row.final_score !== undefined
      ? toNumber(row.final_score)
      : toNumber(row.initial_score),
    rank: row.rank,
    coinsEarned: toNumber(row.coins_earned),
    isBot: false,
  };
}

function normalizeEvents(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return normalizeEvents(parsed);
    } catch (_error) {
      return [{ type: 'raw', description: raw }];
    }
  }
  if (Array.isArray(raw.events)) return raw.events;
  return [raw];
}

function describeEvent(event) {
  if (!event || typeof event !== 'object') return String(event || '');
  return event.description || event.message || event.title || event.type || JSON.stringify(event);
}

function mapRound(row) {
  if (!row) return null;
  const events = normalizeEvents(row.events_json).map((event) => {
    const base = event && typeof event === 'object' ? event : {};
    return {
      ...base,
      type: base.type || 'event',
      description: describeEvent(event),
    };
  });
  return {
    ...row,
    roundId: row.id,
    roundNum: row.round_num,
    events,
    stage: `第${row.round_num || 0}回合`,
    summary: events.length > 0 ? events.map((event) => event.description).join(' / ') : '无事件',
    createdAt: formatDateTime(row.created_at),
  };
}

module.exports = {
  formatDateTime,
  getStageName,
  mapAdmin,
  mapAnnouncement,
  mapConfig,
  mapGamePlayer,
  mapGameSession,
  mapItem,
  mapLog,
  mapRoom,
  mapRoomPlayer,
  mapRound,
  mapUser,
  toBoolean,
  toNumber,
};
