const legal = require('./legal-config');

const CONSENT_KEY = 'legal-consent-version';
let confirmedVersion = '';
let revision = 0;
let developmentPreview = false;

function isDevelopmentPreviewAvailable() {
  try { return wx.getAccountInfoSync().miniProgram.envVersion === 'develop'; }
  catch (_error) { return false; }
}

function isDevelopmentPreview() {
  return developmentPreview && isDevelopmentPreviewAvailable();
}

function canEnter() {
  return isAllowed() || isDevelopmentPreview();
}

function beginDevelopmentPreview() {
  if (!isDevelopmentPreviewAvailable()) throw new Error('开发预览仅适用于开发版');
  revoke();
  developmentPreview = true;
}

function version() {
  return `${legal.legalConfig.privacyVersion}:${legal.legalConfig.agreementVersion}`;
}

function storedVersion() {
  try { return wx.getStorageSync(CONSENT_KEY); } catch (_error) { return ''; }
}

function isAllowed() {
  return legal.isReady() && confirmedVersion === version() && storedVersion() === version();
}

function assertAllowed() {
  if (!isAllowed()) {
    const error = new Error(isDevelopmentPreview()
      ? '当前为本地开发预览，账号登录与联机功能需完成正式协议和微信授权'
      : '请先阅读当前协议并完成微信隐私确认');
    error.code = 'PRIVACY_CONSENT_REQUIRED';
    error.statusCode = 403;
    throw error;
  }
}

async function checkPlatformConsent() {
  confirmedVersion = '';
  const operation = ++revision;
  if (!legal.isReady()) throw new Error('运营主体与正式法律文档尚未配置或生效，当前不可登录或公开使用。可查看说明或退出。');
  if (typeof wx.getPrivacySetting !== 'function' || typeof wx.requirePrivacyAuthorize !== 'function') {
    throw new Error('当前微信版本不支持隐私授权，请升级微信后重试。');
  }
  const checkedVersion = version();
  const result = await new Promise((resolve, reject) => wx.getPrivacySetting({success: resolve, fail: reject}));
  if (!result || typeof result.needAuthorization !== 'boolean') throw new Error('无法确认微信隐私授权状态，请重试。');
  if (operation === revision && !result.needAuthorization && legal.isReady() && version() === checkedVersion && storedVersion() === checkedVersion) {
    confirmedVersion = checkedVersion;
  }
  return isAllowed();
}

async function authorize() {
  developmentPreview = false;
  confirmedVersion = '';
  const operation = ++revision;
  if (!legal.isReady()) throw new Error('正式法律文档尚未配置或生效，当前不可授权。');
  const acceptedVersion = version();
  if (typeof wx.requirePrivacyAuthorize !== 'function') throw new Error('请升级微信后重试隐私授权。');
  await new Promise((resolve, reject) => wx.requirePrivacyAuthorize({success: resolve, fail: reject}));
  if (operation !== revision || !legal.isReady() || version() !== acceptedVersion) throw new Error('授权已取消或法律文档已更新，请重新阅读并授权。');
  wx.setStorageSync(CONSENT_KEY, acceptedVersion);
  confirmedVersion = acceptedVersion;
  assertAllowed();
}

function revoke() {
  developmentPreview = false;
  confirmedVersion = '';
  revision++;
  // 持久化撤回：下次启动必须重新主动确认，而不是读取旧的授权版本直接放行
  try { wx.removeStorageSync(CONSENT_KEY); } catch (_error) { /* 存储不可用时仅保留内存撤回 */ }
}

// Only known game entry routes can be restored; arbitrary routes cannot be injected.
function destination(path, query = {}) {
  const route = String(path || '').replace(/^\//, '');
  if (!['pages/home/index', 'pages/room/index'].includes(route)) return '/pages/home/index';
  const suffix = Object.entries(query).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
  return `/${route}${suffix ? `?${suffix}` : ''}`;
}

function bootUrl(entry = {}) {
  return `/pages/boot/index?returnTo=${encodeURIComponent(destination(entry.path, entry.query))}`;
}

function restoreDestination(value) {
  return typeof value === 'string' && /^\/pages\/(home|room)\/index(?:\?|$)/.test(value)
    ? value : '/pages/home/index';
}

module.exports = {isAllowed, canEnter, isDevelopmentPreviewAvailable, isDevelopmentPreview, beginDevelopmentPreview,
  assertAllowed, checkPlatformConsent, authorize, revoke, bootUrl, restoreDestination};
