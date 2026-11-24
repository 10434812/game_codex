import {getWx} from '../platform/wx';
const KEY = 'jinli.audio.settings.v1';
export const DEFAULT_AUDIO = {music: true, sound: true, voice: true, haptics: true};
export type AudioSettings = typeof DEFAULT_AUDIO;
let cached: AudioSettings | null = null, owner: ReturnType<typeof getWx> = null;
export function getSettings(): AudioSettings {
  const wx = getWx();
  if (!cached || owner !== wx) {
    owner = wx; let stored: Partial<AudioSettings> = {};
    try {stored = wx?.getStorageSync(KEY) as Partial<AudioSettings> || {};} catch { /* default settings */ }
    cached = {...DEFAULT_AUDIO};
    for (const key of Object.keys(DEFAULT_AUDIO) as (keyof AudioSettings)[]) if (typeof stored[key] === 'boolean') cached[key] = stored[key]!;
  }
  return {...cached};
}
export function setSetting(key: keyof AudioSettings, value: boolean): AudioSettings {
  cached = {...getSettings(), [key]: value};
  try {getWx()?.setStorageSync(KEY, cached);} catch { /* session setting stays active */ }
  return {...cached};
}
