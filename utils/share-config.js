const runtimeConfig = require('./runtime-config');
const DEFAULT_SHARE_IMAGE = '/assets-pkg/share/friends-20261111.jpg';

function resolveShareImage(value) {
  const image = String(value || '').trim();
  // 已有后台配置仍可能返回旧的竖版纸张背景；新封面随包发布，不依赖 CDN 更新。
  const legacyBackground = /^(?:https:\/\/xcx\.ukb88\.com)?\/(?:assets|assets-pkg)\/bg\/screen\.(?:png|jpg)(?:[?#].*)?$/;
  return !image || legacyBackground.test(image) ? DEFAULT_SHARE_IMAGE : image;
}

function joinQuery(baseQuery, extraQuery) {
  const parts = [baseQuery, extraQuery]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return parts.join('&');
}

function normalizePath(path) {
  const value = String(path || '').trim() || '/pages/home/index';
  return value.startsWith('/') ? value : `/${value}`;
}

function buildSharePath(scene, extraQuery = '') {
  const path = normalizePath(runtimeConfig.getValue('wechat.share_path', '/pages/home/index'));
  const query = joinQuery(
    runtimeConfig.getValue('wechat.share_query', 'from=admin_share'),
    joinQuery(extraQuery, `scene=${scene}`)
  );
  return query ? `${path}?${query}` : path;
}

function buildShareTitle(scene) {
  const customTitle = runtimeConfig.getValue('wechat.share_title', '');
  if (customTitle) {
    return customTitle;
  }
  if (scene === 'room') {
    return '锦鲤前程邀你来房间组队冲榜';
  }
  if (scene === 'result') {
    return '我刚在锦鲤前程赢下一局，来一起试试运气';
  }
  return '锦鲤前程邀你一起组队闯世界';
}

function buildShareAppMessage(scene = 'default', options = {}) {
  if (!runtimeConfig.getBoolean('wechat.share_enabled', true)) {
    return {
      title: buildShareTitle(scene),
      path: '/pages/home/index',
    };
  }
  const extraQuery = options.extraQuery || '';
  const mergedQuery = extraQuery;
  return {
    title: buildShareTitle(scene),
    path: buildSharePath(scene, mergedQuery),
    imageUrl: resolveShareImage(runtimeConfig.getValue('wechat.share_image_url', '')),
  };
}

function buildShareTimeline(scene = 'default', options = {}) {
  const extraQuery = options.extraQuery || '';
  return {
    title: runtimeConfig.getValue('wechat.share_timeline_title', buildShareTitle(scene)),
    query: joinQuery(
      runtimeConfig.getValue('wechat.share_query', 'from=admin_share'),
      joinQuery(extraQuery, `scene=${scene}`)
    ),
    imageUrl: resolveShareImage(runtimeConfig.getValue(
      'wechat.share_timeline_image_url',
      runtimeConfig.getValue('wechat.share_image_url', '')
    )),
  };
}

function enableShareMenu() {
  if (typeof wx.showShareMenu !== 'function') {
    return;
  }
  const shareEnabled = runtimeConfig.getBoolean('wechat.share_enabled', true);
  if (!shareEnabled) {
    return;
  }
  try {
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  } catch (error) {
    console.warn('[share-config] enableShareMenu error:', error);
  }
}

module.exports = {
  enableShareMenu,
  buildShareAppMessage,
  buildShareTimeline,
};
