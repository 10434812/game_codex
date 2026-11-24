// Sliding timestamps bound memory per connection and avoid bursts across window boundaries.
function actionBudget(limit, windowMs = 1000, now = Date.now) {
  let accepted = [];
  return () => {
    const at = now();
    accepted = accepted.filter((time) => at - time < windowMs);
    if (accepted.length >= limit) return false;
    accepted.push(at);
    return true;
  };
}
module.exports = {actionBudget};
