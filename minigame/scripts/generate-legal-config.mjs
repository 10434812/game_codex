import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {legalConfig} = require('../../utils/legal-config.js');
const target = new URL('../src/core/LegalContent.ts', import.meta.url);
writeFileSync(target, `// 自动生成，来源：utils/legal-config.js。运行 npm run codegen 更新。\nexport const legalContent = ${JSON.stringify(legalConfig, null, 2)};\n`);
console.log('已同步小游戏法律文档配置');
