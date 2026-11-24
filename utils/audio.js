const {getSettings} = require('./audio-settings');
const SOURCES = {
  tap: 'https://xcx.ukb88.com/assets/audio/battle/button-tap.wav',
  invite: 'https://xcx.ukb88.com/assets/audio/battle/remote-invite.wav',
  remoteDissolve: 'https://xcx.ukb88.com/assets/audio/battle/remote-dissolve.wav',
  inviteSuccess: 'https://xcx.ukb88.com/assets/audio/battle/self-invite-success.wav',
  pairSelf: 'https://xcx.ukb88.com/assets/audio/battle/pair-success-self.wav',
  pairOther: 'https://xcx.ukb88.com/assets/audio/battle/pair-success-other.wav',
  actionFail: 'https://xcx.ukb88.com/assets/audio/battle/self-action-fail.wav',
  countdown3: 'https://xcx.ukb88.com/assets/audio/battle/countdown-3.wav',
  countdown2: 'https://xcx.ukb88.com/assets/audio/battle/countdown-2.wav',
  countdown1: 'https://xcx.ukb88.com/assets/audio/battle/countdown-1.wav',
  gameStart: 'https://xcx.ukb88.com/assets/audio/battle/countdown-go.wav',
  resultWin: 'https://xcx.ukb88.com/assets/audio/result/yanhua.mp3',
  bgm: 'https://xcx.ukb88.com/assets/audio/result/bgm.mp3',
  changcheng: 'https://xcx.ukb88.com/assets/audio/result/changcheng.mp3',
  fujisan: 'https://xcx.ukb88.com/assets/audio/result/富士山下音频.mp3',
  eiffel: 'https://xcx.ukb88.com/assets/audio/result/埃菲尔音频.mp3',
  grandCanyon: 'https://xcx.ukb88.com/assets/audio/result/美洲大峡谷音频.mp3',
  tajMahal: 'https://xcx.ukb88.com/assets/audio/result/泰姬陵音频.mp3',
  westLake: 'https://xcx.ukb88.com/assets/audio/result/西湖夜景音频.mp3',
};

const VOICE_BASE_URL = 'https://xcx.ukb88.com/assets/audio/voice';

const VOICE_SOURCES = {
  bootWelcome: `${VOICE_BASE_URL}/boot-welcome.mp3`,
  bootReady: `${VOICE_BASE_URL}/boot-ready.mp3`,
  homeGuide: `${VOICE_BASE_URL}/home-guide.mp3`,
  stageGreatWall: `${VOICE_BASE_URL}/stage-great-wall.mp3`,
  stageFuji: `${VOICE_BASE_URL}/stage-fuji.mp3`,
  stageEiffel: `${VOICE_BASE_URL}/stage-eiffel.mp3`,
  stageGrandCanyon: `${VOICE_BASE_URL}/stage-grand-canyon.mp3`,
  stageTajMahal: `${VOICE_BASE_URL}/stage-taj-mahal.mp3`,
  stageWestLake: `${VOICE_BASE_URL}/stage-west-lake.mp3`,
  stageGulangyu: `${VOICE_BASE_URL}/stage-gulangyu.mp3`,
  roomCreated: `${VOICE_BASE_URL}/room-created.mp3`,
  roomInviteSent: `${VOICE_BASE_URL}/room-invite-sent.mp3`,
  roomFull: `${VOICE_BASE_URL}/room-full.mp3`,
  roomNeedReady: `${VOICE_BASE_URL}/room-need-ready.mp3`,
  countdown3: `${VOICE_BASE_URL}/countdown-3.mp3`,
  countdown2: `${VOICE_BASE_URL}/countdown-2.mp3`,
  countdown1: `${VOICE_BASE_URL}/countdown-1.mp3`,
  countdownGo: `${VOICE_BASE_URL}/countdown-go.mp3`,
  arenaStart: `${VOICE_BASE_URL}/arena-start.mp3`,
  teamInvite: `${VOICE_BASE_URL}/team-invite.mp3`,
  teamSuccess: `${VOICE_BASE_URL}/team-success.mp3`,
  teamDissolved: `${VOICE_BASE_URL}/team-dissolved.mp3`,
  fortuneBag: `${VOICE_BASE_URL}/fortune-bag.mp3`,
  actionUnavailable: `${VOICE_BASE_URL}/action-unavailable.mp3`,
  resultComplete: `${VOICE_BASE_URL}/result-complete.mp3`,
  resultFirst: `${VOICE_BASE_URL}/result-first.mp3`,
  resultKoi: `${VOICE_BASE_URL}/result-koi.mp3`,
  resultNormal: `${VOICE_BASE_URL}/result-normal.mp3`,
};

const STAGE_VOICE_NAMES = {
  '万里长城': 'stageGreatWall',
  '富士山': 'stageFuji',
  '巴黎铁塔': 'stageEiffel',
  '大峡谷': 'stageGrandCanyon',
  '泰姬陵': 'stageTajMahal',
  '西湖夜游': 'stageWestLake',
  '鼓浪屿': 'stageGulangyu',
};

const STAGE_BGM_SOURCES = {
  '万里长城': SOURCES.changcheng,
  '富士山': SOURCES.fujisan,
  '巴黎铁塔': SOURCES.eiffel,
  '大峡谷': SOURCES.grandCanyon,
  '泰姬陵': SOURCES.tajMahal,
  '西湖夜游': SOURCES.westLake,
};

const DEFAULT_BGM_VOLUME = 0.38;
const BGM_VOLUME_SCALE = 0.58;

let initialized = false;
let sharedAudio = null;
let bgmAudio = null;
let voiceAudio = null;
let voiceEndedHandler = null;
let voiceErrorHandler = null;
let currentBgmSrc = '';
let currentBgmVolume = DEFAULT_BGM_VOLUME * BGM_VOLUME_SCALE;
let voiceSerial = 0;
const loopPool = {};
const lastVoicePlayedAt = {};

function normalizeBgmVolume(volume) {
  const rawVolume = typeof volume === 'number' ? volume : DEFAULT_BGM_VOLUME;
  return Math.max(0, Math.min(1, rawVolume * BGM_VOLUME_SCALE));
}

function isRealDevicePlatform() {
  try {
    if (typeof wx === 'undefined') {
      return false;
    }
    const deviceInfo = typeof wx.getDeviceInfo === 'function'
      ? wx.getDeviceInfo()
      : (typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null);
    return deviceInfo && (deviceInfo.platform === 'ios' || deviceInfo.platform === 'android');
  } catch (error) {
    return false;
  }
}

function initAudioOption() {
  if (initialized) {
    return;
  }
  initialized = true;
  // 开发者工具不支持此 API；背景音乐本身仍可正常播放。
  if (!isRealDevicePlatform()) return;
  try {
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      mixWithOther: true,
      fail(error) {
        console.warn('[audio] setInnerAudioOption error:', error);
      },
    });
  } catch (error) { console.warn('[audio] setInnerAudioOption error:', error); }
}

function createAudio() {
  const audio = wx.createInnerAudioContext();
  audio.autoplay = false;
  audio.onError(() => {
    try {
      audio.stop();
      audio.destroy();
    } catch (error) { console.warn('[audio] destroy audio error:', error); }
    // 只重置出错的那个实例的引用：误置其它 context（如正在播放的 BGM）会导致 stopBgm 失效、重复播放
    if (sharedAudio === audio) sharedAudio = null;
    if (bgmAudio === audio) {
      bgmAudio = null;
      currentBgmSrc = '';
    }
    if (voiceAudio === audio) {
      voiceAudio = null;
      voiceEndedHandler = null;
      voiceErrorHandler = null;
    }
    Object.keys(loopPool).forEach((name) => {
      if (loopPool[name] === audio) {
        delete loopPool[name];
      }
    });
  });
  return audio;
}

function getAudioByMode(name, useLoop) {
  if (useLoop) {
    if (!loopPool[name]) {
      loopPool[name] = createAudio();
    }
    return loopPool[name];
  }
  if (!sharedAudio) {
    sharedAudio = createAudio();
  }
  return sharedAudio;
}

function getBgmAudio() {
  if (!bgmAudio) {
    bgmAudio = createAudio();
  }
  return bgmAudio;
}

function getVoiceAudio() {
  if (!voiceAudio) {
    voiceAudio = createAudio();
  }
  return voiceAudio;
}

function getStageBgmSrc(stage) {
  if (!stage) {
    return SOURCES.bgm;
  }
  return STAGE_BGM_SOURCES[stage.name] || SOURCES.bgm;
}

function getStageVoiceName(stage) {
  if (!stage) {
    return '';
  }
  return STAGE_VOICE_NAMES[stage.name] || '';
}

function playBgmSource(src, options = {}) {
  if (!getSettings().music) return null;
  if (!src) {
    return null;
  }

  const audio = getBgmAudio();
  const volume = normalizeBgmVolume(options.volume);
  try {
    audio.loop = true;
    audio.volume = volume;
    currentBgmVolume = volume;
    if (currentBgmSrc === src) {
      return audio;
    }
    audio.src = src;
    currentBgmSrc = src;
    audio.play();
    return audio;
  } catch (error) {
    return null;
  }
}

function restoreBgmVolume(serial, volume) {
  if (serial !== voiceSerial || !bgmAudio || !currentBgmSrc) {
    return;
  }
  try {
    bgmAudio.volume = volume;
    currentBgmVolume = volume;
  } catch (error) { console.warn('[audio] restore bgm volume error:', error); }
}

function duckBgmForVoice(serial, duckVolume) {
  if (!bgmAudio || !currentBgmSrc) {
    return;
  }
  try {
    bgmAudio.volume = duckVolume;
  } catch (error) { console.warn('[audio] duck bgm volume error:', error); }

  const restoreTimer = setTimeout(() => {
    restoreBgmVolume(serial, currentBgmVolume);
  }, 2600);
  if (restoreTimer && typeof restoreTimer.unref === 'function') {
    restoreTimer.unref();
  }
}

function playCue(name, options = {}) {
  if (!getSettings().sound) return null;
  initAudioOption();
  const src = SOURCES[name];
  if (!src) {
    return null;
  }

  try {
    const useLoop = options.loop === true;
    const audio = getAudioByMode(name, useLoop);
    try {
      audio.stop();
      if (typeof audio.seek === 'function') {
        audio.seek(0);
      }
    } catch (error) { console.warn('[audio] stop bgm error:', error); }
    audio.src = src;
    audio.loop = useLoop;
    audio.volume = typeof options.volume === 'number' ? options.volume : 1;
    audio.play();
    return audio;
  } catch (error) {
    return null;
  }
}

function playVoice(name, options = {}) {
  if (!getSettings().voice) return null;
  initAudioOption();
  const src = VOICE_SOURCES[name];
  if (!src) {
    return null;
  }

  const now = Date.now();
  const debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : 1200;
  if (!options.force && debounceMs > 0 && now - (lastVoicePlayedAt[name] || 0) < debounceMs) {
    return null;
  }
  lastVoicePlayedAt[name] = now;

  try {
    const audio = getVoiceAudio();
    const serial = voiceSerial + 1;
    voiceSerial = serial;
    const restoreVolume = currentBgmVolume;
    const duckVolume = typeof options.duckVolume === 'number'
      ? normalizeBgmVolume(options.duckVolume)
      : Math.min(0.18, restoreVolume);

    try {
      audio.stop();
      if (typeof audio.seek === 'function') {
        audio.seek(0);
      }
    } catch (error) { console.warn('[audio] stop voice error:', error); }

    audio.src = src;
    audio.loop = false;
    audio.volume = typeof options.volume === 'number' ? options.volume : 1;
    duckBgmForVoice(serial, duckVolume);
    if (voiceEndedHandler && typeof audio.offEnded === 'function') {
      audio.offEnded(voiceEndedHandler);
    }
    if (voiceErrorHandler && typeof audio.offError === 'function') {
      audio.offError(voiceErrorHandler);
    }
    voiceEndedHandler = () => restoreBgmVolume(serial, restoreVolume);
    voiceErrorHandler = () => restoreBgmVolume(serial, restoreVolume);
    if (typeof audio.onEnded === 'function') {
      audio.onEnded(voiceEndedHandler);
    }
    if (typeof audio.onError === 'function') {
      audio.onError(voiceErrorHandler);
    }
    audio.play();
    return audio;
  } catch (error) {
    return null;
  }
}

function playBgm(options = {}) {
  initAudioOption();
  return playBgmSource(SOURCES.bgm, options);
}

function playStageBgm(stage, options = {}) {
  initAudioOption();
  return playBgmSource(getStageBgmSrc(stage), options);
}

function stopBgm() {
  if (!bgmAudio) {
    return;
  }
  try {
    bgmAudio.stop();
    if (typeof bgmAudio.seek === 'function') {
      bgmAudio.seek(0);
    }
    currentBgmSrc = '';
  } catch (error) { console.warn('[audio] playEffect error:', error); }
}

function playVibrate(type = 'light') {
  if (!getSettings().haptics) return null;
  try {
    if (!isRealDevicePlatform()) {
      return;
    }
    wx.vibrateShort({ type });
  } catch (error) { console.warn('[audio] playVibrate error:', error); }
}

function destroy() {
  try {
    if (sharedAudio) {
      sharedAudio.stop();
      sharedAudio.destroy();
      sharedAudio = null;
    }
  } catch (error) { console.warn('[audio] destroy sharedAudio error:', error); }
  try {
    if (voiceAudio) {
      voiceAudio.stop();
      voiceAudio.destroy();
      voiceAudio = null;
    }
  } catch (error) { console.warn('[audio] destroy voiceAudio error:', error); }
  try {
    if (bgmAudio) {
      bgmAudio.stop();
      bgmAudio.destroy();
      bgmAudio = null;
    }
  } catch (error) { console.warn('[audio] destroy bgmAudio error:', error); }
  try {
    const names = Object.keys(loopPool);
    for (const name of names) {
      try {
        loopPool[name].stop();
        loopPool[name].destroy();
      } catch (error) { console.warn('[audio] destroy loopPool item error:', error); }
    }
  } catch (error) { console.warn('[audio] destroy loopPool error:', error); }
  Object.keys(loopPool).forEach(key => delete loopPool[key]);
  currentBgmSrc = '';
  currentBgmVolume = DEFAULT_BGM_VOLUME * BGM_VOLUME_SCALE;
  voiceSerial = 0;
  initialized = false;
  Object.keys(lastVoicePlayedAt).forEach(key => delete lastVoicePlayedAt[key]);
}

// Page-owned one-shot effects use the same preferences and resource catalog.
function createEffectAudio(name, options = {}) {
  if (!getSettings().sound || !SOURCES[name]) return null;
  initAudioOption();
  const audio = createAudio(); audio.autoplay = false; audio.loop = false;
  audio.volume = typeof options.volume === 'number' ? options.volume : .8; audio.src = SOURCES[name];
  return audio;
}
function applySettings() {
  const settings = getSettings();
  if (!settings.music) stopBgm();
  if (!settings.voice) {voiceSerial++; try {voiceAudio?.stop();} catch (_) {}}
  if (!settings.sound) {
    try {sharedAudio?.stop();} catch (_) {}
    for (const audio of Object.values(loopPool)) {try {audio.stop();} catch (_) {}}
  }
}
module.exports = {
  applySettings,
  createEffectAudio,
  playCue,
  playVoice,
  playBgm,
  playStageBgm,
  stopBgm,
  playVibrate,
  destroy,
  getStageVoiceName,
};
