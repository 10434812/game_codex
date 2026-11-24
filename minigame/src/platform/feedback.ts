import {getSettings} from '../core/AudioSettings';
/**
 * 触感与轻提示。对应小程序端的 playVibrate / wx.showToast。
 */

import {getWx} from './wx';

export type HapticStrength = 'heavy' | 'medium' | 'light';

export function vibrate(strength: HapticStrength = 'light'): void {
  if (!getSettings().haptics) return;
  const wxApi = getWx();
  if (!wxApi) {
    return;
  }
  try {
    wxApi.vibrateShort({type: strength, fail: () => undefined});
  } catch (error) {
    console.warn('[feedback] 震动失败', error);
  }
}

export function toast(title: string, icon: 'none' | 'success' | 'error' = 'none'): void {
  const wxApi = getWx();
  if (!wxApi) {
    return;
  }
  try {
    wxApi.showToast({title, icon, duration: 1600});
  } catch (error) {
    console.warn('[feedback] 提示失败', error);
  }
}

const TRIAL_DIALOG_INTERVAL_MS = 10000;
let lastTrialDialogAt = 0;

/** 受邀体验未开通时展示体验编号，可一键复制发给管理员。 */
export function showTrialAccessDialog(trialUserId: number): void {
  const wxApi = getWx();
  const now = Date.now();
  if (!wxApi?.showModal || now - lastTrialDialogAt < TRIAL_DIALOG_INTERVAL_MS) {
    return;
  }
  lastTrialDialogAt = now;
  wxApi.showModal({
    title: '受邀体验',
    content: `当前为受邀体验，你的体验编号是 ${trialUserId}。请把编号发给管理员，开通后重新登录即可。`,
    confirmText: '复制编号',
    cancelText: '知道了',
    success: (result) => {
      if (result.confirm) wxApi.setClipboardData?.({data: String(trialUserId), fail: () => undefined});
    },
    fail: () => undefined,
  });
}
