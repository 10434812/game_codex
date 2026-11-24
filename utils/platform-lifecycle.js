function installUpdates() {
  if (typeof wx === 'undefined' || typeof wx.getUpdateManager !== 'function') return;
  try {
    const updates = wx.getUpdateManager();
    updates.onUpdateReady(() => {
      if (typeof wx.showModal !== 'function') return;
      wx.showModal({title: '版本更新', content: '新版本已准备好，重启后生效。', confirmText: '重启游戏',
        success(result) {if (result.confirm) updates.applyUpdate();}});
    });
  } catch (_) { /* Older clients keep using the supported running version. */ }
}
module.exports = {installUpdates};
