function getNavLayout() {
  let statusBarHeight = 20;
  let windowWidth = 375;
  let menu = { top: 26, height: 32, left: 281, width: 87 };

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

  const navHeight = Math.max(44, (menu.top - statusBarHeight) * 2 + menu.height);
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
