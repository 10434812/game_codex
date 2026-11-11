/**
 * 音频资源表（原 utils/audio.js 的 SOURCES / VOICE_SOURCES / STAGE_* 三张表）。
 * 纯数据，不依赖 wx；由 platform/audio 播放。
 */

export const AUDIO_SOURCES = {
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
} as const;

const VOICE_BASE_URL = 'https://xcx.ukb88.com/assets/audio/voice';

export const VOICE_SOURCES = {
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
} as const;

export type VoiceKey = keyof typeof VOICE_SOURCES;

/** 景区名 → 语音键。 */
export const STAGE_VOICE_KEY_BY_NAME: Record<string, VoiceKey> = {
  万里长城: 'stageGreatWall',
  富士山: 'stageFuji',
  巴黎铁塔: 'stageEiffel',
  大峡谷: 'stageGrandCanyon',
  泰姬陵: 'stageTajMahal',
  西湖夜游: 'stageWestLake',
  鼓浪屿: 'stageGulangyu',
};

/** 景区名 → 背景音乐。原表未收录鼓浪屿，保持与小程序端一致。 */
export const STAGE_BGM_BY_NAME: Record<string, string> = {
  万里长城: AUDIO_SOURCES.changcheng,
  富士山: AUDIO_SOURCES.fujisan,
  巴黎铁塔: AUDIO_SOURCES.eiffel,
  大峡谷: AUDIO_SOURCES.grandCanyon,
  泰姬陵: AUDIO_SOURCES.tajMahal,
  西湖夜游: AUDIO_SOURCES.westLake,
};

export const DEFAULT_BGM_VOLUME = 0.38;
/** 原实现把传入音量再乘一个系数，保持同样的响度口径。 */
export const BGM_VOLUME_SCALE = 0.58;
