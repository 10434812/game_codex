import {analytics} from './Analytics';
/**
 * 用户资料（原 utils/user-profile.js）。
 *
 * 资料缓存与会话版本号（sessionRevision）用于防止「切换账号后旧请求回写新账号」：
 * 任何异步流程回来时都会先比对 revision 与 token。
 */

import * as api from './ApiClient';
import * as privacyConsent from './PrivacyConsent';
import * as runtimeConfig from './RuntimeConfig';
import * as shopStore from './ShopStore';
import {showTrialAccessDialog, toast} from '../platform/feedback';
import {requestLoginCode} from '../platform/request';
import {readJson, removeKey, writeJson} from '../platform/storage';

const USER_PROFILE_KEY = 'wx_user_profile_v1';
let sessionRevision = 0;

export interface UserProfile {
  nickName: string;
  avatarUrl: string;
}

export interface RawProfile {
  nickName?: unknown;
  nick_name?: unknown;
  avatarUrl?: unknown;
  avatar_url?: unknown;
  avatarReview?: unknown;
  [key: string]: unknown;
}

export const DEFAULT_PROFILE: UserProfile = {
  nickName: '微信用户',
  avatarUrl: '',
};

/** 空的部分资料：显式常量，避免把 `{}` 当默认值触发索引签名不匹配。 */
const NO_PROFILE_FIELDS: RawProfile = {};

export function normalizeProfile(raw: unknown): UserProfile {
  if (!raw || typeof raw !== 'object') {
    return {...DEFAULT_PROFILE};
  }
  const source = raw as RawProfile;
  return {
    nickName: String(source.nickName || source.nick_name || '').trim() || DEFAULT_PROFILE.nickName,
    avatarUrl: String(source.avatarUrl || source.avatar_url || '').trim(),
  };
}

export function getCachedProfile(): UserProfile {
  return normalizeProfile(readJson<UserProfile>(USER_PROFILE_KEY));
}

export function saveProfile(profile: unknown): UserProfile {
  const normalized = normalizeProfile(profile);
  writeJson(USER_PROFILE_KEY, normalized);
  return normalized;
}

function hasOwn(source: unknown, key: string): boolean {
  return !!source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key);
}

/** 合并服务端返回的部分资料。入参直接来自接口，因此按 unknown 接收再自行取值。 */
export function mergeProfile(partial: unknown = {}): UserProfile {
  const current = getCachedProfile();
  const incoming = normalizeProfile(partial);
  const merged = {
    nickName: incoming.nickName || current.nickName,
    avatarUrl:
      hasOwn(partial, 'avatarUrl') || hasOwn(partial, 'avatar_url') ? incoming.avatarUrl : current.avatarUrl,
  };
  return saveProfile(merged);
}

export function updateProfile(partial: RawProfile = NO_PROFILE_FIELDS): UserProfile {
  const merged = {...getCachedProfile(), ...partial};
  return saveProfile(merged);
}

export function hasValidProfile(profile: unknown): boolean {
  const normalized = normalizeProfile(profile);
  return Boolean(normalized.nickName && normalized.nickName !== '微信用户');
}

function readLoginResult(result: unknown): {token: string; user: RawProfile} | null {
  if (!result || typeof result !== 'object' || !('token' in result) || !('user' in result)) {
    return null;
  }
  const token = result.token;
  const user = result.user;
  if (typeof token !== 'string' || token === '' || !user || typeof user !== 'object') {
    return null;
  }
  return {token, user: user as RawProfile};
}

/** 受邀体验拒绝登录时服务端返回的体验编号；其他错误返回 0。 */
export function readTrialUserId(error: unknown): number {
  const body = error && typeof error === 'object' && 'responseBody' in error ? (error as {responseBody?: unknown}).responseBody : undefined;
  const data = body && typeof body === 'object' && 'data' in body ? (body as {data?: unknown}).data : undefined;
  if (!data || typeof data !== 'object') return 0;
  const record = data as {code?: unknown; trialUserId?: unknown};
  const id = record.code === 'TRIAL_ACCESS_REQUIRED' ? Number(record.trialUserId) : 0;
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function readAvatarReview(result: unknown): string | undefined {
  if (result && typeof result === 'object' && 'avatarReview' in result) {
    const review = result.avatarReview;
    return typeof review === 'string' ? review : undefined;
  }
  return undefined;
}

export async function login(): Promise<UserProfile> {
  privacyConsent.assertAllowed();
  if (!runtimeConfig.getBoolean('wechat.login_enabled', true)) {
    return getCachedProfile();
  }
  const revision = ++sessionRevision;
  const initialToken = api.getToken();
  try {
    const code = await requestLoginCode();
    if (revision !== sessionRevision || initialToken !== api.getToken()) {
      return getCachedProfile();
    }

    const parsed = readLoginResult(await api.post('/auth/login', {code, client: 'minigame'}));
    if (!parsed) {
      throw new Error('登录响应不完整，请重新登录');
    }
    if (revision !== sessionRevision || initialToken !== api.getToken()) {
      return getCachedProfile();
    }
    shopStore.resetAccountState();
    api.setToken(parsed.token);
    // 新账号资料不能与上个账号或游客资料合并。
    const profile = saveProfile(parsed.user);
    try {
      await shopStore.refreshInventory(parsed.user);
      if (revision !== sessionRevision || api.getToken() !== parsed.token) {
        return getCachedProfile();
      }
    } catch (error) {
      if (revision !== sessionRevision || api.getToken() !== parsed.token) {
        return getCachedProfile();
      }
      console.warn('[user-profile] refreshInventory error:', error);
      toast('登录成功，账号资产同步失败，请在商城重试');
    }
    analytics.track('login_success');
    return profile;
  } catch (error) {
    analytics.track('login_fail');
    const trialUserId = readTrialUserId(error);
    if (trialUserId && revision === sessionRevision) showTrialAccessDialog(trialUserId);
    console.warn('[user-profile] login error:', error);
    throw error;
  }
}

export async function requestUpdate(partial: {nickName?: string} = {}): Promise<UserProfile> {
  if (!api.isLoggedIn()) {
    throw new Error('请先登录后保存资料');
  }
  const result = await api.put('/user/profile', {nickName: partial.nickName});
  if (!result) {
    throw new Error('资料保存失败，请重试');
  }
  mergeProfile(result);
  return getCachedProfile();
}

export async function uploadAvatar(filePath: string): Promise<UserProfile & {avatarReview?: string}> {
  const avatarUrl = String(filePath || '').trim();
  if (!avatarUrl) {
    throw new Error('请选择头像文件');
  }
  if (!api.isLoggedIn()) {
    throw new Error('请先登录后上传头像');
  }
  const result = await api.uploadFile('/user/avatar', avatarUrl, 'file');
  if (!result) {
    throw new Error('头像上传失败，请重试');
  }
  mergeProfile(result);
  return {...getCachedProfile(), avatarReview: readAvatarReview(result)};
}

export function logout(): void {
  clearLocalData();
}

export async function deleteAccount(): Promise<unknown> {
  const revision = sessionRevision;
  const token = api.getToken();
  const result = await api.del('/user/account');
  if (revision !== sessionRevision || token !== api.getToken()) {
    throw new Error('登录账号已变更，请重新操作');
  }
  clearLocalData();
  // 注销后回到启动页必须重新主动同意，不能自动登录并重建账号。
  privacyConsent.revoke();
  privacyConsent.clearStoredConsent();
  return result;
}

export function clearLocalData(): void {
  sessionRevision += 1;
  removeKey(USER_PROFILE_KEY);
  api.clearToken();
  shopStore.resetAccountState();
}

export async function fetchProfile(): Promise<UserProfile> {
  try {
    if (api.isLoggedIn()) {
      const token = api.getToken();
      const revision = sessionRevision;
      const result = await api.get('/user/profile');
      if (token !== api.getToken() || revision !== sessionRevision) {
        throw new Error('登录账号已变更，请重新同步');
      }
      if (result) {
        saveProfile(result);
        await shopStore.refreshInventory(result);
        if (token !== api.getToken() || revision !== sessionRevision) {
          return getCachedProfile();
        }
        return normalizeProfile(result);
      }
    }
  } catch (error) {
    console.warn('[user-profile] fetchProfile error:', error);
    toast('账号资料或资产同步失败，请稍后重试');
  }
  return getCachedProfile();
}
