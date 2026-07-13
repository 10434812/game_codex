#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CODEX_BACKUP = '/Users/hh/.codex/backup-20260527-090628-session-visibility-repair/files';
const OUTPUT_DIR = path.resolve(__dirname, '../../docs/recovery');
const INVENTORY_PATH = path.join(OUTPUT_DIR, 'session-inventory.tsv');
const REPORT_PATH = path.join(OUTPUT_DIR, 'replay-report.json');
const START_TIME = Date.parse('2026-05-19T00:00:00+08:00');
const TARGET_ROOT = path.resolve(__dirname, '../..');
const PROJECT_ROOTS = [
  '/Users/hh/Desktop/game_codex',
  '/Users/hh/Desktop/game_codex_副本',
  '/Users/hh/Desktop/game_codex_小程序',
];

function walkJsonl(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  }
  return files.sort();
}

function projectPath(filePath) {
  for (const root of PROJECT_ROOTS) {
    if (filePath === root || filePath.startsWith(`${root}/`)) {
      return {
        root,
        relativePath: path.relative(root, filePath),
      };
    }
  }
  return null;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildPatch(event) {
  const relativePath = event.relativePath.split(path.sep).join('/');
  const oldPath = event.type === 'add' ? '/dev/null' : `a/${relativePath}`;
  const newPath = event.type === 'delete' ? '/dev/null' : `b/${relativePath}`;
  if (event.type === 'add' && !event.diff.trim() && typeof event.content === 'string') {
    const lines = event.content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const additions = lines.map((line) => `+${line}`).join('\n');
    return `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1,${lines.length} @@\n${additions}\n`;
  }
  return `--- ${oldPath}\n+++ ${newPath}\n${event.diff}${event.diff.endsWith('\n') ? '' : '\n'}`;
}

function applyEvent(event) {
  if (!event.diff.trim() && !(event.type === 'add' && event.content)) {
    return {status: 'skipped', reason: 'empty diff'};
  }
  const result = childProcess.spawnSync(
    'git',
    ['apply', '--recount', '--whitespace=nowarn', '-'],
    {
      cwd: TARGET_ROOT,
      input: buildPatch(event),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  if (result.status === 0) return {status: 'applied'};
  return {
    status: 'failed',
    reason: (result.stderr || result.stdout || `git apply exited ${result.status}`).trim(),
  };
}

function parseSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  let sessionId = path.basename(filePath, '.jsonl');
  let cwd = '';
  const events = [];

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (record.type === 'session_meta') {
      sessionId = record.payload?.id || sessionId;
      cwd = record.payload?.cwd || cwd;
      continue;
    }
    if (record.type !== 'event_msg' || record.payload?.type !== 'patch_apply_end') continue;
    if (record.payload.success !== true || !record.payload.changes) continue;
    const timestamp = Date.parse(record.timestamp);
    if (!Number.isFinite(timestamp)) continue;

    for (const [absolutePath, change] of Object.entries(record.payload.changes)) {
      const mapped = projectPath(absolutePath);
      if (!mapped || !mapped.relativePath || mapped.relativePath.startsWith('..')) continue;
      const diff = change.unified_diff || '';
      const content = typeof change.content === 'string' ? change.content : '';
      const identity = hash([
        record.timestamp,
        mapped.relativePath,
        change.type || '',
        diff,
        content,
        change.move_path || '',
      ].join('\0'));
      events.push({
        timestamp: record.timestamp,
        epoch: timestamp,
        sessionId,
        sessionFile: filePath,
        cwd,
        sourceRoot: mapped.root,
        relativePath: mapped.relativePath,
        type: change.type || 'update',
        movePath: change.move_path || '',
        diff,
        content,
        diffHash: hash(diff),
        identity,
      });
    }
  }
  return events;
}

function main() {
  const inventoryOnly = process.argv.includes('--inventory-only');
  const onlyFileIndex = process.argv.indexOf('--only-file');
  const afterIndex = process.argv.indexOf('--after');
  const onlyFile = onlyFileIndex >= 0 ? process.argv[onlyFileIndex + 1] : '';
  const afterTime = afterIndex >= 0 ? Date.parse(process.argv[afterIndex + 1]) : null;
  const allEvents = walkJsonl(CODEX_BACKUP).flatMap(parseSession);
  const unique = new Map();
  for (const event of allEvents) {
    if (!unique.has(event.identity)) unique.set(event.identity, event);
  }
  const allUniqueEvents = [...unique.values()].sort((a, b) =>
    a.epoch - b.epoch || a.relativePath.localeCompare(b.relativePath)
  );
  const events = allUniqueEvents.filter((event) =>
    event.epoch >= START_TIME &&
    (!onlyFile || event.relativePath === onlyFile) &&
    (!Number.isFinite(afterTime) || event.epoch > afterTime)
  );
  const seedAdds = allUniqueEvents.filter((event) =>
    event.epoch < START_TIME && event.type === 'add' && event.content
  );

  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  const header = [
    'timestamp', 'session_id', 'source_root', 'relative_path', 'type', 'diff_sha256', 'session_file',
  ];
  const rows = events.map((event) => [
    event.timestamp,
    event.sessionId,
    event.sourceRoot,
    event.relativePath,
    event.type,
    event.diffHash,
    event.sessionFile,
  ]);
  fs.writeFileSync(
    INVENTORY_PATH,
    [header, ...rows].map((row) => row.join('\t')).join('\n') + '\n'
  );

  const roots = {};
  const files = new Set();
  for (const event of events) {
    roots[event.sourceRoot] = (roots[event.sourceRoot] || 0) + 1;
    files.add(event.relativePath);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    source: CODEX_BACKUP,
    startTime: new Date(START_TIME).toISOString(),
    scannedPatchEvents: allEvents.length,
    uniquePatchEvents: events.length,
    historicalSeedCandidates: seedAdds.length,
    uniqueFiles: files.size,
    eventsBySourceRoot: roots,
    firstEvent: events[0]?.timestamp || null,
    lastEvent: events.at(-1)?.timestamp || null,
    applied: [],
    skipped: [],
    failed: [],
    seeded: [],
  };

  if (!inventoryOnly) {
    for (const event of seedAdds) {
      const target = path.join(TARGET_ROOT, event.relativePath);
      if (fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, event.content);
      report.seeded.push({
        timestamp: event.timestamp,
        sourceRoot: event.sourceRoot,
        relativePath: event.relativePath,
        sessionId: event.sessionId,
      });
    }
    for (const event of events) {
      const outcome = applyEvent(event);
      const entry = {
        timestamp: event.timestamp,
        sourceRoot: event.sourceRoot,
        relativePath: event.relativePath,
        type: event.type,
        diffHash: event.diffHash,
        sessionId: event.sessionId,
        ...(outcome.reason ? {reason: outcome.reason} : {}),
      };
      report[outcome.status].push(entry);
    }
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
