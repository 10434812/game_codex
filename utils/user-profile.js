const api = require('./api-client');
const runtimeConfig = require('./runtime-config');

const USER_PROFILE_KEY = 'wx_user_profile_v1';

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

async function login() {
  if (!runtimeConfig.getBoolean('wechat.login_enabled', true)) {
    return getCachedProfile();
  }
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
    
    const result = await api.post('/auth/login', { code });
    if (result.token) {
      api.setToken(result.token);
    }
    if (result.user) {
      const profile = saveProfile({
        nickName: result.user.nickName || result.user.nick_name,
        avatarUrl: result.user.avatarUrl || result.user.avatar_url,
      });
      return profile;
    }
    return getCachedProfile();
  } catch (err) {
    console.warn('[user-profile] login error:', err);
    return getCachedProfile();
  }
}

async function requestUpdate(partial = {}) {
  try {
    const result = await api.put('/user/profile', {
      nickName: partial.nickName,
      avatarUrl: partial.avatarUrl,
    });
    if (result) {
      saveProfile(result);
    }
    return getCachedProfile();
  } catch (err) {
    console.warn('[user-profile] requestUpdate error:', err);
    return updateProfile(partial);
  }
}

async function fetchProfile() {
  try {
    if (api.isLoggedIn()) {
      const result = await api.get('/user/profile');
      if (result) {
        saveProfile(result);
        return normalizeProfile(result);
      }
    }
  } catch (err) {
    console.warn('[user-profile] fetchProfile error:', err);
  }
  return getCachedProfile();
}

module.exports = {
  DEFAULT_PROFILE,
  getCachedProfile,
  hasValidProfile,
  saveProfile,
  updateProfile,
  login,
  requestUpdate,
  fetchProfile,
};
