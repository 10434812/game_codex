const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'assets/audio/voice');
const ENV_FILE = path.join(ROOT_DIR, '.env.local');
const OPENAI_API_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || 'coral';
const DEFAULT_FORMAT = 'mp3';
const DEFAULT_SPEED = Number(process.env.OPENAI_TTS_SPEED || 1.02);
const DEFAULT_INSTRUCTIONS = process.env.OPENAI_TTS_INSTRUCTIONS ||
  '年轻、清晰、轻快，带一点国风游戏播报感；自然有情绪，但不要像客服，不要拖腔，不要夸张表演。';

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

function unquote(value) {
  const trimmed = String(value || '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    return;
  }
  const content = fs.readFileSync(ENV_FILE, 'utf8');
  const parts = content.split(/\r?\n/);
  for (const rawLine of parts) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (!process.env[key]) {
      process.env[key] = unquote(value);
    }
  }
}

async function createSpeech({apiKey, filename, text}) {
  const target = path.join(OUTPUT_DIR, filename);
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      voice: DEFAULT_VOICE,
      input: text,
      instructions: DEFAULT_INSTRUCTIONS,
      response_format: DEFAULT_FORMAT,
      speed: DEFAULT_SPEED,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI TTS failed for ${filename}: HTTP ${response.status} ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(target, buffer);
  console.log(`generated ${path.relative(ROOT_DIR, target)}`);
}

async function main() {
  loadEnvFile();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing. Put it in .env.local or export it before running.');
  }

  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  for (const [filename, text] of VOICE_LINES) {
    await createSpeech({apiKey, filename, text});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
