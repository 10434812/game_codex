const runtimeConfig = require('./runtime-config');
const { getCachedProfile } = require('./user-profile');

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
    return '我刚在锦鲤前程赢下一局，来一起试试手气';
  }
  return '锦鲤前程邀你一起组队闯世界';
}

function buildInviteQuery() {
  const profile = getCachedProfile();
  const nickname = encodeURIComponent(profile.nickName || '锦鲤玩家');
  return `inviteName=${nickname}`;
}

function buildShareAppMessage(scene = 'default', options = {}) {
  if (!runtimeConfig.getBoolean('wechat.share_enabled', true)) {
    return {
      title: buildShareTitle(scene),
      path: '/pages/home/index',
    };
  }
  const extraQuery = options.extraQuery || '';
  const mergedQuery = scene === 'room'
    ? joinQuery(extraQuery, buildInviteQuery())
    : extraQuery;
  return {
    title: buildShareTitle(scene),
    path: buildSharePath(scene, mergedQuery),
    imageUrl: runtimeConfig.getValue('wechat.share_image_url', ''),
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
    imageUrl: runtimeConfig.getValue('wechat.share_image_url', ''),
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
