const db = require('../models/db');

/**
 * Get user profile by userId.
 *
 * @param {number} userId
 * @returns {Promise<Object>} { id, nickName, avatarUrl, level, totalExp, totalIncome, coins, gameCount, winCount }
 */
async function getProfile(userId) {
  const user = await db.queryOne(
    'SELECT id, nick_name, avatar_url, level, total_exp, total_income, coins, game_count, win_count FROM users WHERE id = ?',
    [userId]
  );

  if (!user) {
    const err = new Error('用户不存在');
    err.statusCode = 404;
    throw err;
  }

  return {
    id: user.id,
    nickName: user.nick_name,
    avatarUrl: user.avatar_url,
    level: user.level,
    totalExp: user.total_exp,
    totalIncome: user.total_income,
    coins: user.coins,
    gameCount: user.game_count,
    winCount: user.win_count,
  };
}

/**
 * Update user nickname and/or avatar.
 *
 * @param {number} userId
 * @param {{ nickName?: string, avatarUrl?: string }} updates
 * @returns {Promise<Object>} updated profile
 */
async function updateProfile(userId, { nickName, avatarUrl }) {
  const fields = [];
  const params = [];

  if (nickName !== undefined) {
    fields.push('nick_name = ?');
    params.push(nickName);
  }

  if (avatarUrl !== undefined) {
    fields.push('avatar_url = ?');
    params.push(avatarUrl);
  }

  if (fields.length === 0) {
    const err = new Error('没有可更新的字段');
    err.statusCode = 400;
    throw err;
  }

  fields.push('updated_at = NOW()');
  params.push(userId);

  await db.execute(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    params
  );

  return getProfile(userId);
}

module.exports = {
  getProfile,
  updateProfile,
};
