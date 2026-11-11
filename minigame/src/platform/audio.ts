/**
 * 音频。对应小程序端 utils/audio.js 的「共享 + 循环」两种模式，
 * 但资源地址由调用方传入，本模块不硬编码 URL。
 */

import {getWx, type WxInnerAudio} from './wx';

export class GameAudio {
  private bgm: WxInnerAudio | null = null;
  private cue: WxInnerAudio | null = null;
  private bgmUrl = '';
  private readonly lastVoiceAt: Record<string, number> = {};

  /** 循环播放背景音乐；同一首重复调用不重启。 */
  playBgm(url: string, volume = 0.38): void {
    const wxApi = getWx();
    if (!wxApi || !url) {
      return;
    }
    if (this.bgmUrl === url && this.bgm) {
      return;
    }
    this.stopBgm();
    const audio = wxApi.createInnerAudioContext();
    audio.src = url;
    audio.loop = true;
    audio.volume = volume;
    audio.onError((error) => console.warn('[audio] 背景音乐失败', url, error));
    audio.play();
    this.bgm = audio;
    this.bgmUrl = url;
  }

  stopBgm(): void {
    if (!this.bgm) {
      return;
    }
    try {
      this.bgm.stop();
      this.bgm.destroy();
    } catch (error) {
      console.warn('[audio] 停止背景音乐失败', error);
    }
    this.bgm = null;
    this.bgmUrl = '';
  }

  /** 播放一次性音效；新的音效会打断上一个。 */
  playCue(url: string, volume = 0.8): void {
    const wxApi = getWx();
    if (!wxApi || !url) {
      return;
    }
    if (!this.cue) {
      const audio = wxApi.createInnerAudioContext();
      audio.onError((error) => console.warn('[audio] 音效失败', error));
      this.cue = audio;
    }
    this.cue.stop();
    this.cue.src = url;
    this.cue.loop = false;
    this.cue.volume = volume;
    this.cue.play();
  }

  /**
   * 播放语音播报，带按资源去抖：同一段语音在 debounceMs 内重复触发会被忽略，
   * 避免连续事件把播报叠在一起（对应小程序端 playVoice 的 debounceMs）。
   */
  playVoice(url: string, debounceMs = 3000, volume = 0.9): void {
    const now = Date.now();
    const last = this.lastVoiceAt[url] || 0;
    if (now - last < debounceMs) {
      return;
    }
    this.lastVoiceAt[url] = now;
    this.playCue(url, volume);
  }

  destroy(): void {
    this.stopBgm();
    if (this.cue) {
      try {
        this.cue.destroy();
      } catch (error) {
        console.warn('[audio] 释放音效失败', error);
      }
      this.cue = null;
    }
  }
}
