import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {fileURLToPath} from 'node:url';

// 生成方向：minigame/src（真源）→ utils/ 与 back/src/game-engine/ 下的生成副本。
// `--check`：只比对磁盘副本与真源转译结果，不写入；任一副本过期则以非零退出。
const checkOnly = process.argv.includes('--check');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = [['minigame/src/core/RunArena.ts', 'utils/run-arena.js', 'back/src/game-engine/run-arena.js'],
  ['minigame/src/render/arena-effects.ts', 'utils/arena-effects.js'],
  ['minigame/src/render/run-arena-renderer.ts', 'utils/run-arena-renderer.js']];

const stale = [];
for (const [source, ...targets] of sources) {
  const text = fs.readFileSync(path.join(root, source), 'utf8');
  const output = '// Generated from ' + source + '\n' + ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS}}).outputText;
  const rendered = output.replace('require("../core/RunArena")', 'require("./run-arena")');
  for (const target of targets) {
    const targetPath = path.join(root, target);
    if (checkOnly) {
      const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;
      if (current !== rendered) stale.push(target);
    } else {
      fs.writeFileSync(targetPath, rendered);
    }
  }
}

if (checkOnly) {
  if (stale.length) {
    console.error('生成副本与 minigame/src 真源不一致，请运行 npm --prefix minigame run codegen 后再提交：\n  ' + stale.join('\n  '));
    process.exit(1);
  }
  console.log('run-arena 生成副本与真源一致');
}
