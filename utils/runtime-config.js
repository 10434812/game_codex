const api = require('./api-client');

const DEFAULT_CONFIG = {
  'wechat.login_enabled': 'true',
  'wechat.login_agreement_url': '',
  'wechat.login_privacy_url': '',
  'wechat.share_enabled': 'true',
  'wechat.share_title': '锦鲤前程邀你一起组队闯世界',
  'wechat.share_desc': '选景区、组战队、拼手气，一起冲上好运榜。',
  'wechat.share_path': '/pages/home/index',
  'wechat.share_query': 'from=admin_share',
  'wechat.share_image_url': 'https://xcx.ukb88.com/assets/bg/screen.png',
  'wechat.share_timeline_title': '锦鲤前程开启好运局，来和我一起冲榜',
  'wechat.share_timeline_image_url': 'https://xcx.ukb88.com/assets/bg/screen.png',
  'wechat.pay_enabled': 'false',
  'wechat.pay_success_path': '/pages/shop/index',
  'wechat.pay_currency': 'CNY',
  'wechat.pay_goods_desc': '锦鲤前程幸运金币充值',
  'system.maintenance_mode': 'false',
  'system.maintenance_message': '',
};

let cachedConfig = { ...DEFAULT_CONFIG };
let cachedFeatures = {};
let lastFetchTime = 0;
let pendingPromise = null;

function getConfigMap() {
  return { ...cachedConfig };
}

function getFeatures() {
  return JSON.parse(JSON.stringify(cachedFeatures || {}));
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
      const remoteConfigs = data && data.configs && typeof data.configs === 'object'
        ? data.configs
        : (data || {});
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...remoteConfigs,
      };
      cachedFeatures = data && data.features && typeof data.features === 'object'
        ? data.features
        : {};
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
  getFeatures,
  getValue,
  getBoolean,
  fetchRemoteConfig,
};
