const crypto = require('node:crypto');
const db = require('../models/db');
const invalid = () => Object.assign(new Error('事件格式无效'), {statusCode: 400});
function normalizeBatch(body, now = Date.now()) {
  if (!body || !['miniprogram', 'minigame'].includes(body.client)
    || typeof body.deviceId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(body.deviceId)
    || !Array.isArray(body.events) || body.events.length > 50 || !body.events.length) throw invalid();
  return body.events.map((event) => {
    if (!event || typeof event.name !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(event.name)
      || typeof event.ts !== 'number' || !Number.isSafeInteger(event.ts)) throw invalid();
    let props = null;
    if (event.props && typeof event.props === 'object' && !Array.isArray(event.props)) {
      const encoded = JSON.stringify(event.props);
      if (Buffer.byteLength(encoded) <= 1024) props = encoded;
    }
    const eventKey = crypto.createHash('sha256').update(JSON.stringify([body.client, body.deviceId, event.name, event.ts, props])).digest('hex');
    return [eventKey, body.deviceId, body.client, event.name, props, Math.max(now - 7 * 86400000, Math.min(now + 60000, event.ts))];
  });
}
async function recordBatch(body, userId = null) {
  const rows = normalizeBatch(body);
  const values = rows.flatMap(([key, device, client, name, props, ts]) => [key, userId, device, client, name, props, ts]);
  await db.execute(`INSERT INTO analytics_events (event_key, user_id, device_id, client, name, props, client_ts) VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',')} ON DUPLICATE KEY UPDATE event_key = event_key`, values);
  return {accepted: rows.length};
}
async function getOverview() {
  const [daily, retention, funnel, completion, matchmaking, matchExits, replay, startup] = await Promise.all([
    db.queryAll(`WITH first_seen AS (SELECT device_id, MIN(received_at) AS first_at FROM analytics_events WHERE name = 'app_launch' GROUP BY device_id)
      SELECT DATE_FORMAT(e.received_at, '%Y-%m-%d') AS date, COUNT(DISTINCT CASE WHEN e.name = 'app_launch' THEN e.device_id END) AS devices,
      COUNT(DISTINCT e.user_id) AS accounts, COUNT(DISTINCT CASE WHEN e.name = 'app_launch' AND DATE(f.first_at) = DATE(e.received_at) THEN e.device_id END) AS newDevices
      FROM analytics_events e LEFT JOIN first_seen f ON f.device_id = e.device_id
      WHERE e.received_at >= CURDATE() - INTERVAL 13 DAY GROUP BY DATE_FORMAT(e.received_at, '%Y-%m-%d') ORDER BY date`),
    db.queryAll(`WITH cohorts AS (SELECT device_id, DATE(MIN(received_at)) AS cohort FROM analytics_events WHERE name = 'app_launch' GROUP BY device_id),
      activity AS (SELECT DISTINCT device_id, DATE(received_at) AS day FROM analytics_events WHERE name = 'app_launch')
      SELECT DATE_FORMAT(c.cohort, '%Y-%m-%d') AS date, COUNT(DISTINCT c.device_id) AS devices,
      IF(c.cohort + INTERVAL 1 DAY <= CURDATE(), COUNT(DISTINCT CASE WHEN a.day = c.cohort + INTERVAL 1 DAY THEN c.device_id END), NULL) AS day1,
      IF(c.cohort + INTERVAL 3 DAY <= CURDATE(), COUNT(DISTINCT CASE WHEN a.day = c.cohort + INTERVAL 3 DAY THEN c.device_id END), NULL) AS day3,
      IF(c.cohort + INTERVAL 7 DAY <= CURDATE(), COUNT(DISTINCT CASE WHEN a.day = c.cohort + INTERVAL 7 DAY THEN c.device_id END), NULL) AS day7
      FROM cohorts c LEFT JOIN activity a ON c.device_id = a.device_id
      WHERE c.cohort >= CURDATE() - INTERVAL 13 DAY GROUP BY c.cohort ORDER BY c.cohort`),
    // Join each subsequent step at/after the previous one (retry events cannot inflate a step).
    db.queryAll(`WITH launches AS (SELECT device_id, MIN(received_at) AS at FROM analytics_events WHERE name = 'app_launch' AND received_at >= NOW() - INTERVAL 7 DAY GROUP BY device_id),
      privacy AS (SELECT l.device_id, MIN(e.received_at) AS at FROM launches l JOIN analytics_events e ON e.device_id = l.device_id AND e.name = 'privacy_accept' AND e.received_at >= l.at GROUP BY l.device_id),
      logins AS (SELECT p.device_id, MIN(e.received_at) AS at FROM privacy p JOIN analytics_events e ON e.device_id = p.device_id AND e.name = 'login_success' AND e.received_at >= p.at GROUP BY p.device_id),
      starts AS (SELECT l.device_id, MIN(e.received_at) AS at FROM logins l JOIN analytics_events e ON e.device_id = l.device_id AND e.name = 'game_start' AND e.received_at >= l.at GROUP BY l.device_id),
      finishes AS (SELECT s.device_id, MIN(e.received_at) AS at FROM starts s JOIN analytics_events e ON e.device_id = s.device_id AND e.name = 'game_finish' AND e.received_at >= s.at GROUP BY s.device_id),
      replays AS (SELECT f.device_id, MIN(e.received_at) AS at FROM finishes f JOIN analytics_events e ON e.device_id = f.device_id AND e.name = 'replay_click' AND e.received_at >= f.at GROUP BY f.device_id)
      SELECT 'app_launch' AS name, COUNT(*) AS devices FROM launches UNION ALL SELECT 'privacy_accept', COUNT(*) FROM privacy UNION ALL SELECT 'login_success', COUNT(*) FROM logins UNION ALL SELECT 'game_start', COUNT(*) FROM starts UNION ALL SELECT 'game_finish', COUNT(*) FROM finishes UNION ALL SELECT 'replay_click', COUNT(*) FROM replays`),
    db.queryOne(`SELECT COUNT(DISTINCT CONCAT(s.device_id, ':', JSON_UNQUOTE(JSON_EXTRACT(s.props, '$.sessionId')))) AS starts,
      COUNT(DISTINCT CASE WHEN f.id IS NOT NULL THEN CONCAT(s.device_id, ':', JSON_UNQUOTE(JSON_EXTRACT(s.props, '$.sessionId'))) END) AS finishes
      FROM analytics_events s LEFT JOIN analytics_events f ON f.name = 'game_finish' AND f.device_id = s.device_id
      AND JSON_UNQUOTE(JSON_EXTRACT(f.props, '$.sessionId')) = JSON_UNQUOTE(JSON_EXTRACT(s.props, '$.sessionId')) AND f.received_at >= s.received_at
      WHERE s.name = 'game_start' AND s.received_at >= NOW() - INTERVAL 7 DAY`),
    db.queryAll(`WITH attempts AS (
      SELECT client, device_id, JSON_UNQUOTE(JSON_EXTRACT(props, '$.attemptId')) AS attemptId,
        MAX(name = 'match_request') AS requested, MAX(name = 'match_queue') AS queued,
        MAX(name = 'match_started') AS started, MAX(name = 'match_cancel') AS cancelled,
        MAX(name = 'match_failed') AS failed, MAX(name = 'match_background') AS background,
        MAX(CASE WHEN name = 'match_started' AND JSON_TYPE(JSON_EXTRACT(props, '$.waitMs')) IN ('INTEGER','DOUBLE')
          THEN LEAST(3600000, GREATEST(0, CAST(JSON_UNQUOTE(JSON_EXTRACT(props, '$.waitMs')) AS DECIMAL(12,0)))) END) AS waitMs,
        MAX(CASE WHEN name = 'match_started' AND JSON_TYPE(JSON_EXTRACT(props, '$.botCount')) = 'INTEGER'
          THEN LEAST(10, GREATEST(0, CAST(JSON_UNQUOTE(JSON_EXTRACT(props, '$.botCount')) AS SIGNED))) END) AS bots,
        MAX(CASE WHEN name = 'match_started' AND JSON_TYPE(JSON_EXTRACT(props, '$.humanCount')) = 'INTEGER'
          THEN LEAST(10, GREATEST(0, CAST(JSON_UNQUOTE(JSON_EXTRACT(props, '$.humanCount')) AS SIGNED))) END) AS humans
      FROM analytics_events WHERE received_at >= NOW() - INTERVAL 7 DAY
        AND name IN ('match_request','match_queue','match_started','match_cancel','match_failed','match_background')
        AND JSON_UNQUOTE(JSON_EXTRACT(props, '$.attemptId')) REGEXP '^[a-zA-Z0-9_]{1,80}$'
      GROUP BY client, device_id, attemptId)
      SELECT client, COUNT(*) AS requests, SUM(queued) AS queued, SUM(started) AS started,
        SUM(cancelled) AS cancelled, SUM(failed) AS failed, SUM(background) AS background,
        ROUND(AVG(waitMs)) AS averageWaitMs, SUM(bots) AS botPlayers, SUM(bots + humans) AS totalPlayers,
        SUM(CASE WHEN started = 1 AND bots = 0 THEN 1 ELSE 0 END) AS allHumanStarts
      FROM attempts WHERE requested = 1 GROUP BY client`),
    db.queryAll(`SELECT name, JSON_UNQUOTE(JSON_EXTRACT(props, '$.reason')) AS reason,
      COUNT(DISTINCT client, device_id, JSON_UNQUOTE(JSON_EXTRACT(props, '$.attemptId'))) AS attempts
      FROM analytics_events WHERE received_at >= NOW() - INTERVAL 7 DAY
        AND name IN ('match_cancel','match_failed')
        AND JSON_UNQUOTE(JSON_EXTRACT(props, '$.attemptId')) REGEXP '^[a-zA-Z0-9_]{1,80}$'
      GROUP BY name, reason ORDER BY attempts DESC, name, reason`),
    db.queryOne(`WITH attempts AS (
      SELECT client, device_id, JSON_UNQUOTE(JSON_EXTRACT(props, '$.attemptId')) AS attemptId,
        MAX(name = 'replay_click') AS requested, MAX(name = 'replay_failed') AS failed,
        MAX(name = 'replay_started' AND JSON_UNQUOTE(JSON_EXTRACT(props, '$.sessionId')) <> JSON_UNQUOTE(JSON_EXTRACT(props, '$.sourceSessionId'))) AS started
      FROM analytics_events WHERE received_at >= NOW() - INTERVAL 7 DAY
        AND name IN ('replay_click','replay_started','replay_failed')
        AND JSON_UNQUOTE(JSON_EXTRACT(props, '$.attemptId')) REGEXP '^[a-zA-Z0-9_]{1,80}$'
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(props, '$.sourceSessionId')), '') <> ''
      GROUP BY client, device_id, attemptId)
      SELECT COUNT(*) AS attempts, COALESCE(SUM(started), 0) AS started, COALESCE(SUM(failed), 0) AS failed
      FROM attempts WHERE requested = 1`),
    db.queryAll(`SELECT client, COUNT(*) AS samples,
      ROUND(AVG(CAST(JSON_UNQUOTE(JSON_EXTRACT(props, '$.durationMs')) AS DECIMAL(12,0)))) AS averageMs
      FROM analytics_events WHERE name = 'boot_ready' AND received_at >= NOW() - INTERVAL 7 DAY
        AND JSON_TYPE(JSON_EXTRACT(props, '$.durationMs')) IN ('INTEGER','DOUBLE')
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(props, '$.durationMs')) AS DECIMAL(12,0)) BETWEEN 0 AND 3600000
      GROUP BY client`),
  ]);
  return {daily, retention, funnel, completion, matchmaking, matchExits, replay, startup,
    note: '设备按客户端安装标识统计；清缓存会形成新设备。原始事件保留90天，新增按保留期内首次启动计算；留存从接入后累计，未成熟日期显示 --。匹配和复玩按设备、客户端及每次请求关联，均为客户端观测；机器人比例按服务端快照上报，不能当作真人匹配率。'};
}
async function cleanupExpired() {
  // Bounded deletes avoid holding a large lock on a growing event table.
  const [result] = await db.execute('DELETE FROM analytics_events WHERE received_at < DATE_SUB(NOW(), INTERVAL 90 DAY) LIMIT 5000');
  return result.affectedRows;
}
module.exports = {normalizeBatch, recordBatch, getOverview, cleanupExpired};
