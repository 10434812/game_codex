/**
 * 运行时配置（原 utils/runtime-config.js）。
 * 远端配置覆盖本地默认值，60 秒内不重复拉取；并发调用共用同一个请求。
 */

import * as api from './ApiClient';

export const DEFAULT_CONFIG: Record<string, string> = {
  'wechat.login_enabled': 'true',
  'wechat.login_agreement_url': '/pages/legal/agreement/index',
  'wechat.login_privacy_url': '/pages/legal/privacy/index',
  'wechat.share_enabled': 'true',
  'wechat.share_title': '锦鲤前程邀你一起组队闯世界',
  'wechat.share_desc': '选景区、组战队、拼运气，一起冲上好运榜。',
  'wechat.share_path': '/pages/home/index',
  'wechat.share_query': 'from=admin_share',
  'wechat.share_image_url': '/assets-pkg/bg/screen.jpg',
  'wechat.share_timeline_title': '锦鲤前程开启好运局，来和我一起冲榜',
  'wechat.share_timeline_image_url': '/assets-pkg/bg/screen.jpg',
  'fortune.reality_enabled': 'false',
  'fortune.public_signal_limit': '6',
  // 自建房是否走后端房间。默认关闭：开启后房间页会同时被"本地补机器人"和
  // "每 2s 轮询后端玩家"两套数据源写入，人数与模式文案会互相覆盖。
  // 从分享链接进来的房间不受这个开关影响，始终走后端 join。
  'room.backend_enabled': 'false',
  'system.maintenance_mode': 'false',
  'system.maintenance_message': '',
};

const CONFIG_CACHE_TTL_MS = 60 * 1000;

let cachedConfig: Record<string, string> = {...DEFAULT_CONFIG};
let cachedFeatures: Record<string, unknown> = {};
let lastFetchTime = 0;
let pendingPromise: Promise<Record<string, string>> | null = null;

export function getConfigMap(): Record<string, string> {
  return {...cachedConfig};
}

export function getFeatures(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(cachedFeatures || {})) as Record<string, unknown>;
}

/** 原始值：远端可能给出布尔或数字，不做字符串化，交给调用方判断。 */
function readRaw(key: string, fallback: unknown): unknown {
  const value = cachedConfig[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

export function getValue(key: string, fallback = ''): string {
  return readRaw(key, fallback) as string;
}

export function getBoolean(key: string, fallback = false): boolean {
  const value = readRaw(key, fallback ? 'true' : 'false');
  return value === true || value === 'true' || value === 1 || value === '1';
}

function readConfigs(data: unknown): Record<string, string> {
  if (data && typeof data === 'object' && 'configs' in data) {
    const configs = data.configs;
    if (configs && typeof configs === 'object') {
      return configs as Record<string, string>;
    }
  }
  if (data && typeof data === 'object') {
    return data as Record<string, string>;
  }
  return {};
}

function readFeatures(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && 'features' in data) {
    const features = data.features;
    if (features && typeof features === 'object') {
      return features as Record<string, unknown>;
    }
  }
  return {};
}

export async function fetchRemoteConfig(force = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!force && now - lastFetchTime < CONFIG_CACHE_TTL_MS) {
    return getConfigMap();
  }
  if (pendingPromise) {
    return pendingPromise;
  }
  pendingPromise = api
    .get('/configs/public')
    .then((data) => {
      cachedConfig = {...DEFAULT_CONFIG, ...readConfigs(data)};
      cachedFeatures = readFeatures(data);
      lastFetchTime = Date.now();
      return getConfigMap();
    })
    .catch((error) => {
      console.warn('[runtime-config] fetchRemoteConfig error:', error);
      lastFetchTime = Date.now();
      return getConfigMap();
    })
    .finally(() => {
      pendingPromise = null;
    });
  return pendingPromise;
}

/** @private 仅测试使用 - 生产代码不要调用 */
export function __resetForTests(): void {
  cachedConfig = {...DEFAULT_CONFIG};
  cachedFeatures = {};
  lastFetchTime = 0;
  pendingPromise = null;
}
