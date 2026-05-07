const audio = require('./utils/audio.js');

App({
  onLaunch() {
    this.audio = audio;
  },
  audio: null
});
