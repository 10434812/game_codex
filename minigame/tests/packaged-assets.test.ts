import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {STAGES} from '../src/core/Constants';

test('景区引用的本地图片存在于小游戏上传目录内', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const stage of STAGES) {
    if (stage.image.startsWith('/')) assert.ok(fs.existsSync(path.join(root, stage.image)), `${stage.name}: ${stage.image}`);
  }
});
