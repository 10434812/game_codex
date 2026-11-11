#!/usr/bin/env node

/**
 * 管理后台首次初始化脚本（显式创建管理员，替代旧的登录自举逻辑）。
 *
 * 用法：
 *   node scripts/create-admin.js                     # 使用 ADMIN_USERNAME + 随机生成密码并打印一次
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=xxx node scripts/create-admin.js
 *   node scripts/create-admin.js --username=ops --password=xxx --role=super
 *
 * 安全说明：
 * - 若未提供 --password / ADMIN_PASSWORD，将生成随机密码并仅打印一次；
 * - 该脚本不受登录限流影响，是唯一的管理员创建入口；
 * - 创建成功后请妥善保管密码并轮换。
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../src/models/db');

const SALT_ROUNDS = 10;

function parseArgs(argv) {
  const args = { username: '', password: '', role: 'super' };
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  args.username = args.username || process.env.ADMIN_USERNAME || '';
  args.password = args.password || process.env.ADMIN_PASSWORD || '';
  return args;
}

async function main() {
  const { username, password, role } = parseArgs(process.argv.slice(2));
  if (!username) {
    console.error('缺少管理员用户名：请设置 ADMIN_USERNAME 或 --username=<name>');
    process.exitCode = 1;
    return;
  }
  if (!['super', 'normal'].includes(role)) {
    console.error('角色只支持 super / normal');
    process.exitCode = 1;
    return;
  }

  const existing = await db.queryOne('SELECT id, username, role FROM admins WHERE username = ?', [username]);
  if (existing) {
    console.error(`管理员 ${username} 已存在（id=${existing.id}, role=${existing.role}），如需重置密码请使用管理后台。`);
    process.exitCode = 1;
    return;
  }

  const finalPassword = password || crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(finalPassword, SALT_ROUNDS);
  const [result] = await db.execute(
    'INSERT INTO admins (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)',
    [username, passwordHash, role]
  );

  console.log('==================================================');
  console.log('管理后台管理员创建成功');
  console.log(`  用户名: ${username}`);
  console.log(`  角色:   ${role}`);
  console.log(`  密码:   ${finalPassword}`);
  console.log('  注意:   密码仅本次打印，请立即保存；登录后请尽快修改。');
  console.log('==================================================');
}

main()
  .catch((error) => {
    console.error('[create-admin] failed:', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (db.pool && typeof db.pool.end === 'function') {
      await db.pool.end();
    }
  });
