const express = require('express');
const multer = require('multer');
const path = require('path');
const userService = require('../services/user-service');
const uploadService = require('../services/upload-service');
const authMiddleware = require('../middleware/auth');
const { success, fail } = require('../utils/response');

const AVATAR_DIR = path.resolve(__dirname, '../../uploads/avatars');
const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2MB

const avatarStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    uploadService.ensureDir(AVATAR_DIR);
    cb(null, AVATAR_DIR);
  },
  filename(_req, file, cb) {
    cb(null, uploadService.generateUniqueName(file.originalname));
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: AVATAR_MAX_SIZE },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      return cb(new Error('仅支持 jpg/png/webp 格式'));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.use(authMiddleware);

// POST /api/user/avatar - Upload avatar image
router.post('/avatar', avatarUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(fail('请选择头像文件', 400));
    }
    const baseUrl = process.env.CDN_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const avatarUrl = uploadService.buildAvatarUrl(req.file.filename, { baseUrl });
    const profile = await userService.updateProfile(req.user.userId, { avatarUrl });
    res.json(success(profile, '头像上传成功'));
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json(fail('头像上传失败', 500));
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

    const profile = await userService.updateProfile(req.user.userId, { nickName, avatarUrl });
    res.json(success(profile, '更新成功'));
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json(fail(err.message, 400));
    }
    if (err.statusCode === 404) {
      return res.status(404).json(fail(err.message, 404));
    }
    console.error('Update profile error:', err);
    res.status(500).json(fail('更新用户信息失败', 500));
  }
});

module.exports = router;
