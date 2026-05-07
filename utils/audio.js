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
  resultWin: 'https://xcx.ukb88.com/assets/audio/result/yanhua.wav',
};

let initialized = false;
let sharedAudio = null;
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
  } catch (error) {}
}

function createAudio() {
  const audio = wx.createInnerAudioContext();
  audio.autoplay = false;
  audio.onError(() => {
    try {
      audio.stop();
      audio.destroy();
    } catch (error) {}
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
    } catch (error) {}
    audio.src = src;
    audio.loop = useLoop;
    audio.volume = typeof options.volume === 'number' ? options.volume : 1;
    audio.play();
    return audio;
  } catch (error) {
    return null;
  }
}

function playVibrate(type = 'light') {
  try {
    wx.vibrateShort({type});
  } catch (error) {}
}

module.exports = {
  playCue,
  playVibrate,
};
