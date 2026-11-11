const api = require('./api-client');
const runtimeConfig = require('./runtime-config');
const shopStore = require('./shop-store');
const privacyConsent = require('./privacy-consent');

const USER_PROFILE_KEY = 'wx_user_profile_v1';
const LOGOUT_INTENT_KEY = 'auth.logout-intent';
let sessionRevision = 0;

const DEFAULT_PROFILE = {
  nickName: '微信用户',
  avatarUrl: '',
};

function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PROFILE };
  }
  return {
    nickName: String(raw.nickName || raw.nick_name || '').trim() || DEFAULT_PROFILE.nickName,
    avatarUrl: String(raw.avatarUrl || raw.avatar_url || '').trim(),
  };
}

function getCachedProfile() {
  if (privacyConsent.isDevelopmentPreview()) return {...DEFAULT_PROFILE};
  try {
    const cached = wx.getStorageSync(USER_PROFILE_KEY);
    return normalizeProfile(cached);
  } catch (e) {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(profile) {
  const normalized = normalizeProfile(profile);
  try {
    wx.setStorageSync(USER_PROFILE_KEY, normalized);
  } catch (e) {
    console.warn('[user-profile] saveProfile error:', e);
  }
  return normalized;
}

function mergeProfile(partial = {}) {
  const current = getCachedProfile();
  const incoming = normalizeProfile(partial);
  const merged = {
    nickName: incoming.nickName || current.nickName,
    avatarUrl: Object.prototype.hasOwnProperty.call(partial, 'avatarUrl') || Object.prototype.hasOwnProperty.call(partial, 'avatar_url') ? incoming.avatarUrl : current.avatarUrl,
  };
  return saveProfile(merged);
}

function updateProfile(partial = {}) {
  const merged = {
    ...getCachedProfile(),
    ...partial,
  };
  return saveProfile(merged);
}

function hasValidProfile(profile) {
  const normalized = normalizeProfile(profile);
  return Boolean(normalized.nickName && normalized.nickName !== '微信用户');
}

async function login({onAuthenticated, previousToken} = {}) {
  privacyConsent.assertAllowed();
  if (!runtimeConfig.getBoolean('wechat.login_enabled', true)) {
    return getCachedProfile();
  }
  const revision = ++sessionRevision;
  const initialToken = api.getToken();
  try {
    const { code } = await new Promise((resolve, reject) => {
      wx.login({
        success: (res) => {
          if (res.code) resolve(res);
          else reject(new Error('wx.login failed: ' + (res.errMsg || '')));
        },
        fail: reject,
      });
    });
    if (revision !== sessionRevision || initialToken !== api.getToken()) return getCachedProfile();
    
    const result = previousToken
      ? await api.request('POST', '/auth/refresh', {code}, {authToken: previousToken, noRecovery: true})
      : await api.post('/auth/login', {code});
    if (!result || !result.token || !result.user) {
      throw new Error('登录响应不完整，请重新登录');
    }
    if (revision !== sessionRevision || initialToken !== api.getToken()) return getCachedProfile();
    shopStore.resetAccountState();
    api.setToken(result.token);
    if (onAuthenticated) onAuthenticated(result.token);
    // 新账号资料不能与上个账号或游客资料合并。
    const profile = saveProfile(result.user);
    try {
      await shopStore.refreshInventory(result.user);
      if (revision !== sessionRevision || api.getToken() !== result.token) return getCachedProfile();
    } catch (error) {
      if (revision !== sessionRevision || api.getToken() !== result.token) return getCachedProfile();
      if (typeof wx.showToast === 'function') {
        wx.showToast({title: '登录成功，账号资产同步失败，请在商城重试', icon: 'none'});
      }
    }
    return profile;
  } catch (err) {
    console.warn('[user-profile] login error:', err);
    return getCachedProfile();
  }
}

async function requestUpdate(partial = {}) {
  if (!api.isLoggedIn()) throw new Error('请先登录后保存资料');
  const result = await api.put('/user/profile', { nickName: partial.nickName });
  if (!result) throw new Error('资料保存失败，请重试');
  mergeProfile(result);
  return getCachedProfile();
}

async function uploadAvatar(filePath) {
  const avatarUrl = String(filePath || '').trim();
  if (!avatarUrl) throw new Error('请选择头像文件');
  if (!api.isLoggedIn()) throw new Error('请先登录后上传头像');
  const result = await api.uploadFile('/user/avatar', avatarUrl, 'file');
  if (!result) throw new Error('头像上传失败，请重试');
  mergeProfile(result);
  return { ...getCachedProfile(), avatarReview: result.avatarReview };
}

function logout() {
  clearLocalData();
  // 记录用户主动退出的意图：冷启动时不得立即用 wx.login 自动换回同一账号（I-5）
  try {
    wx.setStorageSync(LOGOUT_INTENT_KEY, '1');
  } catch (e) {
    console.warn('[user-profile] logout intent write error:', e);
  }
}

function hasLogoutIntent() {
  try {
    return wx.getStorageSync(LOGOUT_INTENT_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function clearLogoutIntent() {
  try {
    wx.removeStorageSync(LOGOUT_INTENT_KEY);
  } catch (e) {
    console.warn('[user-profile] logout intent clear error:', e);
  }
}

async function deleteAccount() {
  const revision = sessionRevision;
  const token = api.getToken();
  const result = await api.del('/user/account');
  if ((revision !== sessionRevision || token !== api.getToken()) && !api.isRecoveredToken(token, api.getToken())) {
    throw new Error('登录账号已变更，请重新操作');
  }
  clearLocalData();
  // 注销后回到启动页必须重新主动同意，不能自动登录并重建账号。
  privacyConsent.revoke();
  wx.removeStorageSync('legal-consent-version');
  return result;
}

function clearLocalData() {
  sessionRevision += 1;
  try {
    wx.removeStorageSync(USER_PROFILE_KEY);
  } catch (e) {
    console.warn('[user-profile] clearLocalData error:', e);
  }
  api.clearToken();
  shopStore.resetAccountState();
}

async function fetchProfile() {
  try {
    if (api.isLoggedIn()) {
      const token = api.getToken();
      const revision = sessionRevision;
      const result = await api.get('/user/profile');
      if (token !== api.getToken() || revision !== sessionRevision) return getCachedProfile();
      if (result) {
        saveProfile(result);
        await shopStore.refreshInventory(result);
        if (token !== api.getToken() || revision !== sessionRevision) return getCachedProfile();
        return normalizeProfile(result);
      }
    }
  } catch (err) {
    console.warn('[user-profile] fetchProfile error:', err);
    if (typeof wx.showToast === 'function') {
      wx.showToast({title: '账号资料或资产同步失败，请稍后重试', icon: 'none'});
    }
  }
  return getCachedProfile();
}

module.exports = {
  DEFAULT_PROFILE,
  getCachedProfile,
  hasValidProfile,
  saveProfile,
  mergeProfile,
  updateProfile,
  login,
  requestUpdate,
  uploadAvatar,
  fetchProfile,
  deleteAccount,
  logout,
  hasLogoutIntent,
  clearLogoutIntent,
  clearLocalData,
};
