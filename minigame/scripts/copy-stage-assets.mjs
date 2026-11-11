import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import constants from '../../utils/constants.js';
import {ARENA_EFFECT_ASSETS, ARENA_DROP_ASSETS} from '../../utils/arena-effects.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const asset of [...constants.STAGES.map((stage) => stage.image), ...Object.values(ARENA_EFFECT_ASSETS), ...Object.values(ARENA_DROP_ASSETS)]) {
  if (!asset.startsWith('/assets-pkg/')) continue;
  const relative = asset.slice(1);
  const target = path.join(root, 'minigame', relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(path.join(root, relative), target);
}
