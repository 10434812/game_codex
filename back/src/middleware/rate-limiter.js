const { fail } = require('../utils/response');

/**
 * 内存级速率限制器（登录爆破防护等场景）。
 *
 * 线程安全说明：Node.js 单线程事件循环内，Map 的读-写都在同一同步调用栈中完成
 * （check/recordFailure/clear 均为同步操作，无 await 交错），因此不存在并发竞态。
 * 进程重启后计数清零（可接受：仅用于减缓暴力破解，不用于持久封禁）。
 *
 * 语义：窗口 windowMs 内失败次数达到 maxFailures 后，锁定 lockMs 时长。
 */
class InMemoryRateLimiter {
  /**
   * @param {Object} options
   * @param {number} [options.maxFailures=5] 窗口内允许的最大失败次数
   * @param {number} [options.windowMs=15*60*1000] 失败计数窗口（毫秒）
   * @param {number} [options.lockMs=30*60*1000] 触发锁定后的锁定时长（毫秒）
   * @param {Function} [options.now] 可注入时钟（测试用），默认 Date.now
   */
  constructor(options = {}) {
    this.maxFailures = options.maxFailures || 5;
    this.windowMs = options.windowMs || 15 * 60 * 1000;
    this.lockMs = options.lockMs || 30 * 60 * 1000;
    this.now = options.now || Date.now;
    /** @type {Map<string, {failures: number, firstAt: number, lockedUntil: number}>} */
    this.entries = new Map();
  }

  _cleanup(key, now) {
    const entry = this.entries.get(key);
    if (!entry) return;
    // 窗口过期且未锁定 → 删除计数，重新开始
    if (!entry.lockedUntil && now - entry.firstAt > this.windowMs) {
      this.entries.delete(key);
    }
    // 锁定已过期 → 删除，重新开始
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      this.entries.delete(key);
    }
  }

  /**
   * 检查 key 当前是否被允许继续尝试。
   * @param {string} key
   * @returns {{ allowed: boolean, retryAfterMs: number }}
   */
  check(key) {
    const now = this.now();
    this._cleanup(key, now);
    const entry = this.entries.get(key);
    if (entry && entry.lockedUntil && now < entry.lockedUntil) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  /** 记录一次失败；达到阈值后锁定。 */
  recordFailure(key) {
    const now = this.now();
    this._cleanup(key, now);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { failures: 0, firstAt: now, lockedUntil: 0 };
      this.entries.set(key, entry);
    }
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      entry.lockedUntil = now + this.lockMs;
    }
  }

  /** 成功（如登录成功）时清除计数。 */
  clear(key) {
    this.entries.delete(key);
  }
}

/**
 * 管理员登录限流中间件工厂。
 * 双维度计数：IP 维度 + IP:用户名 维度（防止换用户名绕过）。
 * 失败（401/403）计数，成功（2xx）清零。
 */
function adminLoginRateLimit(options = {}) {
  const limiter = new InMemoryRateLimiter(options);

  function keyOf(req) {
    const username = String((req.body && req.body.username) || '').trim().toLowerCase();
    return `${req.ip || 'unknown'}:${username}`;
  }

  const middleware = function adminLoginRateLimitMiddleware(req, res, next) {
    const ipKey = req.ip || 'unknown';
    const userKey = keyOf(req);

    for (const key of [ipKey, userKey]) {
      const result = limiter.check(key);
      if (!result.allowed) {
        return res.status(429).json(fail('尝试次数过多，请稍后再试', 429));
      }
    }

    res.on('finish', () => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        limiter.recordFailure(ipKey);
        limiter.recordFailure(userKey);
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        limiter.clear(ipKey);
        limiter.clear(userKey);
      }
    });

    next();
  };

  // 暴露底层 limiter 便于测试
  middleware.limiter = limiter;
  return middleware;
}

module.exports = {
  InMemoryRateLimiter,
  adminLoginRateLimit,
};
