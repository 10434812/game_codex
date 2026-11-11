#!/usr/bin/env node
/**
 * 图片资源压缩：输出到 assets-opt/，不覆盖源文件。
 *
 * 只处理 assets/ 下的图片（png/jpg/jpeg/webp），目标：
 * - 长边不超过 1280（全屏背景足够）
 * - 单图尽量压到 300KB 以下，超过 150KB 或超尺寸才重编码
 * - PNG 使用调色板 + 最高压缩级别
 *
 * 生成的 assets-opt/ 目录结构与 assets/ 一致，可直接整目录同步到 CDN。
 * 用法：
 *   node scripts/optimize-assets.mjs
 *   node scripts/optimize-assets.mjs --dir assets/battle --max-edge 1024
 */
import { createRequire } from 'node:module';
import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let sharp;
try {
  sharp = require('../back/node_modules/sharp');
} catch (error) {
  console.error('需要 sharp：先执行 cd back && npm install');
  throw error;
}

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const SOURCE_DIR = resolve(ROOT, argValue('--dir', 'assets'));
const OUTPUT_DIR = resolve(ROOT, argValue('--out', 'assets-opt'));
const MAX_EDGE = Number(argValue('--max-edge', '1280'));
const MIN_BYTES = 150 * 1024;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (IMAGE_EXT.has(extname(name).toLowerCase())) out.push(full);
  }
  return out;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

async function optimizeOne(file) {
  const stat = statSync(file);
  const rel = relative(SOURCE_DIR, file);
  const output = join(OUTPUT_DIR, rel);
  mkdirSync(dirname(output), { recursive: true });

  const ext = extname(file).toLowerCase();
  const image = sharp(file, { failOn: 'none' });
  const meta = await image.metadata();
  const longEdge = Math.max(meta.width || 0, meta.height || 0);

  if (stat.size <= MIN_BYTES && longEdge <= MAX_EDGE && ext !== '.png') {
    copyFileSync(file, output);
    return { file: rel, before: stat.size, after: stat.size, action: 'copy' };
  }

  let pipeline = sharp(file, { failOn: 'none' }).rotate();
  if (longEdge > MAX_EDGE) {
    pipeline = pipeline.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  }

  if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality: 80, effort: 10 });
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: 82, effort: 6 });
  } else {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
  }

  const buffer = await pipeline.toBuffer();
  if (buffer.length >= stat.size && longEdge <= MAX_EDGE) {
    copyFileSync(file, output);
    return { file: rel, before: stat.size, after: stat.size, action: 'kept' };
  }
  writeFileSync(output, buffer);
  return { file: rel, before: stat.size, after: buffer.length, action: 'compressed' };
}

async function main() {
  const files = walk(SOURCE_DIR);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const results = [];
  for (const file of files) {
    try {
      results.push(await optimizeOne(file));
    } catch (error) {
      console.error(`[skip] ${relative(SOURCE_DIR, file)}: ${error.message}`);
    }
  }

  const compressed = results.filter((item) => item.action === 'compressed');
  const before = results.reduce((sum, item) => sum + item.before, 0);
  const after = results.reduce((sum, item) => sum + item.after, 0);

  console.log(`处理 ${results.length} 个文件，重编码 ${compressed.length} 个`);
  for (const item of compressed) {
    const ratio = ((1 - item.after / item.before) * 100).toFixed(0);
    console.log(`  ${item.file}  ${formatKB(item.before)} → ${formatKB(item.after)}  (-${ratio}%)`);
  }
  console.log(`总计 ${formatKB(before)} → ${formatKB(after)}，输出：${relative(ROOT, OUTPUT_DIR)}/`);

  writeFileSync(
    join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), source: relative(ROOT, SOURCE_DIR), results }, null, 2)
  );
}

main().catch((error) => {
  console.error('[optimize-assets] 失败：', error);
  process.exitCode = 1;
});
