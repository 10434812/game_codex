import {getWx} from './wx';
export function installPlatformLifecycle(share: () => {title: string; query: string}, clearImages: () => void, reportError: (error: unknown) => void): void {
  const wx = getWx(); if (!wx) return;
  wx.onError?.(reportError);
  wx.onMemoryWarning?.(clearImages);
  wx.showShareMenu?.({menus: ['shareAppMessage', 'shareTimeline']});
  wx.onShareAppMessage?.(share);
  wx.onShareTimeline?.(() => {
    const {title, query} = share();
    return {title, query: query.split('&').filter((param) => !param.startsWith('challenge=')).join('&')};
  });
  const updates = wx.getUpdateManager?.();
  updates?.onUpdateReady(() => {
    wx.showModal?.({title: '版本更新', content: '新版本已准备好，重启后生效。', confirmText: '重启游戏',
      success: (result) => {if (result.confirm) updates.applyUpdate();}});
  });
}
