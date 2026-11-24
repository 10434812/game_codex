import {analytics} from './Analytics';
/**
 * 隐私与协议同意（原 utils/privacy-consent.js）。
 *
 * 与小程序端的有意差异：小程序版还导出 destination / bootUrl / restoreDestination
 * 三个页面路由辅助函数，小游戏没有 URL 路由，这部分不移植；
 * 场景跳转由场景管理器负责，同意状态本身与小程序端完全一致。
 */

import {isReady as isLegalReady, legalConfig} from './LegalConfig';
import {readText, removeKey, writeText} from '../platform/storage';
import {getWx} from '../platform/wx';

const CONSENT_KEY = 'legal-consent-version';

let confirmedVersion = '';
let revision = 0;

export interface PrivacyError extends Error {
  code?: string;
  statusCode?: number;
}

function consentVersion(): string {
  return `${legalConfig.privacyVersion}:${legalConfig.agreementVersion}`;
}

function createPrivacyError(message: string, extra: {code?: string; statusCode?: number}): PrivacyError {
  return Object.assign(new Error(message), extra);
}

export function isAllowed(): boolean {
  return isLegalReady() && confirmedVersion === consentVersion() && readText(CONSENT_KEY) === consentVersion();
}

export function assertAllowed(): void {
  if (!isAllowed()) {
    throw createPrivacyError('请先阅读当前协议并完成微信隐私确认', {
      code: 'PRIVACY_CONSENT_REQUIRED',
      statusCode: 403,
    });
  }
}

export async function checkPlatformConsent(): Promise<boolean> {
  confirmedVersion = '';
  const operation = ++revision;
  const wxApi = getWx();
  if (!isLegalReady()) {
    throw new Error('运营主体与正式法律文档尚未配置或生效，当前不可登录或公开使用。可查看说明或退出。');
  }
  if (!wxApi || typeof wxApi.getPrivacySetting !== 'function' || typeof wxApi.requirePrivacyAuthorize !== 'function') {
    throw new Error('当前微信版本不支持隐私授权，请升级微信后重试。');
  }
  const checkedVersion = consentVersion();
  const result = await new Promise<{needAuthorization: boolean}>((resolve, reject) =>
    wxApi.getPrivacySetting({success: resolve, fail: reject})
  );
  if (!result || typeof result.needAuthorization !== 'boolean') {
    throw new Error('无法确认微信隐私授权状态，请重试。');
  }
  if (
    operation === revision &&
    !result.needAuthorization &&
    isLegalReady() &&
    consentVersion() === checkedVersion &&
    readText(CONSENT_KEY) === checkedVersion
  ) {
    confirmedVersion = checkedVersion;
  }
  return isAllowed();
}

export async function authorize(): Promise<void> {
  confirmedVersion = '';
  const operation = ++revision;
  const wxApi = getWx();
  if (!isLegalReady()) {
    throw new Error('正式法律文档尚未配置或生效，当前不可授权。');
  }
  const acceptedVersion = consentVersion();
  if (!wxApi || typeof wxApi.requirePrivacyAuthorize !== 'function') {
    throw new Error('请升级微信后重试隐私授权。');
  }
  await new Promise<void>((resolve, reject) => wxApi.requirePrivacyAuthorize({success: resolve, fail: reject}));
  if (operation !== revision || !isLegalReady() || consentVersion() !== acceptedVersion) {
    throw new Error('授权已取消或法律文档已更新，请重新阅读并授权。');
  }
  writeText(CONSENT_KEY, acceptedVersion);
  confirmedVersion = acceptedVersion;
  assertAllowed();
}

export function revoke(): void {
  confirmedVersion = '';
  revision += 1;
  analytics.discard();
}

/**
 * 同时清掉持久化的同意版本号。
 * 注销账号后必须重新主动同意，不能凭旧版本号自动通过。
 */
export function clearStoredConsent(): void {
  removeKey(CONSENT_KEY);
}
