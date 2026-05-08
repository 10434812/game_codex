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
  bgm: '/assets/audio/result/bgm.mp3',
  changcheng: '/assets/audio/result/changcheng.mp3',
  fujisan: '/assets/audio/result/富士山下音频.mp3',
  eiffel: '/assets/audio/result/埃菲尔音频.mp3',
  grandCanyon: '/assets/audio/result/美洲大峡谷音频.mp3',
  tajMahal: '/assets/audio/result/泰姬陵音频.mp3',
  westLake: '/assets/audio/result/西湖夜景音频.mp3',
};

const STAGE_BGM_SOURCES = {
  '万里长城': SOURCES.changcheng,
  '富士山': SOURCES.fujisan,
  '巴黎铁塔': SOURCES.eiffel,
  '大峡谷': SOURCES.grandCanyon,
  '泰姬陵': SOURCES.tajMahal,
  '西湖夜游': SOURCES.westLake,
};

let initialized = false;
let sharedAudio = null;
let bgmAudio = null;
let currentBgmSrc = '';
const loopPool = {};

function initAudioOption() {
  if (initialized) {
    return;
  }
  initialized = true;
  try {
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      mixWithOther: true,
    });
  } catch (error) { }
}

function createAudio() {
  const audio = wx.createInnerAudioContext();
  audio.autoplay = false;
  audio.onError(() => {
    try {
      audio.stop();
      audio.destroy();
    } catch (error) { }
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

function getStageBgmSrc(stage) {
  if (!stage) {
    return SOURCES.bgm;
  }
  return STAGE_BGM_SOURCES[stage.name] || SOURCES.bgm;
}

function playBgmSource(src, options = {}) {
  if (!src) {
    return null;
  }

  const audio = getBgmAudio();
  const volume = typeof options.volume === 'number' ? options.volume : 0.38;
  try {
    audio.loop = true;
    audio.volume = volume;
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

function playCue(name, options = {}) {
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
    } catch (error) { }
    audio.src = src;
    audio.loop = useLoop;
    audio.volume = typeof options.volume === 'number' ? options.volume : 1;
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
  } catch (error) {}
}

function playVibrate(type = 'light') {
  try {
    wx.vibrateShort({ type });
  } catch (error) { }
}

module.exports = {
  playCue,
  playBgm,
  playStageBgm,
  stopBgm,
  playVibrate,
};
