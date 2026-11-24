const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../models/db');
const safety = require('./content-safety-service');

const PRIVATE_DIR = path.resolve(__dirname, '../../private/avatar-reviews');
const PUBLIC_DIR = path.resolve(__dirname, '../../uploads/avatars');

async function normalizeImage(buffer) {
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  try {
    if (!jpeg && !png) throw new Error('unsupported');
    // Decode before review; do not publish EXIF/GPS, comments or ancillary chunks.
    // Review and publication both use these exact normalized bytes.
    return await sharp(buffer, { limitInputPixels: 16777216, failOn: 'warning' })
      .rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png().toBuffer();
  } catch (_) {
    const error = new Error('头像必须是有效的 jpg/png 图片，且像素不能超过 16777216');
    error.statusCode = 400;
    throw error;
  }
}

async function expirePending() {
  const candidates = await db.queryAll("SELECT id, user_id FROM avatar_reviews WHERE status = 'pending' AND expires_at <= NOW()");
  for (const candidate of candidates) {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [users] = await conn.execute('SELECT id, avatar_url FROM users WHERE id = ? FOR UPDATE', [candidate.user_id]);
      const [rows] = await conn.execute('SELECT *, expires_at <= NOW() AS is_expired FROM avatar_reviews WHERE id = ? FOR UPDATE', [candidate.id]);
      const row = rows[0];
      if (row && row.status === 'pending' && Number(row.is_expired) === 1) {
        await unlinkIfPresent(path.join(PRIVATE_DIR, path.basename(row.filename)));
        if (!users[0] || users[0].avatar_url !== row.avatar_url) {
          await unlinkIfPresent(path.join(PUBLIC_DIR, path.basename(row.filename)));
        }
        await conn.execute("UPDATE avatar_reviews SET status = 'rejected' WHERE id = ?", [row.id]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}

async function submit(userId, openid, buffer, { client = 'miniprogram' } = {}) {
  const { baseUrl } = safety.callbackSettings();
  buffer = await normalizeImage(buffer);
  await expirePending();
  const token = crypto.randomBytes(32).toString('hex');
  const filename = `${userId}_${crypto.randomBytes(16).toString('hex')}.png`;
  const avatarUrl = `${baseUrl}/uploads/avatars/${filename}`;
  await fs.promises.mkdir(PRIVATE_DIR, { recursive: true });
  const file = path.join(PRIVATE_DIR, filename);
  let reviewId;
  try {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [users] = await conn.execute('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND is_banned = 0 FOR UPDATE', [userId]);
      if (!users.length) throw safetyError();
      await fs.promises.writeFile(file, buffer, { flag: 'wx' });
      const [insert] = await conn.execute(
        'INSERT INTO avatar_reviews (user_id, download_token, filename, avatar_url, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
        [userId, token, filename, avatarUrl]
      );
      reviewId = insert.insertId;
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
    const traceId = await safety.checkImage(`${baseUrl}/api/user/content-safety/media/${token}`, openid, client);
    await db.execute('UPDATE avatar_reviews SET trace_id = ? WHERE id = ?', [traceId, reviewId]);
    return { avatarReview: 'pending', message: '头像审核中，通过后自动生效' };
  } catch (error) {
    if (reviewId) {
      // The trace write may have committed even if its response failed. Serialize
      // failure cleanup with a callback; never turn an approved review into rejected.
      const conn = await db.pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
        const [rows] = await conn.execute('SELECT status FROM avatar_reviews WHERE id = ? FOR UPDATE', [reviewId]);
        if (rows[0] && rows[0].status === 'pending') {
          await unlinkIfPresent(file);
          await conn.execute("UPDATE avatar_reviews SET status = 'rejected' WHERE id = ?", [reviewId]);
        }
        await conn.commit();
      } catch (cleanupError) {
        await conn.rollback();
        throw cleanupError;
      } finally {
        conn.release();
      }
    } else {
      await unlinkIfPresent(file);
    }
    throw error;
  }
}

async function mediaPath(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await db.queryOne("SELECT filename FROM avatar_reviews WHERE download_token = ? AND status = 'pending' AND expires_at > NOW()", [token]);
  return row ? path.join(PRIVATE_DIR, path.basename(row.filename)) : null;
}

async function applyEvent(event) {
  if (event.Event !== 'wxa_media_check' || event.MsgType !== 'event' || event.version !== 2 || typeof event.trace_id !== 'string') return;
  const review = await db.queryOne('SELECT user_id FROM avatar_reviews WHERE trace_id = ?', [event.trace_id]);
  if (!review) throw safetyError();
  const conn = await db.pool.getConnection();
  let completedReview;
  try {
    await conn.beginTransaction();
    const [users] = await conn.execute('SELECT id, avatar_url FROM users WHERE id = ? AND deleted_at IS NULL AND is_banned = 0 FOR UPDATE', [review.user_id]);
    const [rows] = await conn.execute('SELECT *, expires_at > NOW() AS is_valid FROM avatar_reviews WHERE trace_id = ? FOR UPDATE', [event.trace_id]);
    const row = rows[0];
    if (!row) throw safetyError(); // Submission may still be saving its trace; request a retry.
    const privateFile = path.join(PRIVATE_DIR, path.basename(row.filename));
    const publicFile = path.join(PUBLIC_DIR, path.basename(row.filename));
    if (row.status === 'pending') {
      const [latest] = await conn.execute('SELECT id FROM avatar_reviews WHERE user_id = ? ORDER BY id DESC LIMIT 1', [row.user_id]);
      // Compare expiry using the database clock, not a timezone-dependent JS
      // interpretation of MySQL DATETIME.
      const approve = users.length > 0 && String(latest[0].id) === String(row.id) && Number(row.is_valid) === 1
        && event.errcode === 0 && event.result && event.result.suggest === 'pass';
      if (approve) {
        await fs.promises.mkdir(PUBLIC_DIR, { recursive: true });
        try {
          await fs.promises.copyFile(privateFile, publicFile, fs.constants.COPYFILE_EXCL);
        } catch (error) {
          // A prior attempt may have copied this immutable, reviewed file before
          // its DB write failed. Never unlink a file merely because copy failed.
          if (error.code !== 'EEXIST') throw error;
        }
        await conn.execute('UPDATE users SET avatar_url = ?, updated_at = NOW() WHERE id = ?', [row.avatar_url, row.user_id]);
      } else if (!users.length || users[0].avatar_url !== row.avatar_url) {
        // A failed earlier publish may have left reviewed bytes without a DB
        // reference. User/row locks exclude concurrent callbacks and deletion.
        await unlinkIfPresent(publicFile);
      }
      await conn.execute('UPDATE avatar_reviews SET status = ? WHERE id = ?', [approve ? 'approved' : 'rejected', row.id]);
    }
    await conn.commit();
    completedReview = row;
  } catch (error) {
    // Rollback does not undo files. Retain reviewed bytes on an uncertain COMMIT
    // instead of racing a retry and deleting its successfully published image.
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  // Return the publication connection before acquiring a cleanup connection;
  // concurrent callbacks must not exhaust the pool while waiting for themselves.
  await cleanupCompletedReview(completedReview, path.join(PRIVATE_DIR, path.basename(completedReview.filename)));
}

async function unlinkIfPresent(file) {
  try { await fs.promises.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function cleanupCompletedReview(review, privateFile) {
  // A new transaction keeps cleanup mutually exclusive with replacement and
  // account deletion, including callbacks retried after a committed publish.
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.execute('SELECT id, avatar_url FROM users WHERE id = ? FOR UPDATE', [review.user_id]);
    const [rows] = await conn.execute('SELECT status FROM avatar_reviews WHERE id = ? FOR UPDATE', [review.id]);
    if (rows[0] && rows[0].status !== 'pending') await unlinkIfPresent(privateFile);
    if (rows[0] && rows[0].status === 'rejected' && (!users[0] || users[0].avatar_url !== review.avatar_url)) {
      await unlinkIfPresent(path.join(PUBLIC_DIR, path.basename(review.filename)));
    }
    if (users[0]) {
      const [obsolete] = await conn.execute(
        "SELECT filename FROM avatar_reviews WHERE user_id = ? AND status = 'approved' AND avatar_url <> ?",
        [review.user_id, users[0].avatar_url]
      );
      for (const item of obsolete) await unlinkIfPresent(path.join(PUBLIC_DIR, path.basename(item.filename)));
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function safetyError() {
  const error = new Error('内容安全服务暂不可用，请稍后重试');
  error.statusCode = 503;
  return error;
}

module.exports = { submit, mediaPath, applyEvent, expirePending };
