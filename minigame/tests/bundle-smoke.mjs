import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, statSync} from 'node:fs';
import {createCanvas, GlobalFonts} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';
const output = '/tmp/jinli-bundle-smoke'; mkdirSync(output, {recursive: true});
const canvas = createCanvas(720, 1280), context = canvas.getContext('2d'), words = [];
const fillText = context.fillText.bind(context);
context.fillText = (text, ...args) => {words.push(text); return fillText(text, ...args);};
const storage = new Map();
let frame, memoryWarning, errors;
const audio = {src: '', volume: 0, loop: false, onError() {}, play() {}, stop() {}, destroy() {}};
globalThis.wx = {
  createCanvas: () => ({get width() {return canvas.width;}, set width(value) {canvas.width = value;}, get height() {return canvas.height;}, set height(value) {canvas.height = value;}, getContext: () => context}),
  getSystemInfoSync: () => ({windowWidth: 360, windowHeight: 780, screenWidth: 360, screenHeight: 780, pixelRatio: 1, statusBarHeight: 30}),
  getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: (key) => storage.delete(key),
  createImage: () => ({width: 0, height: 0, onload: null, onerror: null, src: ''}),
  onTouchStart() {}, onTouchMove() {}, onTouchEnd() {}, onTouchCancel() {}, onShow() {}, onHide() {},
  onError(callback) {errors = callback;}, onMemoryWarning(callback) {memoryWarning = callback;},
  showShareMenu() {}, onShareAppMessage() {}, onShareTimeline() {}, createInnerAudioContext: () => ({...audio}),
  request(options) {options.success({statusCode: 200, data: {code: 0, data: {configs: {}, features: {}}}});},
  getPrivacySetting(options) {options.success({needAuthorization: true});},
  getLaunchOptionsSync: () => ({query: {}}),
};
globalThis.requestAnimationFrame = (callback) => {frame = callback; return 1;};
await import('../dist/main.js');
for (let i = 0; i < 20; i++) await Promise.resolve();
assert.equal(typeof frame, 'function'); frame();
assert.ok(words.some((word) => word.includes('欢迎来到锦鲤前程')));
assert.ok(words.some((word) => word.includes('隐私') || word.includes('协议')));
assert.equal(typeof errors, 'function'); assert.equal(typeof memoryWarning, 'function');
memoryWarning();
const size = statSync(new URL('../dist/main.js', import.meta.url)).size;
assert.ok(size < 200 * 1024);
writeFileSync(output + '/boot.png', canvas.toBuffer('image/png'));
console.log(`压缩发布包启动通过：${size} bytes；隐私入口、平台回调及 Canvas 首帧：${output}/boot.png`);
delete globalThis.wx; delete globalThis.requestAnimationFrame;
