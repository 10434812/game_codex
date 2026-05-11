const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SAFE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateUniqueName(originalName) {
  const ext = path.extname(originalName || 'avatar.png').toLowerCase();
  const finalExt = SAFE_EXTS.includes(ext) ? ext : '.png';
  const rand = crypto.randomBytes(8).toString('hex');
  return `${Date.now()}_${rand}${finalExt}`;
}

function buildAvatarUrl(filename, options = {}) {
  const base = (options.baseUrl || '').replace(/\/+$/, '');
  return `${base}/uploads/avatars/${filename}`;
}

module.exports = {
  ensureDir,
  generateUniqueName,
  buildAvatarUrl,
};