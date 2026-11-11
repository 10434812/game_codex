/**
 * 从 utils/shop-store.js 生成 src/core/ShopCatalog.ts。
 *
 * 商品目录是小程序端与后端共享的运营数据（后端 back/src/services/shop-service.js
 * 另有一份手抄副本）。小游戏端不手抄第三份：这里以小程序端为唯一来源生成，
 * 生成结果由 tests/shop-store-parity.test.ts 与源数据逐项比对。
 *
 * 用法：npm run codegen（build 前自动执行）
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const requireFromHere = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../utils/shop-store.js');
const target = resolve(here, '../src/core/ShopCatalog.ts');

const shopStore = requireFromHere(source);
const catalog = shopStore.getCatalog();

if (!catalog || !Array.isArray(catalog.skin) || !Array.isArray(catalog.pet) || !Array.isArray(catalog.ring)) {
  throw new Error('utils/shop-store.js 的 getCatalog() 未返回预期结构，拒绝生成');
}

const body = JSON.stringify(catalog, null, 2);
const output = `/**
 * 商店商品目录 —— 自动生成，请勿手改。
 *
 * 来源：utils/shop-store.js 的 GOODS 表（唯一真源）。
 * 生成：npm run codegen（scripts/generate-shop-catalog.mjs）
 * 守卫：tests/shop-store-parity.test.ts 会与源数据逐项比对。
 */

import type {ShopCatalog} from './ShopTypes';

export const GOODS: ShopCatalog = ${body};
`;

mkdirSync(dirname(target), {recursive: true});
writeFileSync(target, output);
console.log(
  `已生成 ${target}（skin ${catalog.skin.length} / pet ${catalog.pet.length} / ring ${catalog.ring.length}）`
);
