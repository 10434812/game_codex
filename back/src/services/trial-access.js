const config = require('../config');

function assertTrialAccess(userId) {
  if (config.deployment.channel === 'trial' && !config.deployment.trialUserIds.includes(userId)) {
    throw Object.assign(new Error('当前为受邀体验，请联系管理员添加体验账号'), {statusCode: 403, code: 'TRIAL_ACCESS_REQUIRED'});
  }
}

module.exports = {assertTrialAccess};
