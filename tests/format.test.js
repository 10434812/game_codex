const test = require('node:test');
const assert = require('node:assert/strict');
const {formatNumber, formatCurrency, formatDateTime} = require('../utils/format');

test('formatNumber 会把整数格式化为千分位字符串', () => {
  assert.equal(formatNumber(1234), '1,234');
  assert.equal(formatNumber(1000000), '1,000,000');
});

test('formatNumber 对 0 返回 "0"', () => {
  assert.equal(formatNumber(0), '0');
});

test('formatNumber 对 null 或 undefined 返回 "0"', () => {
  assert.equal(formatNumber(null), '0');
  assert.equal(formatNumber(undefined), '0');
});

test('formatNumber 对负数正确格式化', () => {
  assert.equal(formatNumber(-5678), '-5,678');
});

test('formatNumber 对非数字值返回 "0"', () => {
  assert.equal(formatNumber('abc'), '0');
  assert.equal(formatNumber(NaN), '0');
});

test('formatCurrency 默认格式化为 ¥ 前缀', () => {
  assert.equal(formatCurrency(100), '¥100');
  assert.equal(formatCurrency(1234), '¥1,234');
});

test('formatCurrency 对负数显示减号前缀', () => {
  assert.equal(formatCurrency(-50), '-¥50');
  assert.equal(formatCurrency(-1234), '-¥1,234');
});

test('formatCurrency showSign 对正数显示加号', () => {
  assert.equal(formatCurrency(100, {showSign: true}), '+¥100');
});

test('formatCurrency showSign 对负数和零不显示加号', () => {
  assert.equal(formatCurrency(-50, {showSign: true}), '-¥50');
  assert.equal(formatCurrency(0, {showSign: true}), '¥0');
});

test('formatCurrency 对 null 和 undefined 返回 "¥0"', () => {
  assert.equal(formatCurrency(null), '¥0');
  assert.equal(formatCurrency(undefined), '¥0');
});

test('formatDateTime 把 timestamp 格式化为 YYYY-MM-DD HH:mm', () => {
  const ts = new Date('2024-03-15T09:30:00').getTime();
  assert.equal(formatDateTime(ts), '2024-03-15 09:30');
});

test('formatDateTime 对无参数使用当前时间', () => {
  const result = formatDateTime();
  assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('formatDateTime 对空值使用当前时间', () => {
  const result = formatDateTime(null);
  assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
