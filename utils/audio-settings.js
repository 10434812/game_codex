const KEY = 'jinli.audio.settings.v1';
const defaults = {music: true, sound: true, voice: true, haptics: true};
let cached = null, owner = null;
function getSettings() {
  const platform = typeof wx === 'undefined' ? null : wx;
  if (!cached || owner !== platform) {
    owner = platform; let stored;
    try {stored = platform?.getStorageSync(KEY);} catch (_) {}
    cached = {...defaults};
    for (const key of Object.keys(defaults)) if (typeof stored?.[key] === 'boolean') cached[key] = stored[key];
  }
  return {...cached};
}
function setSetting(key, value) {
  const current = getSettings();
  if (!(key in defaults) || typeof value !== 'boolean') return current;
  cached = {...current, [key]: value};
  try {wx.setStorageSync(KEY, cached);} catch (_) {}
  return {...cached};
}
module.exports = {getSettings, setSetting};
