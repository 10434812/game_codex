const { assertActiveUser } = require('../middleware/auth');

// Matches the HTTP account-state cache TTL. Idle connections must also expire.
const ACCOUNT_CHECK_INTERVAL_MS = 15 * 1000;

function watchAccount(userId, revoke) {
  let stopped = false;
  let checking = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      await assertActiveUser(userId);
    } catch (err) {
      // 只有明确的账号失效（401/403）才断开连接；数据库等瞬时故障下一轮巡检再判断。
      const revocable = err && (err.statusCode === 401 || err.statusCode === 403);
      if (revocable && !stopped) {
        stop();
        revoke();
      }
    } finally {
      checking = false;
    }
  }, ACCOUNT_CHECK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return stop;
}

module.exports = { assertActiveUser, watchAccount };
