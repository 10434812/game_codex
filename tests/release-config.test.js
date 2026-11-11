const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'jinli-release-'));
  for (const folder of ['scripts', 'utils', 'minigame']) mkdirSync(path.join(root, folder));
  copyFileSync(path.resolve(__dirname, '../scripts/configure-release.mjs'), path.join(root, 'scripts/configure-release.mjs'));
  const original = 'const legalConfig = {\n  configured: false\n};\n';
  writeFileSync(path.join(root, 'utils/legal-config.js'), original);
  writeFileSync(path.join(root, 'project.config.json'), JSON.stringify({appid: 'wxd7f500f3f21f15dd', compileType: 'miniprogram'}));
  writeFileSync(path.join(root, 'minigame/project.config.json'), JSON.stringify({appid: ''}));
  const operator = path.join(root, 'operator.json');
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/configure-release.mjs'), '--operator', operator, ...args], {encoding: 'utf8'});
  return {root, operator, original, run, source: () => readFileSync(path.join(root, 'utils/legal-config.js'), 'utf8')};
}
test('发布配置保留待填写草案，校验失败时保留原配置', () => {
  const h = fixture();
  try {
    copyFileSync(path.resolve(__dirname, '../config/operator.example.json'), h.operator);
    assert.equal(h.run('--check').status, 1);
    assert.equal(h.source(), h.original);
  } finally {rmSync(h.root, {recursive: true, force: true});}
});
test('正式配置生成器默认更新小程序，显式选择小游戏时保持两端 AppID 独立', () => {
  const h = fixture();
  try {
    writeFileSync(h.operator, JSON.stringify({configured: true, operatorName: '集成验收主体', contact: '验收联系方式', effectiveDate: '2020-01-01',
      privacyVersion: '1', agreementVersion: '1', privacySections: [{heading: '信息处理', text: '验收正文'}], agreementSections: [{heading: '服务范围', text: '验收正文'}]}));
    assert.equal(h.run('--check').status, 0); assert.equal(h.source(), h.original);
    const testAppId = 'wx1234567890abcdef';
    assert.equal(h.run('--appid', testAppId).status, 0);
    const first = h.source();
    assert.match(first, /"configured": true/);
    assert.equal(h.run('--appid', testAppId).status, 0); assert.equal(h.source(), first);
    assert.equal(JSON.parse(readFileSync(path.join(h.root, 'project.config.json'), 'utf8')).appid, testAppId);
    assert.equal(JSON.parse(readFileSync(path.join(h.root, 'minigame/project.config.json'), 'utf8')).appid, '');
    const gameAppId = 'wxabcdef1234567890';
    assert.equal(h.run('--target', 'minigame', '--appid', gameAppId).status, 0);
    assert.equal(JSON.parse(readFileSync(path.join(h.root, 'minigame/project.config.json'), 'utf8')).appid, gameAppId);
    assert.equal(JSON.parse(readFileSync(path.join(h.root, 'project.config.json'), 'utf8')).appid, testAppId);
    assert.notEqual(h.run('--target', 'invalid').status, 0);
  } finally {rmSync(h.root, {recursive: true, force: true});}
});

