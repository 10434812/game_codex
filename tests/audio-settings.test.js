const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../utils/audio-settings');
test('audio settings preserve independent toggles, tolerate corrupt storage and persist across module reload', (t) => {
  const original = global.wx, storage = new Map(); t.after(() => {global.wx = original;});
  global.wx = {getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value)};
  assert.deepEqual(settings.getSettings(), {music: true, sound: true, voice: true, haptics: true});
  settings.setSetting('sound', false); settings.setSetting('music', false);
  assert.equal(settings.getSettings().voice, true);
  delete require.cache[require.resolve('../utils/audio-settings')];
  assert.equal(require('../utils/audio-settings').getSettings().sound, false);
  settings.setSetting('unknown', false); assert.equal(Object.hasOwn(settings.getSettings(), 'unknown'), false);
});
test('disabled music/effects/haptics do not invoke APIs; voice works independently and stops immediately', (t) => {
  const original = global.wx, storage = new Map(); let created = 0, played = 0, stopped = 0, vibrated = 0;
  global.wx = {getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    getSystemInfoSync: () => ({platform: 'ios'}), setInnerAudioOption() {},
    createInnerAudioContext() {created++; return {onError() {}, onEnded() {}, onPlay() {}, onStop() {}, onCanplay() {}, onWaiting() {}, play() {played++;}, stop() {stopped++;}, seek() {}, destroy() {}};},
    vibrateShort() {vibrated++;}};
  const current = require('../utils/audio-settings');
  for (const key of ['music', 'sound', 'haptics']) current.setSetting(key, false);
  const audio = require('../utils/audio');
  t.after(() => {audio.destroy(); global.wx = original;});
  audio.playStageBgm({name: '西湖'}); audio.playCue('tap'); audio.playVibrate('heavy');
  assert.equal(created, 0); assert.equal(vibrated, 0);
  audio.playVoice('bootWelcome', {debounceMs: 0}); assert.equal(played, 1);
  const before = stopped; current.setSetting('voice', false); audio.applySettings(); assert.ok(stopped > before);
  audio.playVoice('bootReady', {debounceMs: 0}); assert.equal(played, 1);
});
