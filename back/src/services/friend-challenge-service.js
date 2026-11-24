const {createHmac, timingSafeEqual} = require('node:crypto');
const db = require('../models/db');
const config = require('../config');

function signature(sessionId, userId) {
  return createHmac('sha256', config.jwt.secret)
    .update(`score-challenge:${sessionId}:${userId}`).digest('base64url');
}

async function resolve(code, userId) {
  const match = typeof code === 'string' && /^(\d{1,20})\.(\d{1,20})\.([A-Za-z0-9_-]{43})$/.exec(code);
  const unavailable = () => Object.assign(new Error('好友挑战已失效，请好友重新分享战绩'), {statusCode: 404});
  if (!match) throw unavailable();
  const [, sessionId, sourceUserId, proof] = match;
  if (!timingSafeEqual(Buffer.from(proof), Buffer.from(signature(sessionId, sourceUserId)))) throw unavailable();
  const source = await db.queryOne(
    `SELECT gs.stage_id AS stageId FROM game_sessions gs
     JOIN game_players gp ON gp.session_id = gs.id AND gp.user_id = ?
     JOIN users u ON u.id = gp.user_id
     WHERE gs.id = ? AND gs.status = 'finished' AND gp.\`rank\` IS NOT NULL AND u.deleted_at IS NULL`,
    [sourceUserId, sessionId]
  );
  if (!source) throw unavailable();
  if (sourceUserId === String(userId)) throw Object.assign(new Error('这是你自己的战绩，可以发给好友挑战'), {statusCode: 409});
  return {sessionId, userId: sourceUserId, stageId: Number(source.stageId)};
}

async function resultFields(sessionId, userId) {
  const row = await db.queryOne(
    `SELECT self.final_score AS selfScore, source.final_score AS friendScore FROM game_players self
     LEFT JOIN game_players source ON source.session_id = self.challenge_source_session_id
       AND source.user_id = self.challenge_source_user_id AND source.\`rank\` IS NOT NULL
     WHERE self.session_id = ? AND self.user_id = ? AND self.\`rank\` IS NOT NULL`,
    [sessionId, userId]
  );
  if (!row) return {};
  const challengeCode = `${sessionId}.${userId}.${signature(sessionId, userId)}`;
  if (row.friendScore == null) return {challengeCode};
  const selfScore = Number(row.selfScore), friendScore = Number(row.friendScore);
  return {challengeCode, challengeComparison: {selfScore, friendScore}};
}

module.exports = {resolve, resultFields};
