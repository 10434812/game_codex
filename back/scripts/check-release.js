require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getReleaseBlockers } = require('../src/services/release-readiness');

const {checkGameplaySchema, checkLoginSettings, checkApiCapabilities} = require('./check-gameplay-release');
const args = process.argv.slice(2);
const allowed = new Set(['--database', '--url', '--target', '--assets']);
let publicUrl = null;
let target = 'miniprogram';
for (let index = 0; index < args.length; index += 1) {
  if (!allowed.has(args[index])) {
    console.error('用法：npm run release:check -- [--target miniprogram|minigame] [--database] [--url https://服务域名] [--assets]');
    process.exit(2);
  }
  if (args[index] === '--target') {
    target = args[++index];
    if (!['miniprogram', 'minigame'].includes(target)) {
      console.error('--target 请选择 miniprogram 或 minigame');
      process.exit(2);
    }
  }
  if (args[index] === '--url') {
    try {
      publicUrl = new URL(args[++index]);
      if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') throw new Error();
    } catch (_) {
      console.error('--url 必须是没有账号、查询参数或路径的 HTTPS 服务地址');
      process.exit(2);
    }
  }
}

async function checkDatabase(blockers) {
  const mysql = require('mysql2/promise');
  const { db } = require('../src/config');
  let connection;
  try {
    connection = await mysql.createConnection({ ...db, connectTimeout: 5000 });
    const [columns] = await connection.execute(
      'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)',
      [db.database, 'users', 'avatar_reviews']
    );
    if (!columns.some((row) => row.TABLE_NAME === 'users' && row.COLUMN_NAME === 'deleted_at')) {
      blockers.push('数据库：缺少 users.deleted_at，请核对 008 迁移。');
    }
    const avatarColumns = new Set(columns.filter((row) => row.TABLE_NAME === 'avatar_reviews').map((row) => row.COLUMN_NAME));
    if (!['user_id', 'trace_id', 'status', 'expires_at'].every((column) => avatarColumns.has(column))) {
      blockers.push('数据库：头像待审核表缺失或不完整，请核对 009 迁移。');
    }
    const [payments] = await connection.execute("SELECT COUNT(*) AS count FROM system_configs WHERE config_key LIKE 'wechat.pay_%'");
    if (Number(payments[0].count)) blockers.push('数据库：仍保留微信支付配置，请核对 006 迁移。');
    const [external] = await connection.execute("SELECT COUNT(*) AS count FROM fortune_sources WHERE provider <> 'simulated' AND is_active = 1");
    if (Number(external[0].count)) blockers.push('数据库：仍有启用的外部题材源，请核对 006/010 迁移。');
    const [settings] = await connection.execute("SELECT config_key, config_value FROM system_configs WHERE config_key IN ('fortune.reality_enabled', 'wechat.login_enabled', 'wechat.login_app_id', 'wechat.login_secret', 'wechat.minigame_app_id', 'wechat.minigame_secret', 'game.round_duration')");
    const settingsMap = new Map(settings.map((row) => [row.config_key, row.config_value]));
    if (settingsMap.get('fortune.reality_enabled') !== 'false') blockers.push('数据库：题材联动未明确关闭。');
    const { wx } = require('../src/config');
    const project = target === 'miniprogram' ? require('../../project.config.json') : require('../../minigame/project.config.json');
    checkLoginSettings(settingsMap, {target, expectedAppId: project.appid, nativeFallback: wx}, blockers);
    await checkGameplaySchema(connection, blockers);
    console.log('已完成数据库只读检查；未输出配置值或执行迁移。');
  } catch (error) {
    blockers.push(`数据库只读核查失败（${error.code || 'QUERY_FAILED'}）；未验证的项不视为通过。`);
  } finally {
    if (connection) await connection.end();
  }
}

async function checkPublicService(blockers) {
  try {
    const response = await fetch(new URL('/api/configs/public', publicUrl), {
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) throw new Error('HTTP_FAILED');
    const payload = await response.json();
    if (payload.code !== 0 || !payload.data || !payload.data.configs) throw new Error('INVALID_CONFIG_RESPONSE');
    const { configs, features } = payload.data;
    checkApiCapabilities(features, blockers);
    if (Object.keys(configs).some((key) => key.startsWith('wechat.pay_')) || (features && features.wechat && Object.hasOwn(features.wechat, 'payEnabled'))) {
      blockers.push('线上：仍返回已移除的支付能力，与当前纯娱乐版本不一致。');
    }
    if (configs['fortune.reality_enabled'] !== 'false') blockers.push('线上：题材联动未明确关闭。');
    if (!configs['wechat.login_agreement_url'] || !configs['wechat.login_privacy_url']) blockers.push('线上：协议或隐私政策入口为空。');
    console.log('已完成指定 HTTPS 服务的公开配置检查；未登录、未发起支付、未改数据。');
  } catch (error) {
    blockers.push('线上公开配置核查失败；请检查 HTTPS、网络与接口响应，未验证的项不视为通过。');
  }
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else if (entry.isFile()) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

/**
 * 管理后台 dist 是否可用：dist 已移出版本库，需要在部署机构建。
 * 缺失或早于源码都不阻断发布（可在目标机构建），但必须提示，避免把旧后台发上线。
 */
function checkAdminBuild(warnings) {
  const distIndex = path.resolve(__dirname, '../admin-web/dist/index.html');
  const srcDir = path.resolve(__dirname, '../admin-web/src');
  if (!fs.existsSync(distIndex)) {
    warnings.push('后台：admin-web/dist 不存在，部署前需在目标机执行 cd back/admin-web && npm install && npm run build。');
    return;
  }
  if (fs.existsSync(srcDir) && newestMtime(srcDir) > fs.statSync(distIndex).mtimeMs) {
    warnings.push('后台：dist 早于 src 最后修改，部署前请重新构建管理后台。');
  }
}

/** 源码引用的 CDN 资源与本地文件一致性（需要联网，显式 --assets 才执行） */
function checkAssets(blockers) {
  const script = path.resolve(__dirname, '../../scripts/check-cdn-assets.mjs');
  const result = spawnSync(process.execPath, [script, '--strict'], { stdio: 'inherit' });
  if (result.status !== 0) {
    blockers.push('资源：源码引用的 CDN 资源与本地文件不一致或不可达，请先同步 assets。');
  }
}

async function main() {
  const blockers = getReleaseBlockers({target});
  const warnings = [];
  const project = target === 'miniprogram' ? require('../../project.config.json') : require('../../minigame/project.config.json');
  console.log(`发布目标：${target === 'miniprogram' ? '小程序（仓库根目录）' : '小游戏（minigame/）'}`);
  if (project.setting.urlCheck !== true) blockers.push('客户端：合法域名检查被关闭，真机发布前必须恢复校验。');
  for (const name of ['WX_CONTENT_SAFETY_TOKEN', 'WX_CONTENT_SAFETY_AES_KEY', 'WX_CONTENT_SAFETY_BASE_URL']) {
    if (!process.env[name]) blockers.push(`内容安全：未配置 ${name}；还需在微信后台配置真实回调并验收。`);
  }
  checkAdminBuild(warnings);
  if (!args.includes('--database')) console.log('数据库未核查；使用 --database 显式执行目标库只读检查。');
  else await checkDatabase(blockers);
  if (publicUrl) await checkPublicService(blockers);
  else console.log('线上服务未核查；使用 --url https://服务域名 显式检查公开配置。');
  if (args.includes('--assets')) checkAssets(blockers);
  else console.log('CDN 资源未核查；使用 --assets 显式比对本地与线上资源。');
  console.log('\n人工验收仍需：出版/备案材料、平台权限、实名防沉迷实接、内容审核真实回调、素材授权、备份恢复、双设备对局。');
  if (warnings.length) {
    console.warn(`\n部署提醒（${warnings.length} 项，不阻断）：\n${warnings.map((item) => `- ${item}`).join('\n')}`);
  }
  if (blockers.length) {
    console.error(`\n禁止正式公开发布（${blockers.length} 项）：\n${blockers.map((item) => `- ${item}`).join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('发布核查执行失败，禁止将本次结果视为通过。');
  process.exitCode = 1;
});
