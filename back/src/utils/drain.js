// Keep ticking games and accepting their inputs during drain. Finished snapshots
// may remain cached, so count unsettled sessions rather than Map size.
function activeCount(games) {
  return [...games.values()].filter((game) => game.status !== 'finished' || game.settlementPromise).length;
}
async function waitForDrain({games, timeoutMs, pending = () => 0, now = Date.now, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))}) {
  const deadline = now() + timeoutMs;
  while (activeCount(games()) > 0 || pending() > 0) {
    if (now() >= deadline) return false;
    await pause(Math.min(250, deadline - now()));
  }
  return true;
}
module.exports = {activeCount, waitForDrain};
