const fortuneService = require('../services/fortune-reality-service');

let timer = null;
let running = false;

async function runFortuneRealityRefresh() {
  if (running) return;
  running = true;
  try {
    const result = await fortuneService.refreshSources({
      force: false,
      generateReport: true,
    });
    const refreshed = result && result.refreshed ? result.refreshed.length : 0;
    const failed = result && result.failed ? result.failed.length : 0;
    if (refreshed || failed) {
      console.log(`[FortuneRealityJob] refreshed=${refreshed} failed=${failed}`);
    }
  } catch (error) {
    console.error('[FortuneRealityJob] refresh failed:', error.message);
  } finally {
    running = false;
  }
}

function startFortuneRealityJob() {
  if (process.env.NODE_ENV === 'test') return null;
  if (process.env.FORTUNE_REALITY_JOB_ENABLED === 'false') return null;
  if (timer) return timer;

  const intervalMs = Math.max(60000, Number(process.env.FORTUNE_REALITY_JOB_INTERVAL_MS || 300000));
  setTimeout(runFortuneRealityRefresh, 5000);
  timer = setInterval(runFortuneRealityRefresh, intervalMs);
  return timer;
}

function stopFortuneRealityJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runFortuneRealityRefresh,
  startFortuneRealityJob,
  stopFortuneRealityJob,
};
