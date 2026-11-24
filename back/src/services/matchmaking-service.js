const db = require('../models/db');
const rooms = require('./room-service');
const games = require('./game-service');
const logger = require('../utils/logger');
const {STAGES} = require('../game-engine/constants');
const MATCH_SECONDS = 8;
// Room mutation transactions retain their own account/room locks. This advisory
// lock serializes selecting/creating public matches across HTTP and the pump.
async function locked(work) {
  const connection = await db.pool.getConnection();
  let locked = false;
  try {
    const [[result]] = await connection.execute("SELECT GET_LOCK('jinli:matchmaking', 3) AS acquired");
    if (Number(result.acquired) !== 1) throw Object.assign(new Error('匹配繁忙，请重试'), {statusCode: 503});
    locked = true; return await work();
  } finally {
    if (locked) await connection.execute("SELECT RELEASE_LOCK('jinli:matchmaking')").catch(() => {});
    connection.release();
  }
}
// Queue before acquiring a pool connection; otherwise many callers waiting
// for GET_LOCK could occupy the whole pool and starve the holder's transaction.
let queue = Promise.resolve(), queued = 0;
async function serialized(work) {
  if (queued >= 64) throw Object.assign(new Error('匹配繁忙，请稍后重试'), {statusCode: 503});
  queued++;
  const previous = queue; let release;
  queue = new Promise((resolve) => {release = resolve;});
  await previous;
  try {return await locked(work);}
  finally {queued--; release();}
}
async function join(userId, stageId, {createFriendRoomIfEmpty = false, challenge} = {}) {
  if (!STAGES.some((stage) => Number(stage.id) === Number(stageId))) throw Object.assign(new Error('请选择有效景区'), {statusCode: 400});
  return serialized(async () => {
    const playing = await db.queryOne("SELECT gs.room_id FROM game_sessions gs JOIN game_players gp ON gp.session_id = gs.id WHERE gp.user_id = ? AND gs.status = 'playing' ORDER BY gs.id DESC LIMIT 1", [userId]);
    if (playing && challenge) throw Object.assign(new Error('请先结束当前对局，再开始好友挑战'), {statusCode: 409});
    if (playing) return rooms.getRoom(playing.room_id, userId);
    const existing = await db.queryOne("SELECT r.id, r.match_due_at FROM rooms r JOIN room_players rp ON rp.room_id = r.id WHERE rp.user_id = ? AND r.status = 'waiting' ORDER BY r.id DESC LIMIT 1", [userId]);
    if (existing) {
      if (challenge) return rooms.joinRoom(existing.id, userId, {challenge, allowMatchmaking: true});
      if (!existing.match_due_at && !createFriendRoomIfEmpty) throw Object.assign(new Error('请先返回或离开已有好友房，再开始匹配'), {statusCode: 409});
      return rooms.getRoom(existing.id, userId);
    }
    const available = await db.queryOne("SELECT id FROM rooms WHERE status = 'waiting' AND stage_id = ? AND match_due_at > NOW() AND current_players < max_players ORDER BY match_due_at, id LIMIT 1", [stageId]);
    if (available) return rooms.joinRoom(available.id, userId, {challenge, allowMatchmaking: true});
    if (createFriendRoomIfEmpty) {
      const room = await rooms.createRoom(userId, stageId);
      return {...room, autoCreatedFriendRoom: true};
    }
    return rooms.createRoom(userId, stageId, {matchmaking: true, challenge});
  });
}
async function advanceDue(realtime, mayStart = () => true) {
  return serialized(async () => {
    const due = await db.queryAll("SELECT id, host_user_id FROM rooms WHERE status = 'waiting' AND match_due_at IS NOT NULL AND (match_due_at <= NOW() OR current_players >= 4) AND current_players > 0 ORDER BY match_due_at LIMIT 25");
    for (const room of due) {
      if (!mayStart()) break;
      let started;
      try {
        started = await rooms.startGame(room.id, room.host_user_id);
        await games.startGameSession(started.roomId, room.host_user_id, realtime);
      } catch (error) {
        logger.error('matchmaking_start_failed', {sessionId: started?.sessionId, code: error.code});
        if (started) {
          try {await games.recoverFailedStart(started.sessionId);}
          catch (recoveryError) {
            logger.error('matchmaking_recovery_failed', {sessionId: started.sessionId, code: recoveryError.code});
          }
        }
        // Back off broken rooms so repeated failures cannot monopolize the
        // 25-room batch. Keep private rooms and active sessions untouched.
        try {
          await db.execute("UPDATE rooms SET match_due_at = DATE_ADD(NOW(), INTERVAL 5 SECOND) WHERE id = ? AND status = 'waiting' AND match_due_at IS NOT NULL", [room.id]);
        } catch (backoffError) {
          logger.error('matchmaking_backoff_failed', {code: backoffError.code});
        }
      }
    }
    return due.length;
  });
}
module.exports = {join, advanceDue, MATCH_SECONDS};
