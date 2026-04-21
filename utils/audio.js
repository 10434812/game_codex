const SOURCES = {
  tap: '/assets/audio/battle/button-tap.wav',
  invite: '/assets/audio/battle/remote-invite.wav',
  remoteDissolve: '/assets/audio/battle/remote-dissolve.wav',
  inviteSuccess: '/assets/audio/battle/self-invite-success.wav',
  pairSelf: '/assets/audio/battle/pair-success-self.wav',
  pairOther: '/assets/audio/battle/pair-success-other.wav',
  actionFail: '/assets/audio/battle/self-action-fail.wav',
  countdown3: '/assets/audio/battle/countdown-3.wav',
  countdown2: '/assets/audio/battle/countdown-2.wav',
  countdown1: '/assets/audio/battle/countdown-1.wav',
  gameStart: '/assets/audio/battle/countdown-go.wav',
  resultWin: '/assets/audio/result/firework-burst.wav',
};

let initialized = false;

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

function playCue(name, options = {}) {
  initAudioOption();
  const src = SOURCES[name];
  if (!src) {
    return;
  }

  try {
    const audio = wx.createInnerAudioContext();
    audio.src = src;
    audio.autoplay = false;
    audio.loop = options.loop === true;
    audio.volume = typeof options.volume === 'number' ? options.volume : 1;
    audio.onEnded(() => {
      if (!audio.loop) {
        audio.destroy();
      }
    });
    audio.onError(() => {
      audio.destroy();
    });
    audio.play();
    if (!audio.loop) {
      setTimeout(() => {
        try {
          audio.destroy();
        } catch (error) {}
      }, 5000);
    }
    return audio;
  } catch (error) {
    return null;
  }
}

module.exports = {
  playCue,
};
