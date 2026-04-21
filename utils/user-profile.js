const USER_PROFILE_KEY = 'wx_user_profile_v1';
const PROFILE_REQUEST_COOLDOWN_MS = 1500;

const DEFAULT_PROFILE = {
  nickName: '微信用户',
  avatarUrl: '',
};

let lastRequestTime = 0;
let requestInFlight = null;

function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') {
    return {...DEFAULT_PROFILE};
  }
  const nickName = String(raw.nickName || raw.nickname || '').trim() || DEFAULT_PROFILE.nickName;
  const avatarUrl = String(raw.avatarUrl || '').trim();
  return {
    nickName,
    avatarUrl,
  };
}

function getCachedProfile() {
  try {
    const cached = wx.getStorageSync(USER_PROFILE_KEY);
    return normalizeProfile(cached);
  } catch (error) {
    return {...DEFAULT_PROFILE};
  }
}

function saveProfile(profile) {
  const normalized = normalizeProfile(profile);
  try {
    wx.setStorageSync(USER_PROFILE_KEY, normalized);
  } catch (error) {}
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
  return Boolean(normalized.avatarUrl && normalized.nickName);
}

function requestProfile(options = {}) {
  const {force = false} = options;
  const cached = getCachedProfile();
  if (!force && hasValidProfile(cached)) {
    return Promise.resolve(cached);
  }

  if (requestInFlight) {
    return requestInFlight;
  }

  const now = Date.now();
  if (now - lastRequestTime < PROFILE_REQUEST_COOLDOWN_MS) {
    return Promise.reject(new Error('PROFILE_REQUEST_TOO_FREQUENT'));
  }
  lastRequestTime = now;

  return new Promise((resolve, reject) => {
    if (typeof wx.getUserProfile !== 'function') {
      reject(new Error('getUserProfile unavailable'));
      return;
    }

    requestInFlight = Promise.resolve().then(() =>
      new Promise((innerResolve, innerReject) => {
        wx.getUserProfile({
      desc: '用于展示头像和昵称',
          success: (res) => {
            const profile = saveProfile(res && res.userInfo);
            innerResolve(profile);
          },
          fail: innerReject,
        });
      })
    );

    requestInFlight
      .then(resolve)
      .catch(reject)
      .finally(() => {
        requestInFlight = null;
      });
  });
}

module.exports = {
  DEFAULT_PROFILE,
  getCachedProfile,
  hasValidProfile,
  requestProfile,
  saveProfile,
  updateProfile,
};
