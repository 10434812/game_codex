const api = require('./api-client');

const DEFAULT_CONFIG = {
  'wechat.login_enabled': 'true',
  'wechat.share_enabled': 'true',
  'wechat.share_title': '锦鲤前程邀你一起组队闯世界',
  'wechat.share_path': '/pages/home/index',
  'wechat.share_query': 'from=admin_share',
  'wechat.share_image_url': 'https://xcx.ukb88.com/assets/bg/screen.png',
  'wechat.share_timeline_title': '锦鲤前程开启好运局，来和我一起冲榜',
  'wechat.pay_enabled': 'false',
  'wechat.pay_success_path': '/pages/shop/index',
};

let cachedConfig = { ...DEFAULT_CONFIG };
let lastFetchTime = 0;
let pendingPromise = null;

function getConfigMap() {
  return { ...cachedConfig };
}

function getValue(key, fallback = '') {
  if (cachedConfig[key] === undefined || cachedConfig[key] === null || cachedConfig[key] === '') {
    return fallback;
  }
  return cachedConfig[key];
}

function getBoolean(key, fallback = false) {
  const value = getValue(key, fallback ? 'true' : 'false');
  return value === true || value === 'true' || value === 1 || value === '1';
}

async function fetchRemoteConfig(force = false) {
  const now = Date.now();
  if (!force && now - lastFetchTime < 60 * 1000) {
    return getConfigMap();
  }
  if (pendingPromise) {
    return pendingPromise;
  }
  pendingPromise = api.get('/configs/public')
    .then((data) => {
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...(data || {}),
      };
      lastFetchTime = Date.now();
      return getConfigMap();
    })
    .catch((error) => {
      console.warn('[runtime-config] fetchRemoteConfig error:', error);
      return getConfigMap();
    })
    .finally(() => {
      pendingPromise = null;
    });
  return pendingPromise;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfigMap,
  getValue,
  getBoolean,
  fetchRemoteConfig,
};
