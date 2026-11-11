#!/usr/bin/env node
/**
 * 校验源码引用的 CDN 资源与本地文件是否一致。
 *
 * 背景：小程序包内只放少量图片，商品图/场景图/音频全部走
 * https://xcx.ukb88.com。本地压缩过资源后如果忘记同步线上，
 * 用户仍会下载旧的大图（曾出现 skin-01.png 本地 76KB、线上 610KB）。
 *
 * 用法：
 *   node scripts/check-cdn-assets.mjs              # 报告，不阻断
 *   node scripts/check-cdn-assets.mjs --strict     # 存在 404/大小不一致时退出码 1
 *   node scripts/check-cdn-assets.mjs --json       # 机器可读输出
 *
 * 仅发 HEAD 请求，不下载资源正文、不修改任何文件。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CDN_HOST = 'https://xcx.ukb88.com';
const SCAN_ROOTS = ['utils', 'pages', 'minigame/src', 'app.js'];
const SOURCE_EXT = /\.(js|ts|wxml|wxss|json)$/;
const URL_RE = /https:\/\/xcx\.ukb88\.com(\/[^'"`)\s<>]+)/g;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const LARGE_BYTES = 300 * 1024;
const CONCURRENCY = 6;

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const asJson = args.has('--json');

function walk(path, out = []) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) walk(join(path, name), out);
  } else if (stat.isFile() && SOURCE_EXT.test(path)) {
    out.push(path);
  }
  return out;
}

function collectUrls() {
  const urls = new Map();
  for (const root of SCAN_ROOTS) {
    for (const file of walk(resolve(ROOT, root))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(URL_RE)) {
        const pathname = match[1];
        if (!urls.has(pathname)) urls.set(pathname, new Set());
        urls.get(pathname).add(relative(ROOT, file));
      }
    }
  }
  // 去掉纯 API 路径（后端测试覆盖）与模板/目录字面量
  for (const key of urls.keys()) {
    if (key.startsWith('/api') || key.includes('${') || !/\.[a-z0-9]{2,5}$/i.test(key)) {
      urls.delete(key);
    }
  }
  return urls;
}

function localPathFor(pathname) {
  return resolve(ROOT, `.${decodeURIComponent(pathname)}`);
}

async function head(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      // 不带 identity 时服务器返回 gzip 且省略 content-length
      headers: { 'accept-encoding': 'identity' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    const rawLength = response.headers.get('content-length');
    const length = rawLength === null ? null : Number(rawLength);
    return {
      status: response.status,
      size: Number.isFinite(length) ? length : null,
      type: response.headers.get('content-type') || '',
      error: null,
    };
  } catch (error) {
    return { status: 0, size: null, type: '', error: error.message };
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

async function main() {
  const urls = collectUrls();
  const entries = [...urls.entries()].sort(([a], [b]) => a.localeCompare(b));

  const results = await mapLimit(entries, CONCURRENCY, async ([pathname, sources]) => {
    const local = localPathFor(pathname);
    let localSize = null;
    try {
      localSize = statSync(local).size;
    } catch {
      localSize = null;
    }
    const remote = await head(`${CDN_HOST}${pathname}`);
    let verdict = 'ok';
    if (remote.status !== 200) verdict = 'http-error';
    else if (localSize !== null && remote.size !== null && localSize !== remote.size) verdict = 'size-mismatch';
    else if (remote.size !== null && remote.size > LARGE_BYTES && IMAGE_EXT.test(pathname)) verdict = 'large';
    else if (localSize === null) verdict = 'remote-only';
    return {
      pathname,
      sources: [...sources],
      localSize,
      remoteSize: remote.size,
      status: remote.status,
      error: remote.error,
      verdict,
    };
  });

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const problems = results.filter((item) => item.verdict !== 'ok' && item.verdict !== 'remote-only');
    const remoteOnly = results.filter((item) => item.verdict === 'remote-only');
    const large = results.filter((item) => item.verdict === 'large');
    const mismatched = results.filter((item) => item.verdict === 'size-mismatch');
    const failed = results.filter((item) => item.verdict === 'http-error');

    console.log(`CDN 资源检查：${results.length} 个引用，${problems.length} 个需要处理\n`);

    if (failed.length) {
      console.log(`[404/不可达] ${failed.length} 个`);
      for (const item of failed) {
        console.log(`  ${item.pathname}  status=${item.status}  ${item.error || ''}`);
      }
      console.log('');
    }

    if (mismatched.length) {
      console.log(`[本地与线上不一致] ${mismatched.length} 个（本地已更新但未同步 CDN）`);
      for (const item of mismatched) {
        console.log(`  ${item.pathname}  本地 ${formatBytes(item.localSize)} / 线上 ${formatBytes(item.remoteSize)}`);
      }
      console.log('');
    }

    if (large.length) {
      console.log(`[线上单资源 > 300KB] ${large.length} 个`);
      for (const item of large) {
        console.log(`  ${item.pathname}  ${formatBytes(item.remoteSize)}`);
      }
      console.log('');
    }

    if (remoteOnly.length) {
      console.log(`仅线上存在（本地无源文件）：${remoteOnly.length} 个`);
      for (const item of remoteOnly) console.log(`  ${item.pathname}  ${formatBytes(item.remoteSize)}`);
      console.log('');
    }

    if (!problems.length) {
      console.log('全部资源状态一致。');
    } else {
      console.log('同步命令示例（确认无误后执行）：');
      console.log('  rsync -av --checksum assets/ <CDN 服务器>:/srv/xcx/assets/');
      console.log('  # 或只同步有差异的文件：');
      for (const item of mismatched) {
        console.log(`  assets${item.pathname.replace('/assets', '')}`);
      }
    }
  }

  if (strict) {
    const bad = results.filter((item) => item.verdict === 'http-error' || item.verdict === 'size-mismatch');
    if (bad.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[check-cdn-assets] 失败：', error);
  process.exitCode = 1;
});
