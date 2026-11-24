const api = require('./api-client');
const runtime = require('./runtime-config');
const {ensureLogin} = require('./user-profile');

async function requireOnlineAccount() {
  await ensureLogin();
  await runtime.fetchRemoteConfig();
  if (!runtime.isApiSupported('onlineArena')) throw new Error('对战服务暂时不可用，请稍后重试');
}

async function latestResultUrl() {
  await ensureLogin();
  const data = await api.get('/stats/history', {page: 1, limit: 1});
  const record = data && data.records && data.records[0];
  if (!record || !record.sessionId) throw new Error('暂无对局记录，完成一局后即可查看');
  return `/pages/result/index?sessionId=${encodeURIComponent(record.sessionId)}`;
}

module.exports = {requireOnlineAccount, latestResultUrl};
