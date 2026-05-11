function getNavLayout() {
  let statusBarHeight = 20; // 默认状态栏高度(iPhone 6/7/8)
  let windowWidth = 375; // 默认屏幕宽度(iPhone 6/7/8)
  let menu = { top: 26, height: 32, left: 281, width: 87 }; // 微信胶囊按钮的默认位置参数

  try {
    const sys = wx.getSystemInfoSync();
    statusBarHeight = sys.statusBarHeight || statusBarHeight;
    windowWidth = sys.windowWidth || windowWidth;
  } catch (e) {}

  try {
    const rect = wx.getMenuButtonBoundingClientRect();
    if (rect && rect.width && rect.height) {
      menu = rect;
    }
  } catch (e) {}

  // navHeight: 导航栏高度，44px 是 iOS 导航栏最小高度
  const navHeight = Math.max(44, (menu.top - statusBarHeight) * 2 + menu.height);
  // capsuleSpace: 胶囊右侧留白，88px 最小，156px 最大
  const capsuleSpace = Math.min(156, Math.max(88, windowWidth - menu.left + 8));

  return {
    statusBarHeight,
    navHeight,
    capsuleSpace
  };
}

module.exports = {
  getNavLayout
};
