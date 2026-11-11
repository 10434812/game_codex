/**
 * 触感与轻提示。对应小程序端的 playVibrate / wx.showToast。
 */

import {getWx} from './wx';

export type HapticStrength = 'heavy' | 'medium' | 'light';

export function vibrate(strength: HapticStrength = 'light'): void {
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
