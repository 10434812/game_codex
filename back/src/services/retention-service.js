const db = require('../models/db');
const {taskDate} = require('./daily-task-service');
const {STAGES} = require('../game-engine/constants');
const passportSql = `
  SELECT stage_id, session_id FROM (
    SELECT sessions.stage_id, players.session_id,
      ROW_NUMBER() OVER (PARTITION BY sessions.stage_id ORDER BY sessions.finished_at, sessions.id) AS visit_number
    FROM game_players players
    JOIN game_sessions sessions ON sessions.id = players.session_id
    WHERE players.user_id = ? AND players.\`rank\` IS NOT NULL AND sessions.status = 'finished'
  ) visits WHERE visit_number = 1`;

function buildPassport(visits, sessionId) {
  const firstVisits = new Map(visits.map((visit) => [visit.stage_id, visit.session_id]));
  const stages = STAGES.map(({id, name}) => ({id, name, stamped: firstVisits.has(id)}));
  const stampedCount = stages.filter((stage) => stage.stamped).length;
  const newStamp = sessionId ? stages.find(({id}) => firstVisits.get(id) === sessionId) || null : null;
  const badge = stampedCount === stages.length;
  return {stages, stampedCount, badge, newStamp,
    nextStage: stages.find((stage) => !stage.stamped) || null};
}
const CHECKIN_REWARDS = [20, 25, 30, 35, 40, 45, 60];
const MILESTONES = [
  {id: 'first_game', title: '初次接福', field: 'game_count', target: 1, reward: 50},
  {id: 'ten_games', title: '十场同行', field: 'game_count', target: 10, reward: 150},
  {id: 'first_win', title: '初登榜首', field: 'win_count', target: 1, reward: 80},
  {id: 'thousand_exp', title: '千分成长', field: 'total_exp', target: 1000, reward: 300},
];
const lastCheckinSql = "SELECT DATE_FORMAT(checkin_date, '%Y-%m-%d') AS date, streak, reward FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1";
function checkinState(last, now) {
  const date = taskDate(now), yesterday = taskDate(new Date(now.getTime() - 86400000));
  if (last && last.date > date) throw Object.assign(new Error('服务器日期校准中，请稍后重试'), {statusCode: 409});
  const claimed = last?.date === date;
  const streak = last && (claimed || last.date === yesterday) ? Number(last.streak) : 0;
  const nextStreak = claimed ? streak : streak + 1, day = (nextStreak - 1) % 7 + 1;
  return {claimed, streak, day, reward: claimed ? Number(last.reward) : CHECKIN_REWARDS[day - 1],
    calendar: CHECKIN_REWARDS.map((reward, index) => ({day: index + 1, reward, current: index + 1 === day, claimed: index + 1 < day || (index + 1 === day && claimed)}))};
}
async function getSummary(userId, {now = () => new Date(), sessionId} = {}) {
  const user = await db.queryOne('SELECT coins, level, game_count, win_count, total_exp FROM users WHERE id = ? AND deleted_at IS NULL AND is_banned = 0', [userId]);
  if (!user) throw Object.assign(new Error('账号已失效，请重新登录'), {statusCode: 401});
  const [last, claims, visits] = await Promise.all([
    db.queryOne(lastCheckinSql, [userId]),
    db.queryAll('SELECT milestone_id FROM growth_claims WHERE user_id = ?', [userId]),
    db.queryAll(passportSql, [userId]),
  ]);
  const at = now(), claimed = new Set(claims.map((claim) => claim.milestone_id));
  return {date: taskDate(at), checkin: checkinState(last, at), level: Number(user.level), totalExp: Number(user.total_exp),
    games: Number(user.game_count), wins: Number(user.win_count),
    passport: buildPassport(visits, sessionId),
    milestones: MILESTONES.map(({field, ...milestone}) => ({...milestone, progress: Math.min(milestone.target, Number(user[field]) || 0), claimed: claimed.has(milestone.id)}))};
}
async function award(conn, userId, coins, reward, type, title) {
  await conn.execute('UPDATE users SET coins = coins + ?, total_income = total_income + ? WHERE id = ?', [reward, reward, userId]);
  await conn.execute('INSERT INTO coin_records (user_id, amount, balance_after, type, title) VALUES (?, ?, ?, ?, ?)', [userId, reward, coins + reward, type, title]);
}
async function claim(userId, milestoneId, {now = () => new Date()} = {}) {
  const milestone = milestoneId ? MILESTONES.find((item) => item.id === milestoneId) : null;
  if (milestoneId && !milestone) throw Object.assign(new Error('成长目标不存在'), {statusCode: 404});
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[user]] = await conn.execute('SELECT coins, game_count, win_count, total_exp FROM users WHERE id = ? AND deleted_at IS NULL AND is_banned = 0 FOR UPDATE', [userId]);
    if (!user) throw Object.assign(new Error('账号已失效，请重新登录'), {statusCode: 401});
    const coins = Number(user.coins);
    let receipt;
    if (milestone) {
      const [[existing]] = await conn.execute('SELECT reward FROM growth_claims WHERE user_id = ? AND milestone_id = ? FOR UPDATE', [userId, milestone.id]);
      if (existing) receipt = {alreadyClaimed: true, reward: Number(existing.reward), coins};
      else {
        if (Number(user[milestone.field]) < milestone.target) throw Object.assign(new Error('成长目标尚未完成'), {statusCode: 409});
        await conn.execute('INSERT INTO growth_claims (user_id, milestone_id, reward) VALUES (?, ?, ?)', [userId, milestone.id, milestone.reward]);
        await award(conn, userId, coins, milestone.reward, 'growth_reward', `成长奖励 · ${milestone.title}`);
        receipt = {alreadyClaimed: false, reward: milestone.reward, coins: coins + milestone.reward};
      }
    } else {
      // Take the calendar date after acquiring the account lock, including at midnight.
      const [[last]] = await conn.execute(lastCheckinSql + ' FOR UPDATE', [userId]);
      const at = now(), date = taskDate(at), status = checkinState(last, at);
      if (status.claimed) receipt = {date, alreadyClaimed: true, reward: status.reward, coins};
      else {
        const streak = status.streak + 1;
        await conn.execute('INSERT INTO daily_checkins (user_id, checkin_date, streak, reward) VALUES (?, ?, ?, ?)', [userId, date, streak, status.reward]);
        await award(conn, userId, coins, status.reward, 'daily_checkin', `每日签到 · 连续${streak}天`);
        receipt = {date, alreadyClaimed: false, reward: status.reward, coins: coins + status.reward};
      }
    }
    await conn.commit(); return receipt;
  } catch (error) {await conn.rollback(); throw error;}
  finally {conn.release();}
}
module.exports = {getSummary, claimCheckin: (userId, options) => claim(userId, null, options), claimMilestone: (userId, id) => {if (typeof id !== 'string' || !id) return Promise.reject(Object.assign(new Error('成长目标不存在'), {statusCode: 404})); return claim(userId, id);}, checkinState, CHECKIN_REWARDS};
