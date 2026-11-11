import {readFileSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const options = {target: 'miniprogram'};
function atomicWrite(file, source) {
  const temporary = new URL(file.href + '.tmp-' + process.pid);
  try {writeFileSync(temporary, source); renameSync(temporary, file);}
  finally {rmSync(temporary, {force: true});}
}
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--check') options.check = true;
  else if (['--operator', '--appid', '--target'].includes(key) && args[i + 1]) options[key.slice(2)] = args[++i];
  else throw new Error('用法：node scripts/configure-release.mjs --operator 配置文件 [--target miniprogram|minigame] [--appid 真实AppID] [--check]');
}
if (!['miniprogram', 'minigame'].includes(options.target)) throw new Error('发布目标请选择 miniprogram 或 minigame');
if (!options.operator) throw new Error('请通过 --operator 指定已补齐并确认的运营配置 JSON');
const input = JSON.parse(readFileSync(options.operator, 'utf8'));
const errors = [];
const incomplete = (value) => typeof value !== 'string' || !value.trim() || /待填写|待确认|示例|【|】|TODO|example\.com/i.test(value);
for (const key of ['operatorName', 'contact', 'effectiveDate', 'privacyVersion', 'agreementVersion']) if (incomplete(input[key])) errors.push(`请补齐 ${key}`);
for (const key of ['privacySections', 'agreementSections']) {
  if (!Array.isArray(input[key]) || !input[key].length) errors.push(`请提供 ${key}`);
  else input[key].forEach((section, index) => {if (incomplete(section.heading) || incomplete(section.text)) errors.push(`请确认 ${key}[${index}] 的正式内容`);});
}
if (input.configured !== true) errors.push('正式文本确认后将 configured 设置为 true');
if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate || '') || !Number.isFinite(Date.parse(input.effectiveDate)) || new Date(input.effectiveDate).toISOString().slice(0, 10) !== input.effectiveDate || Date.parse(`${input.effectiveDate}T00:00:00+08:00`) > Date.now()) errors.push('请填写已生效的真实日期');
if (options.appid && !/^wx[0-9a-f]{16}$/.test(options.appid)) errors.push('请输入微信分配的真实 AppID');
if (errors.length) {console.error(errors.join('\n')); process.exitCode = 1;}
else if (options.check) console.log('配置结构与文本完整性检查通过；平台账号、材料和权限继续按发布清单核验。');
else {
  const file = new URL('../utils/legal-config.js', import.meta.url);
  const original = readFileSync(file, 'utf8');
  const pattern = /const legalConfig = \{[\s\S]*?\n\};/;
  if (!pattern.test(original)) throw new Error('法律配置结构已变化，请核对生成器');
  const source = original.replace(pattern, `const legalConfig = ${JSON.stringify(input, null, 2)};`);
  atomicWrite(file, source);
  if (options.appid) {
    const project = new URL(options.target === 'miniprogram' ? '../project.config.json' : '../minigame/project.config.json', import.meta.url);
    const data = JSON.parse(readFileSync(project, 'utf8')); data.appid = options.appid;
    atomicWrite(project, `${JSON.stringify(data, null, 2)}\n`);
  }
  console.log(`已更新 ${fileURLToPath(file)}；${options.target === 'miniprogram' ? '请在微信开发者工具重新编译仓库根目录的小程序。' : '请执行 cd minigame && npm run build 同步并构建。'}`);
}
