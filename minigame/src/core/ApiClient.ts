/**
 * API 客户端（原 utils/api-client.js）。
 *
 * 保持与小程序端一致的语义：JWT 存储键、Bearer 头、`code === 0` 才算成功、
 * 401 清 token、幂等 GET 退避重试一次、超时文案本地化。
 */

import {assertAllowed} from './PrivacyConsent';
import {httpRequest, httpUpload} from '../platform/request';
import {readText, removeKey, writeText} from '../platform/storage';

const TOKEN_KEY = 'game_codex_api_token_v1';
const BASE_URL_KEY = 'game_codex_api_base_url_v1';
const DEFAULT_BASE_URL = 'https://xcx.ukb88.com/api';

// 请求超时（微信默认 60s 太久，弱网/挂起时用户等待过长）
const REQUEST_TIMEOUT_MS = 10000;
const UPLOAD_TIMEOUT_MS = 15000;
// 幂等 GET 失败重试：1 次，500ms 退避
const GET_RETRY_DELAY_MS = 500;

export interface ApiError extends Error {
  statusCode?: number;
  url?: string;
  responseBody?: unknown;
}

export interface RequestOptions {
  noAuth?: boolean;
  retry?: boolean;
}

function createApiError(message: string, extra: {statusCode?: number; url?: string; responseBody?: unknown}): ApiError {
  // Error 本身没有这些字段，调用方（状态层/页面）按这些字段判断 401 与展示文案。
  return Object.assign(new Error(message), extra);
}

function readCode(body: unknown): unknown {
  if (body && typeof body === 'object' && 'code' in body) {
    return body.code;
  }
  return undefined;
}

function readData(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in body) {
    return body.data;
  }
  return undefined;
}

function readMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'message' in body) {
    return typeof body.message === 'string' ? body.message : undefined;
  }
  return undefined;
}

function readStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return typeof error.statusCode === 'number' ? error.statusCode : undefined;
  }
  return undefined;
}

function toDisplayNetworkMessage(errMsg: string, prefix = '网络错误'): string {
  return /timeout/i.test(errMsg) ? '网络超时，请稍后重试' : `${prefix}: ${errMsg}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(url: unknown): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

export function getBaseUrl(): string {
  const stored = normalizeBaseUrl(readText(BASE_URL_KEY));
  return stored || DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  if (normalized) {
    writeText(BASE_URL_KEY, normalized);
  } else {
    removeKey(BASE_URL_KEY);
  }
  return getBaseUrl();
}

export function getToken(): string {
  return readText(TOKEN_KEY);
}

export function setToken(token: string): void {
  writeText(TOKEN_KEY, token);
}

export function clearToken(): void {
  removeKey(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return getToken() !== '';
}

/** 单次请求（无重试）。GET 的重试由 request() 包装层负责。 */
async function requestOnce(
  method: string,
  path: string,
  data: unknown,
  options: RequestOptions
): Promise<unknown> {
  const publicConfig = method.toUpperCase() === 'GET' && path === '/configs/public';
  if (!publicConfig) {
    assertAllowed();
  }
  const token = getToken();
  const header: Record<string, string> = {};
  const url = getBaseUrl() + path;

  if (token && !options.noAuth && !publicConfig) {
    header.Authorization = `Bearer ${token}`;
  }

  const result = await httpRequest({url, method, data, header, timeout: REQUEST_TIMEOUT_MS});
  if (!result.ok) {
    throw createApiError(toDisplayNetworkMessage(result.errMsg), {url});
  }
  if (result.statusCode >= 200 && result.statusCode < 300 && readCode(result.data) === 0) {
    return readData(result.data);
  }
  if (result.statusCode === 401) {
    if (header.Authorization && getToken() === token) clearToken();
    throw createApiError('登录已过期，请重新登录', {
      statusCode: result.statusCode,
      url,
      responseBody: result.data,
    });
  }
  throw createApiError(readMessage(result.data) || `请求失败(${result.statusCode || 'unknown'})`, {
    statusCode: result.statusCode,
    url,
    responseBody: result.data,
  });
}

/**
 * 发起 API 请求。
 * GET 默认退避重试一次（4xx 含 401 不重试），其余方法不重试。
 */
export async function request(
  method: string,
  path: string,
  data: unknown = null,
  options: RequestOptions = {}
): Promise<unknown> {
  const isGet = method.toUpperCase() === 'GET';
  if (!isGet || options.retry === false) {
    return requestOnce(method, path, data, options);
  }
  try {
    return await requestOnce(method, path, data, options);
  } catch (error) {
    const statusCode = readStatusCode(error);
    if (typeof statusCode === 'number' && statusCode < 500) {
      throw error;
    }
    await delay(GET_RETRY_DELAY_MS);
    return requestOnce(method, path, data, options);
  }
}

export function get(path: string, params: Record<string, unknown> | null = null): Promise<unknown> {
  let url = path;
  if (params) {
    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    if (query) {
      url += `?${query}`;
    }
  }
  return request('GET', url);
}

export function post(path: string, data: unknown = {}): Promise<unknown> {
  return request('POST', path, data);
}

export function put(path: string, data: unknown = {}): Promise<unknown> {
  return request('PUT', path, data);
}

export function del(path: string): Promise<unknown> {
  return request('DELETE', path);
}

export async function uploadFile(
  path: string,
  filePath: string,
  name = 'file',
  formData: Record<string, unknown> = {}
): Promise<unknown> {
  assertAllowed();
  const token = getToken();
  const header: Record<string, string> = {};
  const url = getBaseUrl() + path;

  if (token) {
    header.Authorization = `Bearer ${token}`;
  }

  const result = await httpUpload({url, filePath, name, formData, header, timeout: UPLOAD_TIMEOUT_MS});
  if (!result.ok) {
    throw createApiError(toDisplayNetworkMessage(result.errMsg, '上传网络错误'), {url});
  }

  let body: unknown = result.data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  if (result.statusCode >= 200 && result.statusCode < 300 && readCode(body) === 0) {
    return readData(body);
  }
  if (result.statusCode === 401) {
    if (getToken() === token) clearToken();
  }
  throw createApiError(readMessage(body) || `上传失败(${result.statusCode || 'unknown'})`, {
    statusCode: result.statusCode,
    url,
    responseBody: body,
  });
}
