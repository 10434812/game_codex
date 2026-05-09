const {getNavLayout} = require('../../utils/nav');
const {createBootLoader, createImagePreloadTask, getBootAssetQueue} = require('../../utils/boot-loader');

const COMPLETE_HOLD_MS = 180;
const BOOT_ART_SIZE = {
  width: 768,
  height: 1376,
};
const PROGRESS_BOX = {
  left: 76,
  top: 1248,
  width: 615,
  height: 40,
};

function computeCoverRect(containerWidth, containerHeight, contentWidth, contentHeight) {
  if (!containerWidth || !containerHeight || !contentWidth || !contentHeight) {
    return {
      left: 0,
      top: 0,
      width: containerWidth,
      height: containerHeight,
    };
  }

  const containerRatio = containerWidth / containerHeight;
  const contentRatio = contentWidth / contentHeight;

  let width;
  let height;
  let left = 0;
  let top = 0;

  if (containerRatio > contentRatio) {
    width = containerWidth;
    height = width / contentRatio;
    top = (containerHeight - height) / 2;
  } else {
    height = containerHeight;
    width = height * contentRatio;
    left = (containerWidth - width) / 2;
  }

  return {
    left,
    top,
    width,
    height,
  };
}

Page({
  data: {
    stageStyle: '',
    artStyle: '',
    progressStyle: '',
    progress: 0,
    loadingText: '正在加载资源',
  },
  onLoad() {
    let sys = null;
    try {
      sys = wx.getSystemInfoSync();
      this.setData({stageStyle: `width: ${sys.windowWidth}px; height: ${sys.windowHeight}px;`});
    } catch (error) {
      this.setData({
        stageStyle: 'width: 100vw; height: 100vh;',
      });
    }
    this.syncBootLayout(sys);
    this.startBoot();
  },
  onUnload() {
    this.isDestroyed = true;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  },
  syncBootLayout(sys) {
    const systemInfo = sys || {};
    const windowWidth = Number(systemInfo.windowWidth) || 375;
    const windowHeight = Number(systemInfo.windowHeight) || 667;
    const artRect = computeCoverRect(
      windowWidth,
      windowHeight,
      BOOT_ART_SIZE.width,
      BOOT_ART_SIZE.height
    );
    const progressRect = {
      left: artRect.left + artRect.width * PROGRESS_BOX.left / BOOT_ART_SIZE.width,
      top: artRect.top + artRect.height * PROGRESS_BOX.top / BOOT_ART_SIZE.height,
      width: artRect.width * PROGRESS_BOX.width / BOOT_ART_SIZE.width,
      height: artRect.height * PROGRESS_BOX.height / BOOT_ART_SIZE.height,
    };

    this.setData({
      artStyle: `left: ${artRect.left}px; top: ${artRect.top}px; width: ${artRect.width}px; height: ${artRect.height}px;`,
      progressStyle: `left: ${progressRect.left}px; top: ${progressRect.top}px; width: ${progressRect.width}px; height: ${progressRect.height}px;`,
    });
  },
  updateProgress(progress, info = {}) {
    if (this.isDestroyed) {
      return;
    }

    this.setData({
      progress,
      loadingText: progress >= 100 ? '加载完成' : '正在加载资源',
    });
  },
  startBoot() {
    if (this.bootStarted) {
      return;
    }
    this.bootStarted = true;

    const tasks = getBootAssetQueue().map((src) => createImagePreloadTask(src));
    const loader = createBootLoader(tasks, (progress, info) => {
      this.updateProgress(progress, info);
    });

    loader.start().then(() => {
      if (this.isDestroyed) {
        return;
      }

      this.setData({
        progress: 100,
        loadingText: '加载完成',
      });

      this.holdTimer = setTimeout(() => {
        if (this.isDestroyed) {
          return;
        }
        wx.reLaunch({url: '/pages/home/index'});
      }, COMPLETE_HOLD_MS);
    });
  },
});
