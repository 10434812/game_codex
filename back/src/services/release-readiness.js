const path = require('path');
// 法律文档判定使用后端自带副本（back/src/config/legal-config.js，由测试保证与 utils/legal-config.js 一致），
// 避免生产部署只包含 back/ 时因跨目录依赖而启动失败。
const { isReady } = require('../config/legal-config');
const config = require('../config');

const channels = {
  miniprogram: {project: '../../../project.config.json', compileType: 'miniprogram', name: '小程序'},
  minigame: {project: '../../../minigame/project.config.json', compileType: 'game', name: '小游戏'},
};

// 工程配置位于仓库根目录；仅在完整仓库中可读。受限部署（只含 back/）时：
// 小程序回落到后端已校验的 WX_APPID，小游戏无法核验，记为阻断项。
function loadProjectConfig(target, channel) {
  try {
    return require(path.resolve(__dirname, channel.project));
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    if (target === 'miniprogram') {
      return {compileType: channel.compileType, appid: config.wx.appId};
    }
    return null;
  }
}

// 工程类型与业务准入分别核验；对战内容的真实平台验收适用于两种客户端。
function getReleaseBlockers({target = 'miniprogram', audience = 'public'} = {}) {
  const channel = channels[target];
  if (!channel) throw new Error('发布目标请选择 miniprogram 或 minigame');
  const project = loadProjectConfig(target, channel);
  const blockers = [];
  if (!project || project.compileType !== channel.compileType || !/^wx[0-9a-f]{16}$/.test(project.appid || '')) {
    blockers.push(`发行渠道：请在${channel.name}工程配置微信分配的真实 AppID，并完成账号类型、域名及平台权限核验。`);
  }
  if (audience === 'public') {
    if (target === 'miniprogram') blockers.push('服务类目：当前账号为商业服务类目，现有对战内容需完成平台类目与准入确认。');
    blockers.push('实名防沉迷：尚未接入并验收真实渠道能力；微信登录、游客模式、适龄提示均不能替代。');
    blockers.push('发行资质：需取得并核验运营主体、适用出版审批、平台类目和备案材料；本检查不能代替主管部门或平台审批。');
  }
  if (!isReady()) {
    blockers.push('法律文档：运营主体、联系方式、版本、生效日期与正式协议/隐私政策尚未完整配置。');
  }
  return blockers;
}

function assertPublicReleaseReady(options) {
  const blockers = getReleaseBlockers({...options, audience: 'public'});
  if (blockers.length) {
    const error = new Error(`正式公开发布被阻止：\n${blockers.map((item) => `- ${item}`).join('\n')}`);
    error.code = 'PUBLIC_RELEASE_BLOCKED';
    throw error;
  }
}

// Trial channel and its nonempty account list are validated by the config boundary.
// Public release checks always retain the complete platform requirements.
function assertBackendDeploymentReady({channel}) {
  if (channel === 'public') return assertPublicReleaseReady();
  const blockers = getReleaseBlockers({audience: channel});
  if (blockers.length) {
    throw Object.assign(new Error(blockers.join('\n')), {code: 'TRIAL_DEPLOYMENT_BLOCKED'});
  }
}

module.exports = { getReleaseBlockers, assertPublicReleaseReady, assertBackendDeploymentReady };
