#!/usr/bin/env node

const fortuneService = require('../src/services/fortune-reality-service');
const { stopFortuneRealityJob } = require('../src/jobs/fortune-reality-job');
const db = require('../src/models/db');

async function main() {
  const result = await fortuneService.refreshSources({
    force: true,
    generateReport: true,
  });

  console.log(JSON.stringify({
    refreshed: result.refreshed.length,
    skipped: result.skipped.length,
    failed: result.failed,
    report: result.report && {
      id: result.report.id,
      title: result.report.title,
      sentiment: result.report.sentiment,
      generatedAt: result.report.generatedAt,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[refresh-fortune-reality] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopFortuneRealityJob();
    if (db.pool && typeof db.pool.end === 'function') {
      await db.pool.end();
    }
  });
