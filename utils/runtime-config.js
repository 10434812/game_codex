const api = require('./api-client');

const DEFAULT_CONFIG = {
  'wechat.login_enabled': 'true',
  'wechat.login_agreement_url': '/pages/legal/agreement/index',
  'wechat.login_privacy_url': '/pages/legal/privacy/index',
  'wechat.share_enabled': 'true',
  'wechat.share_title': '锦鲤前程邀你一起组队闯世界',
  'wechat.share_desc': '选景区、组战队、拼运气，一起冲上好运榜。',
  'wechat.share_path': '/pages/home/index',
  'wechat.share_query': 'from=admin_share',
  'wechat.share_image_url': '/assets-pkg/share/friends-20261111.jpg',
  'wechat.share_timeline_title': '锦鲤前程开启好运局，来和我一起冲榜',
  'wechat.share_timeline_image_url': '/assets-pkg/share/friends-20261111.jpg',
  'fortune.reality_enabled': 'false',
  'fortune.public_signal_limit': '6',
  // 自建房是否走后端房间。默认关闭：开启后房间页会同时被"本地补机器人"和
  // "每 2s 轮询后端玩家"两套数据源写入，人数与模式文案会互相覆盖。
  // 从分享链接进来的房间不受这个开关影响，始终走后端 join。
  'room.backend_enabled': 'false',
  'system.maintenance_mode': 'false',
  'system.maintenance_message': '',
};

let cachedConfig = { ...DEFAULT_CONFIG };
let cachedFeatures = {};
let lastFetchTime = null;
let pendingPromise = null;

// 开发版本地覆盖：仅 develop 环境生效，用于把 API 指向本地后端、临时打开联机开关。
// 生产/体验版忽略该 storage，避免远程配置被本地值绕过。
const LOCAL_OVERRIDE_KEY = '__runtime_config_override__';

function isDevelopmentEnv() {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
  } catch (_error) {
    return false;
  }
}

function readLocalOverride() {
  if (!isDevelopmentEnv()) return {};
  try {
    const raw = wx.getStorageSync(LOCAL_OVERRIDE_KEY);
    if (raw && typeof raw === 'object') return raw;
    if (typeof raw === 'string' && raw.trim()) return JSON.parse(raw);
  } catch (_error) {}
  return {};
}

cachedConfig = { ...DEFAULT_CONFIG, ...readLocalOverride() };

function getConfigMap() {
  return { ...cachedConfig };
}

function getFeatures() {
  return JSON.parse(JSON.stringify(cachedFeatures || {}));
}

function isApiSupported(name) {
  return cachedFeatures.api?.[name] === true;
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
  if (!force && lastFetchTime !== null && now - lastFetchTime < 60 * 1000) {
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
        ...readLocalOverride(),
      };
      cachedFeatures = data && data.features && typeof data.features === 'object'
        ? data.features
        : {};
      lastFetchTime = Date.now();
      return getConfigMap();
    })
    .catch((error) => {
      console.warn('[runtime-config] fetchRemoteConfig error:', error);
      // Failed attempts must not suppress the next recovery request for 60s.
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
  isApiSupported,
  getValue,
  getBoolean,
  fetchRemoteConfig,
};
