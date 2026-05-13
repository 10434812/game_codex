const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const shopService = require('../src/services/shop-service');

test('backend shop catalog includes avatar ring items', async () => {
  const items = await shopService.getItems();

  assert.ok(items.some((item) => item.category === 'ring' && item.id === 'ring-amber-glow'));
});

test('user_items schema supports ring inventory category', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/001_create_tables.sql'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/shop.js'), 'utf8');

  assert.match(sql, /ENUM\('skin','pet','ring'\)/);
  assert.match(route, /\['skin', 'pet', 'ring'\]/);
});
