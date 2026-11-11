const db = require('../models/db');
const contentSafetyService = require('./content-safety-service');
const fs = require('fs');
const path = require('path');
const gameService = require('./game-service');

const ANONYMOUS_NAME = '已注销用户';

// Match stable account identifiers, never nickname/avatar values: users may share them.
function anonymizeJson(value, userId) {
  if (Array.isArray(value)) return value.map((item) => anonymizeJson(item, userId));
  if (!value || typeof value !== 'object') return value;
  const own = ['id', 'userId', 'user_id', 'actorId'].some((key) =>
    value[key] !== undefined && String(value[key]) === String(userId));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (own && ['name', 'nickName', 'nick_name', 'actorName', 'playerName'].includes(key)) return [key, ANONYMOUS_NAME];
    if (own && ['avatar', 'avatarUrl', 'avatar_url'].includes(key)) return [key, ''];
    return [key, anonymizeJson(item, userId)];
  }));
}

function deletionConflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

async function removeOwnedAvatars(conn, user, backups) {
  const [reviews] = await conn.execute('SELECT filename FROM avatar_reviews WHERE user_id = ? FOR UPDATE', [user.id]);
  const owned = new Set();
  for (const review of reviews) {
    if (!new RegExp(`^${Number(user.id)}_[a-f0-9]{32}\\.(jpg|png)$`).test(review.filename)) {
      throw deletionConflict('头像归属记录异常，无法安全注销，请联系运营方处理');
    }
    owned.add(review.filename);
  }
  const publicDir = path.resolve(__dirname, '../../uploads/avatars');
  const privateDir = path.resolve(__dirname, '../../private/avatar-reviews');
  // Older uploads have no ownership ledger. Do not turn an arbitrary stored URL
  // into permission to delete somebody else's file.
  let legacyName = '';
  try {
    const url = new URL(user.avatar_url || '', 'https://invalid.local');
    const match = /^\/uploads\/avatars\/([A-Za-z0-9_.-]+)$/.exec(decodeURIComponent(url.pathname));
    if (match && !owned.has(match[1])) legacyName = match[1];
  } catch (_error) {}
  if (legacyName) {
    try {
      await fs.promises.lstat(path.join(publicDir, legacyName));
      throw deletionConflict('历史头像缺少可核验归属记录，请联系运营方核实清理后再注销');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const filename of owned) {
    for (const dir of [publicDir, privateDir]) {
      const file = path.join(dir, filename);
      try {
        const stat = await fs.promises.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw deletionConflict('头像文件状态异常，无法安全注销');
        const data = await fs.promises.readFile(file);
        await fs.promises.unlink(file);
        backups.push({file, data});
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  await conn.execute('DELETE FROM avatar_reviews WHERE user_id = ?', [user.id]);
}

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
 * Update nickname only; avatars must use the quarantined upload workflow.
 *
 * @param {number} userId
 * @param {{ nickName?: string, avatarUrl?: string }} updates
 * @returns {Promise<Object>} updated profile
 */
async function updateProfile(userId, { nickName, avatarUrl }) {
  const invalid = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  if (avatarUrl !== undefined) throw invalid('头像必须通过上传接口审核');
  if (nickName === undefined) throw invalid('没有可更新的字段');
  if (typeof nickName !== 'string' || !nickName.trim()) throw invalid('昵称不能为空');
  if (nickName.length > 32) throw invalid('昵称不能超过32个字符');
  const user = await db.queryOne('SELECT openid FROM users WHERE id = ? AND deleted_at IS NULL AND is_banned = 0', [userId]);
  if (!user) {
    const error = new Error('用户不存在');
    error.statusCode = 404;
    throw error;
  }
  const normalized = nickName.trim();
  await contentSafetyService.checkText(normalized, user.openid);
  const [result] = await db.execute('UPDATE users SET nick_name = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL AND is_banned = 0', [normalized, userId]);
  if (!result.affectedRows) {
    const error = new Error('用户不存在');
    error.statusCode = 404;
    throw error;
  }
  return getProfile(userId);
}

async function deleteAccount(userId) {
  const conn = await db.pool.getConnection();
  const removedFiles = [];
  const cachedGames = gameService.getActiveGames();
  try {
    // A current, non-locking active-session read must see starts committed while
    // we waited for account locks. Never wait on a settling session while
    // holding its users: settlement takes the session lock before user writes.
    await conn.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    // Discover candidate accounts before locking any account. Locking only the
    // deleting user first can deadlock a start holding a lower-id participant.
    const [memberships] = await conn.execute(
      'SELECT room_id FROM room_players WHERE user_id = ? ORDER BY room_id', [userId]
    );
    const accountIds = new Set([Number(userId)]);
    for (const membership of memberships) {
      const [members] = await conn.execute(
        'SELECT user_id FROM room_players WHERE room_id = ? ORDER BY user_id', [membership.room_id]
      );
      for (const member of members) accountIds.add(Number(member.user_id));
    }
    const orderedIds = [...accountIds].sort((a, b) => a - b);
    for (const id of orderedIds) {
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
    }
    const [users] = await conn.execute(
      'SELECT id, nick_name, avatar_url, deleted_at FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    const user = users[0];
    if (!user || user.deleted_at) {
      const err = new Error('用户不存在');
      err.statusCode = 404;
      throw err;
    }

    // No new room may be joined after our user lock. Revalidate the discovery
    // snapshot with current reads after taking room locks in ascending order.
    for (const membership of memberships) {
      await conn.execute('SELECT id FROM rooms WHERE id = ? FOR UPDATE', [membership.room_id]);
    }
    const [rooms] = await conn.execute(
      'SELECT room_id FROM room_players WHERE user_id = ? ORDER BY room_id FOR UPDATE', [userId]
    );
    if (rooms.length !== memberships.length || rooms.some((room, index) =>
      Number(room.room_id) !== Number(memberships[index].room_id))) {
      throw deletionConflict('房间状态已变化，请重试注销');
    }
    for (const room of rooms) {
      const [members] = await conn.execute(
        'SELECT user_id FROM room_players WHERE room_id = ? ORDER BY user_id FOR UPDATE', [room.room_id]
      );
      if (members.some((member) => !accountIds.has(Number(member.user_id)))) {
        throw deletionConflict('房间成员已变化，请重试注销');
      }
    }
    const [liveSessions] = await conn.execute(
      "SELECT gs.id FROM game_sessions gs JOIN game_players gp ON gp.session_id = gs.id WHERE gp.user_id = ? AND gs.status = 'playing'",
      [userId]
    );
    const userCachedGames = [...cachedGames.entries()].filter(([, game]) =>
      (game.players || []).some((player) => String(player.id) === String(userId)));
    if (liveSessions.length || userCachedGames.some(([, game]) => game.status !== 'finished')) {
      throw deletionConflict('当前仍有进行中的对局，请等待对局结算完成后再注销');
    }
    const [games] = await conn.execute('SELECT DISTINCT session_id FROM game_players WHERE user_id = ?', [userId]);
    const sessionIds = games.map((row) => row.session_id);

    // Invalid JSON or any write failure aborts the entire deletion transaction.
    for (const sessionId of sessionIds) {
      const [results] = await conn.execute('SELECT id, result_json FROM game_results WHERE session_id = ?', [sessionId]);
      for (const row of results) {
        const source = typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json;
        const sanitized = anonymizeJson(source, userId);
        await conn.execute('UPDATE game_results SET result_json = ? WHERE id = ?', [JSON.stringify(sanitized), row.id]);
      }
      const [rounds] = await conn.execute('SELECT id, events_json FROM game_rounds WHERE session_id = ?', [sessionId]);
      for (const row of rounds) {
        const source = typeof row.events_json === 'string' ? JSON.parse(row.events_json) : row.events_json;
        const sanitized = anonymizeJson(source, userId);
        await conn.execute('UPDATE game_rounds SET events_json = ? WHERE id = ?', [JSON.stringify(sanitized), row.id]);
      }
    }

    for (const room of rooms) {
      await conn.execute('DELETE FROM room_players WHERE room_id = ? AND user_id = ?', [room.room_id, userId]);
      await conn.execute(
        `UPDATE rooms r
         LEFT JOIN (SELECT room_id, MIN(user_id) AS next_host, COUNT(*) AS player_count FROM room_players WHERE room_id = ? GROUP BY room_id) p
         ON p.room_id = r.id
         SET r.host_user_id = COALESCE(p.next_host, 0), r.current_players = COALESCE(p.player_count, 0),
             r.status = CASE WHEN COALESCE(p.player_count, 0) = 0 AND r.status = 'playing' THEN 'finished' ELSE r.status END,
             r.finished_at = CASE WHEN COALESCE(p.player_count, 0) = 0 AND r.status = 'playing' THEN NOW() ELSE r.finished_at END
         WHERE r.id = ?`,
        [room.room_id, room.room_id]
      );
      await conn.execute('UPDATE room_players SET is_host = (user_id = (SELECT host_user_id FROM rooms WHERE id = ?)) WHERE room_id = ?', [room.room_id, room.room_id]);
      await conn.execute('DELETE FROM rooms WHERE id = ? AND status = \'waiting\' AND current_players = 0', [room.room_id]);
    }

    await conn.execute('DELETE FROM user_items WHERE user_id = ?', [userId]);
    await conn.execute('DELETE FROM coin_records WHERE user_id = ?', [userId]);
    await removeOwnedAvatars(conn, user, removedFiles);
    await conn.execute(
      `UPDATE users SET openid = CONCAT('deleted:', id, ':', UUID()), nick_name = ?, avatar_url = '',
       level = 1, total_exp = 0, total_income = 0, coins = 0, game_count = 0, win_count = 0,
       is_banned = 0, banned_reason = '', deleted_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [ANONYMOUS_NAME, userId]
    );
    await conn.commit();
    // Finished in-memory snapshots must not outlive their anonymized DB result.
    for (const [sessionId, game] of userCachedGames) {
      clearTimeout(game.timer);
      cachedGames.delete(sessionId);
    }
    return { deleted: true };
  } catch (error) {
    const rollbackErrors = [];
    try { await conn.rollback(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    for (const backup of removedFiles) {
      try {
        await fs.promises.writeFile(backup.file, backup.data, {flag: 'wx'});
      } catch (restoreError) {
        rollbackErrors.push(restoreError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '账号注销回滚失败，需要运营方检查');
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  getProfile,
  updateProfile,
  deleteAccount,
};
