/**
 * 本地存储。小游戏端 storage 与小程序端完全隔离，键名沿用 game_codex_* 命名以便将来识别。
 * 无 wx 环境（Node 测试）时读写静默降级，不抛错。
 */

import {getWx} from './wx';

export const STORAGE_KEYS = {
  gameState: 'game_codex_game_state_v1',
  token: 'game_codex_token_v1',
  guide: 'game_codex_guide_v1',
  stageTheme: 'game_codex_stage_theme_v1',
} as const;

export function readJson<T>(key: string): T | null {
  const wxApi = getWx();
  if (!wxApi) {
    return null;
  }
  try {
    const raw = wxApi.getStorageSync(key);
    if (typeof raw === 'string' && raw !== '') {
      return JSON.parse(raw) as T;
    }
    if (raw && typeof raw === 'object') {
      return raw as T;
    }
    return null;
  } catch (error) {
    console.warn('[storage] 读取失败', key, error);
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  const wxApi = getWx();
  if (!wxApi) {
    return;
  }
  try {
    wxApi.setStorageSync(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[storage] 写入失败', key, error);
  }
}

export function removeKey(key: string): void {
  const wxApi = getWx();
  if (!wxApi) {
    return;
  }
  try {
    wxApi.removeStorageSync(key);
  } catch (error) {
    console.warn('[storage] 删除失败', key, error);
  }
}

/** 读取原始字符串（token、同意版本号等非 JSON 值）。 */
export function readText(key: string): string {
  const wxApi = getWx();
  if (!wxApi) {
    return '';
  }
  try {
    const raw = wxApi.getStorageSync(key);
    return typeof raw === 'string' ? raw : '';
  } catch (error) {
    console.warn('[storage] 读取失败', key, error);
    return '';
  }
}

export function writeText(key: string, value: string): void {
  const wxApi = getWx();
  if (!wxApi) {
    return;
  }
  try {
    wxApi.setStorageSync(key, value);
  } catch (error) {
    console.warn('[storage] 写入失败', key, error);
  }
}
