const {DEFAULT_STAGE, DEFAULT_AVATAR, NAV_TABS} = require('./constants');

const LOCAL_BOOT_ASSETS = [
  'https://xcx.ukb88.com/assets/bg/bg.png',
];

// Only resources needed by the first home screen compete with config/login.
// Arena effects and other destinations load when their own surface is opened.
function getRemoteBootAssets(stage) {
  const stageImages = stage && stage.image
    ? [stage.image]
    : [DEFAULT_STAGE.image];
  const navIcons = NAV_TABS.reduce((list, tab) => {
    list.push(tab.icon, tab.iconActive);
    return list;
  }, []);
  return [...stageImages, DEFAULT_AVATAR, ...navIcons].filter(Boolean);
}

function getBootAssetQueue(stage) {
  return [...new Set([...LOCAL_BOOT_ASSETS, ...getRemoteBootAssets(stage)])];
}

function createImagePreloadTask(src) {
  return () => new Promise((resolve) => {
    if (!src) {
      resolve({src, ok: false});
      return;
    }

    if (/\.svg(?:\?|#|$)/i.test(src)) {
      resolve({src, ok: true, skipped: true});
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
        console.warn('[boot-loader] Image preload failed:', src);
        resolve({src, ok: false});
      },
    });
  });
}

function createBootLoader(tasks = [], onProgress = () => {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const total = safeTasks.length;
  let cancelled = false;

  return {
    start() {
      if (total === 0) {
        onProgress(100, {completed: 0, total: 0});
        return Promise.resolve();
      }

      let completed = 0;
      let next = 0;
      const worker = async () => {
        while (!cancelled && next < total) {
          const task = safeTasks[next++];
          try {await task();} catch (_) {}
          if (cancelled) return;
          completed += 1;
          const percent = Math.round((completed / total) * 100);
          onProgress(percent, {completed, total});
        }
      };
      return Promise.all(Array.from({length: Math.min(4, total)}, worker));
    },
    cancel() {cancelled = true;},
  };
}

module.exports = {
  createBootLoader,
  createImagePreloadTask,
  getBootAssetQueue,
};
