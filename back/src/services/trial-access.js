const config = require('../config');

const TRIAL_ACCESS_REQUIRED = 'TRIAL_ACCESS_REQUIRED';

function isTrialMember(userId) {
  return config.deployment.channel !== 'trial' || config.deployment.trialUserIds.includes(userId);
}

// 提示里带上体验编号（users.id），测试者把编号发给管理员加入 TRIAL_USER_IDS 即可开通。
function trialAccessError(userId) {
  const suffix = userId ? `，你的体验编号是 ${userId}，请发给管理员开通` : '，请联系管理员添加体验账号';
  return Object.assign(new Error(`当前为受邀体验${suffix}`), {
    statusCode: 403, code: TRIAL_ACCESS_REQUIRED, trialUserId: userId || null,
  });
}

function assertTrialAccess(userId) {
  if (!isTrialMember(userId)) throw trialAccessError(userId);
}

module.exports = {TRIAL_ACCESS_REQUIRED, assertTrialAccess, trialAccessError};
