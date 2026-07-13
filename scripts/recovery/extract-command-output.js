#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

const [sessionFile, callId, outputFile] = process.argv.slice(2);
if (!sessionFile || !callId || !outputFile) {
  process.stderr.write('Usage: extract-command-output.js <session.jsonl> <call-id> <output-file>\n');
  process.exit(2);
}

let payload = '';
for (const line of fs.readFileSync(sessionFile, 'utf8').split('\n')) {
  if (!line) continue;
  let record;
  try {
    record = JSON.parse(line);
  } catch (_error) {
    continue;
  }
  if (
    record.type === 'response_item' &&
    record.payload?.type === 'function_call_output' &&
    record.payload.call_id === callId
  ) {
    payload = record.payload.output || '';
  }
}

const marker = 'Output:\n';
const markerIndex = payload.indexOf(marker);
if (markerIndex < 0) {
  process.stderr.write(`No command output found for ${callId}\n`);
  process.exit(1);
}

const content = payload.slice(markerIndex + marker.length);
fs.writeFileSync(outputFile, content);
process.stdout.write(`${outputFile}\t${Buffer.byteLength(content)} bytes\n`);
