const {DEFAULT_STAGE, STAGES, NAV_TABS} = require('./constants');

const LOCAL_BOOT_ASSETS = [
  'https://xcx.ukb88.com/assets/bg/bg.png',
  'https://xcx.ukb88.com/assets/bg/bg2.png',
  'https://xcx.ukb88.com/assets/bg/bg6.png',
  'https://xcx.ukb88.com/assets/bg/gamebg.png',
  'https://xcx.ukb88.com/assets/bg/开机动画.png',
];

function getRemoteBootAssets() {
  const stageImages = [DEFAULT_STAGE, ...STAGES.slice(1)].map((stage) => stage.image);
  const navIcons = NAV_TABS.reduce((list, tab) => {
    list.push(tab.icon, tab.iconActive);
    return list;
  }, []);
  return [...stageImages, ...navIcons];
}

function getBootAssetQueue() {
  return [...LOCAL_BOOT_ASSETS, ...getRemoteBootAssets()];
}

function createImagePreloadTask(src) {
  return () => new Promise((resolve) => {
    if (!src) {
      resolve({src, ok: false});
      return;
    }

    if (typeof wx === 'undefined' || typeof wx.getImageInfo !== 'function') {
      resolve({src, ok: true, skipped: true});
      return;
    }

    wx.getImageInfo({
      src,
      success() {
        resolve({src, ok: true});
      },
      fail() {
        resolve({src, ok: false});
      },
    });
  });
}

function createBootLoader(tasks = [], onProgress = () => {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const total = safeTasks.length;

  return {
    async start() {
      if (total === 0) {
        onProgress(100, {completed: 0, total: 0});
        return;
      }

      let completed = 0;
      for (const task of safeTasks) {
        try {
          await Promise.resolve(task()).catch(() => null);
        } catch (error) {
          // 单个资源失败不阻塞启动。
        }
        completed += 1;
        const percent = Math.round((completed / total) * 100);
        onProgress(percent, {completed, total});
      }
    },
  };
}

module.exports = {
  createBootLoader,
  createImagePreloadTask,
  getBootAssetQueue,
};
