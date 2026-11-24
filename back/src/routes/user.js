const express = require('express');
const multer = require('multer');
const userService = require('../services/user-service');
const contentSafetyService = require('../services/content-safety-service');
const avatarReviewService = require('../services/avatar-review-service');
const authMiddleware = require('../middleware/auth');
const { success, fail } = require('../utils/response');

const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
// Keep unreviewed bytes outside express.static, including during multipart parsing.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_SIZE, files: 1 },
});

const router = express.Router();

router.get('/content-safety/callback', async (req, res) => {
  try {
    const challenge = contentSafetyService.verifyChallenge(req.query);
    res.type('text/plain').send(challenge);
  } catch (_) {
    res.status(403).end();
  }
});

router.post('/content-safety/callback', async (req, res) => {
  try {
    const plain = await contentSafetyService.decodeCallback(req.query, req.body && req.body.Encrypt);
    const event = JSON.parse(plain);
    await avatarReviewService.applyEvent(event);
    res.type('text/plain').send('success');
  } catch (_) {
    res.status(503).end();
  }
});

router.get('/content-safety/media/:token', async (req, res) => {
  try {
    const file = await avatarReviewService.mediaPath(req.params.token);
    if (!file) return res.status(404).end();
    res.set('Cache-Control', 'no-store');
    res.sendFile(file, (error) => { if (error && !res.headersSent) res.status(404).end(); });
  } catch (_) {
    res.status(503).end();
  }
});

router.use(authMiddleware);

// DELETE /api/user/account - permanently remove personal data and anonymize game history
router.delete('/account', async (req, res) => {
  try {
    await userService.deleteAccount(req.user.userId);
    if (authMiddleware.__private && typeof authMiddleware.__private.invalidateUserState === 'function') {
      authMiddleware.__private.invalidateUserState(req.user.userId);
    }
    res.json(success({ deleted: true }, '账号已注销，个人资料已删除'));
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 409) {
      return res.status(err.statusCode).json(fail(err.message, err.statusCode));
    }
    console.error('Delete account error:', err);
    res.status(500).json(fail('账号注销失败，请稍后重试', 500));
  }
});


// POST /api/user/avatar - Upload avatar image
router.post('/avatar', (req, res, next) => {
  avatarUpload.single('file')(req, res, (error) => {
    if (error) return res.status(400).json(fail(error.code === 'LIMIT_FILE_SIZE' ? '头像不能超过2MB' : '头像上传格式错误', 400));
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json(fail('请选择头像文件', 400));
    const review = await avatarReviewService.submit(req.user.userId, req.user.openid, req.file.buffer, { client: req.user.client });
    const profile = await userService.getProfile(req.user.userId);
    res.status(202).json(success({ ...profile, ...review }, review.message));
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json(fail(err.message, 400));
    res.status(503).json(fail('内容安全服务暂不可用，请稍后重试', 503));
  }
});

// GET /api/user/profile
router.get('/profile', async (req, res) => {
  try {
    const profile = await userService.getProfile(req.user.userId);
    res.json(success(profile));
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json(fail(err.message, 404));
    }
    console.error('Get profile error:', err);
    res.status(500).json(fail('获取用户信息失败', 500));
  }
});

// PUT /api/user/profile
router.put('/profile', async (req, res) => {
  try {
    const { nickName, avatarUrl } = req.body;

    if (nickName !== undefined && (typeof nickName !== 'string' || nickName.trim().length === 0)) {
      return res.status(400).json(fail('昵称不能为空', 400));
    }

    if (nickName !== undefined && nickName.length > 32) {
      return res.status(400).json(fail('昵称不能超过32个字符', 400));
    }

    const profile = await userService.updateProfile(req.user.userId, { nickName, avatarUrl }, { client: req.user.client });
    res.json(success(profile, '更新成功'));
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json(fail(err.message, 400));
    }
    if (err.statusCode === 503) {
      return res.status(503).json(fail('内容安全服务暂不可用，请稍后重试', 503));
    }
    if (err.statusCode === 404) {
      return res.status(404).json(fail(err.message, 404));
    }
    console.error('Update profile error:', err);
    res.status(500).json(fail('更新用户信息失败', 500));
  }
});

module.exports = router;
