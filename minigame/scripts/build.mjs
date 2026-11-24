import {build} from 'esbuild';
import {mkdir, readdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const output = new URL('../dist/', import.meta.url);
// Clear only generated .js files; preserve any unexpected user files.
async function clearGenerated(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await clearGenerated(file);
    else if (entry.name.endsWith('.js')) await unlink(file);
  }
}
await mkdir(output, {recursive: true});
await clearGenerated(fileURLToPath(output));
const result = await build({entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true, minify: true, treeShaking: true, format: 'esm', platform: 'neutral', target: 'es2020', metafile: true});
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some((file) => /\/(GameStore|GameEngine)\.ts$/.test(file))) throw new Error('Offline simulation leaked into the production bundle');
console.log(`小游戏发布脚本：${result.metafile.outputs['dist/main.js'].bytes} bytes；排除设备玩法与测试模块。`);
