/**
 * 解析 TRUST_PROXY 环境变量，供 `app.set('trust proxy', ...)` 使用。
 *
 * 生产环境部署在 nginx / 负载均衡之后时，Express 默认不信任
 * X-Forwarded-For，`req.ip` 会固定为代理地址，导致：
 * - 管理员登录限速按同一个 IP 计数（误锁或形同虚设）；
 * - 审计日志记录不到真实来源。
 *
 * 但无条件信任 X-Forwarded-For 又允许客户端伪造来源 IP。
 * 因此默认关闭，由部署方按实际拓扑显式开启：
 * - 未设置 / 空 / false：不信任（直连或开发环境）
 * - 数字：信任的代理跳数，nginx 单层通常为 1
 * - 其他字符串：交给 Express 解析（如 loopback、10.0.0.0/8）
 *
 * @param {string|undefined} value
 * @returns {boolean|number|string}
 */
function parseTrustProxy(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }
  const raw = String(value).trim();
  if (raw === 'false' || raw === '0') {
    return false;
  }
  if (raw === 'true') {
    return true;
  }
  if (/^\d+$/.test(raw)) {
    return parseInt(raw, 10);
  }
  return raw;
}

module.exports = { parseTrustProxy };
