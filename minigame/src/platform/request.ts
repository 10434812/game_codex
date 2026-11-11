/**
 * 网络平台层：把 wx.request / wx.uploadFile / wx.login 收敛成 Promise + 结果对象。
 *
 * 不抛异常、不解释业务码，只回答「网络是否成功、HTTP 状态码是多少、body 是什么」，
 * 业务语义（401 清 token、code !== 0 转错误）留给 core/ApiClient。
 */

import {getWx} from './wx';

export interface HttpRequestOptions {
  url: string;
  method: string;
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
}

export interface HttpUploadOptions {
  url: string;
  filePath: string;
  name: string;
  formData?: Record<string, unknown>;
  header?: Record<string, string>;
  timeout?: number;
}

export type HttpResult =
  | {ok: true; statusCode: number; data: unknown}
  | {ok: false; errMsg: string};

export async function httpRequest(options: HttpRequestOptions): Promise<HttpResult> {
  const wxApi = getWx();
  if (!wxApi) {
    return {ok: false, errMsg: '当前环境不支持网络请求'};
  }
  return new Promise<HttpResult>((resolve) => {
    wxApi.request({
      url: options.url,
      method: options.method,
      data: options.data,
      header: options.header,
      timeout: options.timeout,
      success: (res) => resolve({ok: true, statusCode: Number(res.statusCode) || 0, data: res.data}),
      fail: (error) => resolve({ok: false, errMsg: String((error && error.errMsg) || '未知错误')}),
    });
  });
}

export async function httpUpload(options: HttpUploadOptions): Promise<HttpResult> {
  const wxApi = getWx();
  if (!wxApi) {
    return {ok: false, errMsg: '当前环境不支持文件上传'};
  }
  return new Promise<HttpResult>((resolve) => {
    wxApi.uploadFile({
      url: options.url,
      filePath: options.filePath,
      name: options.name,
      formData: options.formData,
      header: options.header,
      timeout: options.timeout,
      success: (res) => resolve({ok: true, statusCode: Number(res.statusCode) || 0, data: res.data}),
      fail: (error) => resolve({ok: false, errMsg: String((error && error.errMsg) || '未知错误')}),
    });
  });
}

/** 调用 wx.login 取一次性 code；失败时抛出，由调用方决定是否降级。 */
export async function requestLoginCode(): Promise<string> {
  const wxApi = getWx();
  if (!wxApi) {
    throw new Error('当前环境不支持微信登录');
  }
  const result = await new Promise<{code?: string; errMsg?: string}>((resolve, reject) =>
    wxApi.login({success: resolve, fail: reject})
  );
  if (!result || !result.code) {
    throw new Error(`wx.login failed: ${(result && result.errMsg) || ''}`);
  }
  return result.code;
}
