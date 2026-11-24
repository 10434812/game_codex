// Read-only release checks. Callers provide the connection; never seed configuration or migrate here.
const REQUIRED_COLUMNS = {
  rooms: ['last_active_at', 'match_due_at'],
  room_players: ['challenge_source_session_id', 'challenge_source_user_id'],
  game_sessions: ['playing_room_id'],
  game_players: ['challenge_source_session_id', 'challenge_source_user_id'],
  admins: ['session_version'],
  daily_tasks: ['user_id', 'task_date', 'games', 'teamed', 'claimed'],
  analytics_events: ['event_key', 'user_id', 'device_id', 'client', 'name', 'props', 'client_ts', 'received_at'],
  daily_checkins: ['user_id', 'checkin_date', 'streak', 'reward', 'created_at'],
  growth_claims: ['user_id', 'milestone_id', 'reward', 'created_at'],
};
const REQUIRED_INDEXES = [
  {table: 'game_sessions', columns: ['playing_room_id'], unique: true},
  {table: 'game_players', columns: ['user_id', 'session_id']},
  {table: 'daily_tasks', columns: ['user_id', 'task_date'], unique: true},
  {table: 'daily_checkins', columns: ['user_id', 'checkin_date'], unique: true},
  {table: 'growth_claims', columns: ['user_id', 'milestone_id'], unique: true},
  {table: 'analytics_events', columns: ['event_key'], unique: true},
  {table: 'rooms', columns: ['status', 'last_active_at']},
  {table: 'rooms', columns: ['status', 'stage_id', 'match_due_at']},
];
async function checkGameplaySchema(connection, blockers) {
  const tables = Object.keys(REQUIRED_COLUMNS), placeholders = tables.map(() => '?').join(',');
  const [columns] = await connection.execute(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`, tables);
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const present = new Set(columns.filter((row) => row.tableName === table).map((row) => row.columnName));
    const missing = required.filter((name) => !present.has(name));
    if (missing.length) blockers.push(`数据库：${table}缺少字段${missing.join('、')}，请核对007/012/014/016/017/018/019/020/021迁移。`);
  }
  const [rows] = await connection.execute(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
    COLUMN_NAME AS columnName, SEQ_IN_INDEX AS position, NON_UNIQUE AS nonUnique
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`, tables);
  const indexes = new Map();
  for (const row of rows) {
    const key = `${row.tableName}:${row.indexName}`;
    if (!indexes.has(key)) indexes.set(key, {table: row.tableName, unique: Number(row.nonUnique) === 0, columns: []});
    indexes.get(key).columns[Number(row.position) - 1] = row.columnName;
  }
  for (const required of REQUIRED_INDEXES) {
    const found = [...indexes.values()].some((index) => index.table === required.table
      && (!required.unique || index.unique) && index.columns.join(',') === required.columns.join(','));
    if (!found) blockers.push(`数据库：${required.table}缺少${required.unique ? '唯一' : ''}索引(${required.columns.join(',')})。`);
  }
}
function checkLoginSettings(settings, {target, expectedAppId, nativeFallback = {}}, blockers) {
  if (!['miniprogram', 'minigame'].includes(target)) throw new Error('Unknown release target');
  const game = target === 'minigame', name = game ? '小游戏' : '小程序';
  const appId = String(settings.get(game ? 'wechat.minigame_app_id' : 'wechat.login_app_id') || (!game && nativeFallback.appId) || '').trim();
  const secret = String(settings.get(game ? 'wechat.minigame_secret' : 'wechat.login_secret') || (!game && nativeFallback.secret) || '').trim();
  if (!appId || !secret) blockers.push(`数据库/环境：${name}独立微信登录凭证缺失。`);
  if (appId && expectedAppId && appId !== expectedAppId) blockers.push(`数据库：${name}登录AppID与所选工程不一致。`);
  if (settings.get('wechat.login_enabled') === 'false') blockers.push(`数据库：${name}微信登录总开关已关闭。`);
  if (Number(settings.get('game.round_duration')) !== 120) blockers.push('数据库：game.round_duration不是120秒，请核对013迁移与实际运营配置。');
}
function checkApiCapabilities(features, blockers) {
  for (const name of ['onlineArena', 'authRefresh', 'roomRematch', 'quickMatch', 'retention']) {
    if (features?.api?.[name] !== true) blockers.push(`线上：未声明当前版本必需的${name}接口能力，请先更新后端再发布客户端。`);
  }
}
module.exports = {checkGameplaySchema, checkLoginSettings, checkApiCapabilities, REQUIRED_COLUMNS, REQUIRED_INDEXES};
