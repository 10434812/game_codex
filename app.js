const audio = require('./utils/audio.js');
const gameStore = require('./utils/game-store');

App({
  onLaunch() {
    this.audio = audio;
    this.audio.playStageBgm(gameStore.getState().stage, {volume: 0.38});
  },
  onShow() {
    if (this.audio && typeof this.audio.playStageBgm === 'function') {
      this.audio.playStageBgm(gameStore.getState().stage, {volume: 0.38});
    }
  },
  audio: null
});
