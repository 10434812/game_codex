// Deliberately accept only operational fields; never serialize request/token bodies.
function log(level, msg, fields = {}) {
  const safe = {};
  for (const key of ['sessionId', 'statusCode', 'signal', 'count', 'drained', 'code', 'method', 'route']) {
    const value = fields[key];
    if (typeof value === 'string') safe[key] = value.slice(0, 160);
    else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
  }
  const output = {ts: new Date().toISOString(), level, msg, ...safe};
  (level === 'error' ? console.error : console.log)(JSON.stringify(output));
}
module.exports = {info: (msg, fields) => log('info', msg, fields), error: (msg, fields) => log('error', msg, fields)};
