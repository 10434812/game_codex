/**
 * 微信小游戏 API 的最小类型面 + 安全获取。
 *
 * 只声明本项目实际用到的能力。所有平台调用都经 getWx()，
 * 因此 Node 侧测试可以在 globalThis 上注入替身，不需要真机。
 */

import type {Canvas2DContext} from '../render/canvas-utils';

export interface WxTouch {
  clientX: number;
  clientY: number;
  identifier?: number;
}

export interface WxTouchEvent {
  touches: WxTouch[];
  changedTouches: WxTouch[];
}

export interface WxSafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width?: number;
  height?: number;
}

export interface WxSystemInfo {
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  statusBarHeight?: number;
  safeArea?: WxSafeArea;
  platform?: string;
  SDKVersion?: string;
}

export interface WxCanvas {
  width: number;
  height: number;
  toTempFilePath?(options: {fileType?: 'png' | 'jpg'; width?: number; height?: number; destWidth?: number; destHeight?: number; success?: (response: {tempFilePath: string}) => void; fail?: () => void}): void;
  getContext(type: '2d'): Canvas2DContext;
}

export interface WxImage {
  src: string;
  width: number;
  height: number;
  onload: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
}

export interface WxInnerAudio {
  src: string;
  loop: boolean;
  volume: number;
  autoplay: boolean;
  play(): void;
  stop(): void;
  destroy(): void;
  onError(callback: (error: unknown) => void): void;
}

export interface WxHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface WxHttpFailure {
  errMsg?: string;
}

export interface WxRequestOptions {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
  success?: (res: WxHttpResponse) => void;
  fail?: (error: WxHttpFailure) => void;
}

export interface WxUploadOptions {
  url: string;
  filePath: string;
  name: string;
  formData?: Record<string, unknown>;
  header?: Record<string, string>;
  timeout?: number;
  success?: (res: WxHttpResponse) => void;
  fail?: (error: WxHttpFailure) => void;
}

export interface WxLoginResult {
  code?: string;
  errMsg?: string;
}

export interface WxPrivacySettingResult {
  needAuthorization: boolean;
}

export interface WxSocketTask {
  send(options: {data: string}): void;
  onOpen(callback: () => void): void;
  onMessage(callback: (event: {data: string}) => void): void;
  onClose(callback: (event: {code?: number; reason?: string}) => void): void;
  onError(callback: (error: unknown) => void): void;
  close(options?: {code?: number; reason?: string}): void;
}

export interface WxApi {
  onError?(callback: (error: unknown) => void): void;
  onMemoryWarning?(callback: () => void): void;
  onShareAppMessage?(callback: () => {title: string; query: string}): void;
  onShareTimeline?(callback: () => {title: string; query: string}): void;
  showShareMenu?(options: {menus: string[]}): void;
  getUpdateManager?(): {onUpdateReady(callback: () => void): void; applyUpdate(): void};
  getMenuButtonBoundingClientRect?(): {top: number; bottom: number; height: number; left: number};
  connectSocket?(options: {url: string; protocols?: string[]}): WxSocketTask;
  showModal?(options: {title: string; content: string; editable?: boolean; placeholderText?: string; confirmText?: string; cancelText?: string; success: (result: {confirm: boolean; content?: string}) => void; fail?: (error: unknown) => void}): void;
  setClipboardData?(options: {data: string; fail?: (error: unknown) => void}): void;
  chooseMedia?(options: {count: number; mediaType: string[]; sourceType: string[]; success: (result: {tempFiles: {tempFilePath: string}[]}) => void; fail?: (error: unknown) => void}): void;
  shareAppMessage?(options: {title: string; query: string; imageUrl?: string}): void;
  showActionSheet?(options: {itemList: string[]; success: (result: {tapIndex: number}) => void; fail?: (error: unknown) => void}): void;
  getLaunchOptionsSync?(): {query?: Record<string, string>};
  exitMiniProgram?(): void;
  createCanvas(): WxCanvas;
  createImage(): WxImage;
  getSystemInfoSync(): WxSystemInfo;
  onTouchStart(callback: (event: WxTouchEvent) => void): void;
  onTouchMove(callback: (event: WxTouchEvent) => void): void;
  onTouchEnd(callback: (event: WxTouchEvent) => void): void;
  onTouchCancel(callback: (event: WxTouchEvent) => void): void;
  onShow(callback: (options?: {query?: Record<string, string>}) => void): void;
  onHide(callback: () => void): void;
  setStorageSync(key: string, value: unknown): void;
  getStorageSync(key: string): unknown;
  removeStorageSync(key: string): void;
  createInnerAudioContext(): WxInnerAudio;
  vibrateShort(options?: {type?: 'heavy' | 'medium' | 'light'; fail?: () => void}): void;
  showToast(options: {title: string; icon?: 'none' | 'success' | 'error'; duration?: number}): void;
  request(options: WxRequestOptions): void;
  uploadFile(options: WxUploadOptions): void;
  login(options: {success?: (res: WxLoginResult) => void; fail?: (error: WxHttpFailure) => void}): void;
  getPrivacySetting(options: {
    success?: (res: WxPrivacySettingResult) => void;
    fail?: (error: unknown) => void;
  }): void;
  requirePrivacyAuthorize(options: {success?: () => void; fail?: (error: unknown) => void}): void;
}

export function getWx(): WxApi | null {
  return typeof wx !== 'undefined' && wx ? wx : null;
}
