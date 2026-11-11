const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const COIN_URL = 'https://xcx.ukb88.com/assets/icons/koi-coin.svg';

test('锦鲤币图标仅从服务器加载', () => {
  for (const page of ['home', 'income']) {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages', page, 'index.wxml'), 'utf8');
    assert.equal(wxml.includes('/images/koi-coin.png'), false, `${page} 仍在引用本地锦鲤币图标`);
    assert.equal(wxml.includes(COIN_URL), true, `${page} 未引用服务器锦鲤币图标`);
  }
});
