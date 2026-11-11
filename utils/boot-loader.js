const {DEFAULT_STAGE, STAGES, NAV_TABS, AVATAR_POOL} = require('./constants');
const {FORTUNE_BAG_ASSETS} = require('./investment');
const {ARENA_EFFECT_ASSETS, ARENA_DROP_ASSETS} = require('./arena-effects');

const LOCAL_BOOT_ASSETS = [
  'https://xcx.ukb88.com/assets/bg/bg.png',
  'https://xcx.ukb88.com/assets/bg/bg2.png',
  'https://xcx.ukb88.com/assets/bg/bg6.png',
  'https://xcx.ukb88.com/assets/bg/gamebg-compressed.png',
  ...Object.values(ARENA_EFFECT_ASSETS),
  ...Object.values(ARENA_DROP_ASSETS),
];

// 明确预加载清单：当前景区 image + 头像池 12 张 + 福袋图 + 底部导航图标
// （不再用 !stage.video 过滤，避免景区全部带 video 时景区图零预加载）
function getRemoteBootAssets(stage) {
  const stageImages = stage && stage.image
    ? [stage.image]
    : [DEFAULT_STAGE, ...STAGES]
      .map((item) => item.image)
      .filter(Boolean);
  const avatarImages = (AVATAR_POOL || []).filter(Boolean);
  const fortuneImages = Object.keys(FORTUNE_BAG_ASSETS || {})
    .map((key) => FORTUNE_BAG_ASSETS[key])
    .filter(Boolean);
  const navIcons = NAV_TABS.reduce((list, tab) => {
    list.push(tab.icon, tab.iconActive);
    return list;
  }, []);
  return [...stageImages, ...avatarImages, ...fortuneImages, ...navIcons];
}

function getBootAssetQueue(stage) {
  return [...LOCAL_BOOT_ASSETS, ...getRemoteBootAssets(stage)];
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

  return {
    start() {
      if (total === 0) {
        onProgress(100, {completed: 0, total: 0});
        return Promise.resolve();
      }

      let completed = 0;
      const promises = safeTasks.map((task) => {
        return Promise.resolve(task()).catch(() => null).then(() => {
          completed += 1;
          const percent = Math.round((completed / total) * 100);
          onProgress(percent, {completed, total});
        });
      });

      return Promise.all(promises);
    },
  };
}

module.exports = {
  createBootLoader,
  createImagePreloadTask,
  getBootAssetQueue,
};
