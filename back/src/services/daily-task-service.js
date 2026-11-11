const db = require('../models/db');

const TASKS = [
  {id: 'play1', title: '完成 1 局', target: 1, field: 'games', reward: 20, bit: 1},
  {id: 'play3', title: '完成 3 局', target: 3, field: 'games', reward: 50, bit: 2},
  {id: 'team1', title: '组队完成 1 局', target: 1, field: 'teamed', reward: 30, bit: 4},
];

function taskDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

async function getTasks(userId) {
  const date = taskDate();
  const row = await db.queryOne('SELECT games, teamed, claimed FROM daily_tasks WHERE user_id = ? AND task_date = ?', [userId, date]);
  return {date, tasks: TASKS.map(({field, bit, ...task}) => ({
    ...task, progress: Math.min(task.target, row ? row[field] : 0), claimed: Boolean(row && (row.claimed & bit)),
  }))};
}

async function claim(userId, taskId) {
  const task = TASKS.find((item) => item.id === taskId);
  if (!task) throw Object.assign(new Error('任务不存在'), {statusCode: 404});
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const date = taskDate();
    // Serialize reward claims with other account updates before reading the balance.
    const [[user]] = await conn.execute('SELECT coins FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [userId]);
    if (!user) throw Object.assign(new Error('用户不存在'), {statusCode: 404});
    const [[row]] = await conn.execute('SELECT games, teamed, claimed FROM daily_tasks WHERE user_id = ? AND task_date = ? FOR UPDATE', [userId, date]);
    if (!row || row[task.field] < task.target) throw Object.assign(new Error('任务尚未完成'), {statusCode: 409});
    if (row.claimed & task.bit) throw Object.assign(new Error('奖励已领取'), {statusCode: 409});
    const coins = user.coins + task.reward;
    await conn.execute('UPDATE daily_tasks SET claimed = claimed | ? WHERE user_id = ? AND task_date = ?', [task.bit, userId, date]);
    await conn.execute('UPDATE users SET coins = coins + ?, total_income = total_income + ? WHERE id = ?', [task.reward, task.reward, userId]);
    await conn.execute('INSERT INTO coin_records (user_id, amount, balance_after, type, title) VALUES (?, ?, ?, ?, ?)', [userId, task.reward, coins, 'daily_task', `每日任务 · ${task.title}`]);
    await conn.commit();
    return {coins, reward: task.reward};
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {getTasks, claim, taskDate};
