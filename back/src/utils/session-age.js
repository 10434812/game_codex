// Refresh requires a new WeChat code as well as a signed previous token.
// Preserve the first issuance across refreshes so a stolen session cannot live forever.
function sessionOrigin(payload, maxDays = 30, now = Math.floor(Date.now() / 1000)) {
  const origin = payload.oat ?? payload.iat;
  if (!Number.isSafeInteger(origin) || origin > now || now - origin > maxDays * 86400
    || !Number.isSafeInteger(payload.exp) || now - payload.exp > 7 * 86400) {
    throw Object.assign(new Error('登录凭证已失效，请重新登录'), {statusCode: 401});
  }
  return origin;
}
module.exports = {sessionOrigin};
