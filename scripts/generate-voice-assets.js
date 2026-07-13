const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'assets/audio/voice');
const DEFAULT_VOICE = process.env.VOICE_NAME || 'Tingting';
const DEFAULT_RATE = process.env.VOICE_RATE || '185';

const VOICE_LINES = [
  ['boot-welcome.mp3', '欢迎来到锦鲤前程。'],
  ['boot-ready.mp3', '好运已就位，准备出发。'],
  ['home-guide.mp3', '选择一个目的地，开启三分钟好运局。'],
  ['stage-great-wall.mp3', '万里长城，古韵雄风，征途开启。'],
  ['stage-fuji.mp3', '富士山，樱雪漫山，好运启程。'],
  ['stage-eiffel.mp3', '巴黎铁塔，星河灯塔，浪漫入局。'],
  ['stage-grand-canyon.mp3', '大峡谷，赤岩风谷，勇者同行。'],
  ['stage-taj-mahal.mp3', '泰姬陵，月白宫影，福运回响。'],
  ['stage-west-lake.mp3', '西湖夜游，江南夜色，一舟揽福。'],
  ['stage-gulangyu.mp3', '鼓浪屿，海岛琴声，暖风开局。'],
  ['room-created.mp3', '房间已创建，等待队友加入。'],
  ['room-invite-sent.mp3', '邀请已发送。'],
  ['room-full.mp3', '房间人数已满。'],
  ['room-need-ready.mp3', '请先完成准备。'],
  ['countdown-3.mp3', '三。'],
  ['countdown-2.mp3', '二。'],
  ['countdown-1.mp3', '一。'],
  ['countdown-go.mp3', '开始。'],
  ['arena-start.mp3', '好运局开始，抓住每一次机会。'],
  ['team-invite.mp3', '组队邀请已发出。'],
  ['team-success.mp3', '组队成功，收益加成开启。'],
  ['team-dissolved.mp3', '组队关系已解除。'],
  ['fortune-bag.mp3', '福袋出现，限时机会来了。'],
  ['buy-success.mp3', '买入成功，等待收益变化。'],
  ['sell-profit.mp3', '卖出成功，收益到账。'],
  ['sell-loss.mp3', '卖出完成，本次略有波动。'],
  ['action-unavailable.mp3', '当前无法操作。'],
  ['result-complete.mp3', '本局结算完成。'],
  ['result-first.mp3', '恭喜你，本局夺得第一。'],
  ['result-koi.mp3', '你是本局锦鲤，好运已到账。'],
  ['result-normal.mp3', '继续积累好运，下一局再冲榜。'],
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function ensureCommand(command, hint) {
  const result = spawnSync('command', ['-v', command], {
    shell: true,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    throw new Error(`${command} not found. ${hint}`);
  }
}

function main() {
  ensureCommand('say', 'macOS should include say by default.');
  ensureCommand('ffmpeg', 'Install ffmpeg first, for example: brew install ffmpeg');
  fs.mkdirSync(OUTPUT_DIR, {recursive: true});

  for (const [filename, text] of VOICE_LINES) {
    const target = path.join(OUTPUT_DIR, filename);
    const tempAiff = path.join(os.tmpdir(), `jinli-voice-${path.basename(filename, '.mp3')}.aiff`);

    run('say', ['-v', DEFAULT_VOICE, '-r', DEFAULT_RATE, '-o', tempAiff, text]);
    run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      tempAiff,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '96k',
      '-ar',
      '44100',
      target,
    ]);
    fs.rmSync(tempAiff, {force: true});
    console.log(`generated ${path.relative(ROOT_DIR, target)}`);
  }
}

main();
