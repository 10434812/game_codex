// utils/api-client.js — Central API client for mini-program
// Handles JWT, base URL, error handling

const privacy = require('./privacy-consent');

const TOKEN_KEY = 'game_codex_api_token_v1';
const BASE_URL_KEY = 'game_codex_api_base_url_v1';
const DEFAULT_BASE_URL = 'https://xcx.ukb88.com/api';

// 请求超时（微信默认 60s 太久，弱网/挂起时用户等待过长）
const REQUEST_TIMEOUT_MS = 10000;
const UPLOAD_TIMEOUT_MS = 15000;
// 幂等 GET 失败重试：1 次，500ms 退避
const GET_RETRY_DELAY_MS = 500;
let recoveryPromise = null;
let recoveryToken = '';
let recoveredTokens = null;

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
  if (privacy.isDevelopmentPreview()) return '';
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
  recoveredTokens = null;
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
  recoveredTokens = null;
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

function isRecoveredToken(previous, current) {
  return !!recoveredTokens && recoveredTokens.previous === previous && recoveredTokens.current === current;
}

function startAuthenticationRecovery(token) {
  if (recoveryPromise || typeof wx.login !== 'function' || !require('./runtime-config').isApiSupported('authRefresh')) return;
  recoveryToken = token;
  let renewedToken = '';
  recoveryPromise = require('./user-profile').login({previousToken: token, onAuthenticated(current) {
    renewedToken = current;
    recoveredTokens = {previous: token, current};
  }}).then(() => renewedToken, () => '').finally(() => {
    recoveryPromise = null;
    recoveryToken = '';
  });
}

function recoverAuthentication(error, token, path, retry) {
  if (error.statusCode !== 401 || !token || path === '/auth/login') throw error;
  if (isRecoveredToken(token, getToken())) return retry();
  if (!recoveryPromise && error.authInvalidated) startAuthenticationRecovery(token);
  if (!recoveryPromise) throw error;
  if (recoveryToken !== token) throw error;
  return recoveryPromise.then((current) => {
    if (!current || current === token || getToken() !== current) throw error;
    return retry();
  });
}

function waitForAuthenticationRecovery(retry) {
  return recoveryPromise.then((current) => {
    if (!current || getToken() !== current) {
      const error = new Error('登录已过期，请重新登录');
      error.statusCode = 401;
      throw error;
    }
    return retry();
  });
}

function toDisplayNetworkError(err, prefix) {
  const raw = String((err && err.errMsg) || '未知错误');
  const message = /timeout/i.test(raw)
    ? '网络超时，请稍后重试'
    : `${prefix || '网络错误'}: ${raw}`;
  const requestError = new Error(message);
  requestError.url = err && err.url;
  return requestError;
}

/**
 * 单次请求（无重试）。GET 的重试由 request() 包装层负责。
 */
function requestOnce(method, path, data, options) {
  const publicConfig = String(method).toUpperCase() === 'GET' && path === '/configs/public';
  return new Promise((resolve, reject) => {
    if (!publicConfig) privacy.assertAllowed();
    const token = options.authToken || getToken();
    const header = {};
    const url = getBaseUrl() + path;

    if (token && !options.noAuth && !publicConfig && path !== '/auth/login') {
      header['Authorization'] = 'Bearer ' + token;
    }

    wx.request({
      url: url,
      method: method,
      data: data,
      header: header,
      timeout: REQUEST_TIMEOUT_MS,
      success(res) {
        const body = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          resolve(body.data);
        } else if (res.statusCode === 401) {
          const err = new Error('登录已过期，请重新登录');
          err.statusCode = res.statusCode;
          err.url = url;
          err.responseBody = body;
          if (header.Authorization && getToken() === token) {
            clearToken();
            err.authInvalidated = true;
            if (!options.noRecovery) startAuthenticationRecovery(token);
          }
          reject(err);
        } else {
          const message = (body && body.message) || `请求失败(${res.statusCode || 'unknown'})`;
          const err = new Error(message);
          err.statusCode = res.statusCode;
          err.url = url;
          err.responseBody = body;
          reject(err);
        }
      },
      fail(err) {
        const requestError = toDisplayNetworkError(err);
        requestError.url = url;
        reject(requestError);
      }
    });
  });
}

/**
 * Make an API request
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path - API path (e.g., '/auth/login')
 * @param {object} data - Request body (for POST/PUT)
 * @param {object} options - { noAuth: false, retry: false }
 * @returns {Promise<object>} Response data
 */
function request(method, path, data = null, options = {}) {
  const isGet = String(method).toUpperCase() === 'GET';
  const token = options.authToken || (options.noAuth ? '' : getToken());
  const attempt = () => requestOnce(method, path, data, options);
  const run = () => {
    if (!isGet || options.retry === false) return attempt();
    // 幂等 GET：网络失败/超时/5xx 退避重试 1 次；4xx（含 401）不重试
    return attempt().catch((err) => {
      if (err.statusCode && err.statusCode < 500) {
        throw err;
      }
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          attempt().then(resolve, reject);
        }, GET_RETRY_DELAY_MS);
      });
    });
  };
  if (options.noRecovery) return run();
  if (!token && recoveryPromise && !options.noAuth && path !== '/auth/login' && path !== '/configs/public') {
    return waitForAuthenticationRecovery(run);
  }
  return run().catch((error) => recoverAuthentication(error, token, path, run));
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

function uploadFileOnce(path, filePath, name, formData) {
  return new Promise((resolve, reject) => {
    privacy.assertAllowed();
    const token = getToken();
    const header = {};
    const url = getBaseUrl() + path;

    if (token) {
      header['Authorization'] = 'Bearer ' + token;
    }

    wx.uploadFile({
      url,
      filePath,
      name,
      formData,
      header,
      timeout: UPLOAD_TIMEOUT_MS,
      success(res) {
        let body = res.data;
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
          } catch (_err) {
            body = null;
          }
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === 0) {
          resolve(body.data);
          return;
        }

        const message = (body && body.message) || `上传失败(${res.statusCode || 'unknown'})`;
        const err = new Error(message);
        err.statusCode = res.statusCode;
        err.url = url;
        err.responseBody = body;
        if (res.statusCode === 401 && header.Authorization && getToken() === token) {
          clearToken();
          err.authInvalidated = true;
          startAuthenticationRecovery(token);
        }
        reject(err);
      },
      fail(err) {
        const uploadError = toDisplayNetworkError(err, '上传网络错误');
        uploadError.url = url;
        reject(uploadError);
      }
    });
  });
}

function uploadFile(path, filePath, name = 'file', formData = {}) {
  const token = getToken();
  const attempt = () => uploadFileOnce(path, filePath, name, formData);
  if (!token && recoveryPromise) return waitForAuthenticationRecovery(attempt);
  return attempt().catch((error) => recoverAuthentication(error, token, path, attempt));
}

module.exports = {
  getToken,
  setToken,
  clearToken,
  isLoggedIn,
  isRecoveredToken,
  getBaseUrl,
  setBaseUrl,
  request,
  get,
  post,
  put,
  del,
  uploadFile,
};
