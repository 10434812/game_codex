import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const minigameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('run-arena 生成副本与 minigame/src 真源一致（只读检查，不写入）', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-run-arena.mjs', '--check'], {cwd: minigameRoot, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
