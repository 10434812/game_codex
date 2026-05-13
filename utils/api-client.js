// utils/api-client.js — Central API client for mini-program
// Handles JWT, base URL, error handling

const TOKEN_KEY = 'game_codex_api_token_v1';
const BASE_URL_KEY = 'game_codex_api_base_url_v1';
const DEFAULT_BASE_URL = 'https://xcx.ukb88.com/api';

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getBaseUrl() {
  try {
    const stored = normalizeBaseUrl(wx.getStorageSync(BASE_URL_KEY));
    if (stored) {
      return stored;
    }
  } catch (e) {}
  return DEFAULT_BASE_URL;
}

function setBaseUrl(url) {
  const normalized = normalizeBaseUrl(url);
  try {
    if (normalized) {
      wx.setStorageSync(BASE_URL_KEY, normalized);
    } else {
      wx.removeStorageSync(BASE_URL_KEY);
    }
  } catch (e) {
    console.warn('[api-client] setBaseUrl error:', e);
  }
  return getBaseUrl();
}

/**
 * Get stored JWT token
 */
function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Store JWT token
 */
function setToken(token) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
  } catch (e) {
    console.warn('[api-client] setToken error:', e);
  }
}

/**
 * Clear JWT token (used on logout or 401)
 */
function clearToken() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
  } catch (e) {
    console.warn('[api-client] clearToken error:', e);
  }
}

/**
 * Check if user is logged in (has token)
 */
function isLoggedIn() {
  return !!getToken();
}

/**
 * Make an API request
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path - API path (e.g., '/auth/login')
 * @param {object} data - Request body (for POST/PUT)
 * @param {object} options - { noAuth: false }
 * @returns {Promise<object>} Response data
 */
function request(method, path, data = null, options = {}) {
  return new Promise((resolve, reject) => {
    const token = getToken();
    const header = {};

    if (token && !options.noAuth) {
      header['Authorization'] = 'Bearer ' + token;
    }

    wx.request({
      url: getBaseUrl() + path,
      method: method,
      data: data,
      header: header,
      success(res) {
        const body = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          resolve(body.data);
        } else if (res.statusCode === 401) {
          clearToken();
          reject(new Error('登录已过期'));
        } else {
          reject(new Error((body && body.message) || '请求失败'));
        }
      },
      fail(err) {
        reject(new Error('网络错误: ' + (err.errMsg || '未知错误')));
      }
    });
  });
}

// Convenience methods
function get(path, params = null) {
  // For GET requests with params, append to path as query string
  let url = path;
  if (params) {
    const qs = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    if (qs) url += '?' + qs;
  }
  return request('GET', url);
}

function post(path, data = {}) {
  return request('POST', path, data);
}

function put(path, data = {}) {
  return request('PUT', path, data);
}

function del(path) {
  return request('DELETE', path);
}

module.exports = {
  getToken,
  setToken,
  clearToken,
  isLoggedIn,
  getBaseUrl,
  setBaseUrl,
  request,
  get,
  post,
  put,
  del,
};
