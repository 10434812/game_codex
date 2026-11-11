const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const ROOM_UI_LIMIT = MAX_PLAYERS;
const GAME_DURATION_SECONDS = 120;
const ROUND_INTERVAL_SECONDS = 3;
const TEAM_SIZE = 2;
const ROOM_PLAYER_COUNT_OPTIONS = [4, 5, 6, 7, 8, 9, 10];
const MATCH_MODE_TEXT = '本地体验';

const INITIAL_SCORE_RANGE = {min: 80, max: 220};
const POSITIVE_SCORE_RANGE = {min: 20, max: 80};
const NEGATIVE_SCORE_RANGE = {min: 10, max: 60};

const POSITIVE_PROBABILITY = 0.6;
const SELF_POSITIVE_PROBABILITY = 0.65;
const SELF_TEAMMATE_POSITIVE_PROBABILITY = 0.62;
const TEAM_RESHUFFLE_PROBABILITY = 0.35;

const SELF_PLAYER_NAME = '祝你好运';
const SELF_PLAYER_STATE = '房主';
const ROBOT_PLAYER_STATE = '已就绪';
const HUMAN_PLAYER_STATE = '已就绪';
const WAITING_SLOT_NAME = '等待加入';
const PLAYER_STATUS_SELF_READY = '房主·已准备';
const PLAYER_STATUS_SELF_WAITING = '房主·未准备';
const STAGE_ASSET_BASE_URL = 'https://xcx.ukb88.com/assets/stages';
// Remote media filenames are mixed; pair image/video by the scene they actually show.
const DEFAULT_STAGE_THEME = {
  key: 'great-wall',
  primary: '#d9821f',
  bright: '#f5bc60',
  deep: '#8a4f1c',
  ink: '#4a2f17',
  title: '#fff7e8',
  soft: '#f4d99b',
  panel: 'rgba(255, 248, 231, 0.86)',
  panelSolid: '#fff8ea',
  chip: '#f0d5a7',
  border: 'rgba(224, 180, 111, 0.82)',
  glow: 'rgba(245, 188, 96, 0.3)',
  wash: 'rgba(245, 188, 96, 0.18)',
  shadow: 'rgba(84, 47, 20, 0.32)',
};

const DEFAULT_STAGE = {
  id: 1,
  code: '01',
  name: '万里长城',
  hot: true,
  income: '+150%',
  online: '4.2k',
  slogan: '古韵雄风 · 征途开启',
  image: `${STAGE_ASSET_BASE_URL}/great-wall-bg.jpg`,
  video: `${STAGE_ASSET_BASE_URL}/mount-fuji-bg.mp4`,
  titleColor: '#b96816',
  accentColor: '#d9821f',
  theme: DEFAULT_STAGE_THEME,
};

const STAGES = [
  DEFAULT_STAGE,
  {
    id: 2,
    code: '02',
    name: '富士山',
    hot: false,
    income: '+120%',
    online: '3.1k',
    slogan: '樱雪漫山 · 好运启程',
    image: `${STAGE_ASSET_BASE_URL}/mount-fuji-bg.jpg`,
    video: `${STAGE_ASSET_BASE_URL}/eiffel-bg.mp4`,
    titleColor: '#b65f86',
    accentColor: '#d7839e',
    theme: {
      key: 'fuji',
      primary: '#d7839e',
      bright: '#ffd1df',
      deep: '#8d4568',
      ink: '#4b2840',
      title: '#fff3f7',
      soft: '#f7c7d7',
      panel: 'rgba(255, 244, 248, 0.87)',
      panelSolid: '#fff4f8',
      chip: '#f1c4d3',
      border: 'rgba(220, 139, 166, 0.78)',
      glow: 'rgba(255, 190, 214, 0.32)',
      wash: 'rgba(255, 188, 215, 0.2)',
      shadow: 'rgba(79, 37, 62, 0.3)',
    },
  },
  {
    id: 3,
    code: '03',
    name: '巴黎铁塔',
    hot: true,
    income: '+135%',
    online: '3.8k',
    slogan: '星河灯塔 · 浪漫入局',
    image: `${STAGE_ASSET_BASE_URL}/eiffel-bg.jpg`,
    video: `${STAGE_ASSET_BASE_URL}/great-wall-bg.mp4`,
    titleColor: '#9b6a24',
    accentColor: '#c28a32',
    theme: {
      key: 'paris',
      primary: '#c28a32',
      bright: '#f1c56f',
      deep: '#68451d',
      ink: '#3f2b18',
      title: '#fff4dd',
      soft: '#e8c27a',
      panel: 'rgba(255, 246, 226, 0.86)',
      panelSolid: '#fff6e2',
      chip: '#ead0a0',
      border: 'rgba(206, 155, 74, 0.8)',
      glow: 'rgba(241, 197, 111, 0.28)',
      wash: 'rgba(241, 197, 111, 0.18)',
      shadow: 'rgba(55, 34, 16, 0.32)',
    },
  },
  {
    id: 4,
    code: '04',
    name: '大峡谷',
    hot: false,
    income: '+112%',
    online: '2.7k',
    slogan: '赤岩风谷 · 勇者同行',
    image: `${STAGE_ASSET_BASE_URL}/grand-canyon-bg.jpg`,
    video: `${STAGE_ASSET_BASE_URL}/grand-canyon-bg.mp4`,
    titleColor: '#a9572c',
    accentColor: '#cb7340',
    theme: {
      key: 'grand-canyon',
      primary: '#cb7340',
      bright: '#f2a365',
      deep: '#743821',
      ink: '#442116',
      title: '#fff1df',
      soft: '#efbd8b',
      panel: 'rgba(255, 241, 224, 0.86)',
      panelSolid: '#fff1e0',
      chip: '#edc09a',
      border: 'rgba(207, 124, 70, 0.76)',
      glow: 'rgba(242, 147, 92, 0.28)',
      wash: 'rgba(242, 147, 92, 0.18)',
      shadow: 'rgba(73, 31, 17, 0.34)',
    },
  },
  {
    id: 5,
    code: '05',
    name: '泰姬陵',
    hot: false,
    income: '+126%',
    online: '2.9k',
    slogan: '月白宫影 · 福运回响',
    image: `${STAGE_ASSET_BASE_URL}/taj-mahal-bg.jpg`,
    video: `${STAGE_ASSET_BASE_URL}/taj-mahal-bg.mp4`,
    titleColor: '#8f657b',
    accentColor: '#b97d91',
    theme: {
      key: 'taj-mahal',
      primary: '#b97d91',
      bright: '#ead7b0',
      deep: '#6b4b5b',
      ink: '#3f2f36',
      title: '#fff7ea',
      soft: '#dfc89b',
      panel: 'rgba(255, 247, 232, 0.87)',
      panelSolid: '#fff7e8',
      chip: '#e7d3aa',
      border: 'rgba(211, 180, 124, 0.78)',
      glow: 'rgba(235, 214, 176, 0.34)',
      wash: 'rgba(214, 187, 141, 0.2)',
      shadow: 'rgba(37, 39, 56, 0.34)',
    },
  },
  {
    id: 6,
    code: '06',
    name: '西湖夜游',
    hot: true,
    income: '+142%',
    online: '4.6k',
    slogan: '江南夜色 · 一舟揽福',
    image: `${STAGE_ASSET_BASE_URL}/xihhu.png`,
    video: `${STAGE_ASSET_BASE_URL}/xihhu-bg.mp4`,
    titleColor: '#2f7e73',
    accentColor: '#47a092',
    theme: {
      key: 'xihu',
      primary: '#47a092',
      bright: '#9bd7ca',
      deep: '#1f6158',
      ink: '#173d38',
      title: '#effff9',
      soft: '#b7dccb',
      panel: 'rgba(238, 252, 246, 0.87)',
      panelSolid: '#eefcf6',
      chip: '#c5e5d8',
      border: 'rgba(84, 166, 149, 0.72)',
      glow: 'rgba(115, 214, 194, 0.28)',
      wash: 'rgba(115, 214, 194, 0.18)',
      shadow: 'rgba(13, 62, 55, 0.32)',
    },
  },
  {
    id: 7,
    code: '07',
    name: '鼓浪屿',
    hot: false,
    income: '+118%',
    online: '2.4k',
    slogan: '海岛琴声 · 暖风开局',
    image: `${STAGE_ASSET_BASE_URL}/gulangyu.png`,
    video: `${STAGE_ASSET_BASE_URL}/gulangyu-bg.mp4`,
    titleColor: '#2f6f9e',
    accentColor: '#4b91bc',
    theme: {
      key: 'gulangyu',
      primary: '#4b91bc',
      bright: '#9ccfe3',
      deep: '#255b78',
      ink: '#16384d',
      title: '#edf8ff',
      soft: '#bddce8',
      panel: 'rgba(239, 249, 255, 0.87)',
      panelSolid: '#eff9ff',
      chip: '#c4deea',
      border: 'rgba(86, 151, 188, 0.74)',
      glow: 'rgba(120, 198, 228, 0.28)',
      wash: 'rgba(120, 198, 228, 0.18)',
      shadow: 'rgba(18, 57, 77, 0.32)',
    },
  },
];

function findStageConfig(stage = DEFAULT_STAGE) {
  const source = stage || {};
  const sourceId = source.id === undefined ? '' : String(source.id);
  const sourceName = String(source.name || '');
  return STAGES.find((candidate) => {
    return (sourceId && String(candidate.id) === sourceId) || (sourceName && candidate.name === sourceName);
  }) || DEFAULT_STAGE;
}

function resolveStage(stage = DEFAULT_STAGE) {
  const matched = findStageConfig(stage);
  const next = {
    ...DEFAULT_STAGE,
    ...matched,
    ...(stage || {}),
  };
  next.theme = resolveStageTheme(next);
  return next;
}

function resolveStageTheme(stage = DEFAULT_STAGE) {
  const matched = findStageConfig(stage);
  return {
    ...DEFAULT_STAGE_THEME,
    ...(matched.theme || {}),
    ...((stage && stage.theme) || {}),
  };
}

function buildStageThemeStyle(stage = DEFAULT_STAGE) {
  const theme = resolveStageTheme(stage);
  return [
    `--stage-primary: ${theme.primary}`,
    `--stage-bright: ${theme.bright}`,
    `--stage-deep: ${theme.deep}`,
    `--stage-ink: ${theme.ink}`,
    `--stage-title: ${theme.title}`,
    `--stage-soft: ${theme.soft}`,
    `--stage-panel: ${theme.panel}`,
    `--stage-panel-solid: ${theme.panelSolid}`,
    `--stage-chip: ${theme.chip}`,
    `--stage-border: ${theme.border}`,
    `--stage-glow: ${theme.glow}`,
    `--stage-wash: ${theme.wash}`,
    `--stage-shadow: ${theme.shadow}`,
  ].join('; ');
}

const AVATAR_POOL = Array.from({length: 12}, (_, index) => {
  const n = String(index + 1).padStart(2, '0');
  return `https://xcx.ukb88.com/assets/bg/avatars/avatar_${n}.png`;
});

const DEFAULT_AVATAR = AVATAR_POOL[0];

const ROBOT_NAMES = [
  '龙之传人',
  '锦鲤本鲤',
  '极客风暴',
  '浮生若梦',
  '月光诗人',
  '星河旅者',
  '云端漫步者',
  '夜空中最亮',
  '孤独的观测者',
  '林深见鹿',
  '疾风剑豪',
  '日落远航',
  '晨曦守望',
  '风起青萍',
  '雪山来客',
  '海岛拾梦',
];

const HUMAN_NAMES = [
  '清风明月',
  '晨星旅人',
  '山海同行',
  '白露未晞',
  '霁月光风',
  '听雨客',
  '惊鸿过隙',
  '远山近海',
];

const NAV_TABS = [
  {
    key: 'explore',
    label: '探索',
    icon: 'https://xcx.ukb88.com/assets/nav/explore.svg',
    iconActive: 'https://xcx.ukb88.com/assets/nav/explore_active.svg',
    page: '/pages/home/index',
  },
  {
    key: 'social',
    label: '社交',
    icon: 'https://xcx.ukb88.com/assets/nav/social.svg',
    iconActive: 'https://xcx.ukb88.com/assets/nav/social_active.svg',
    page: '/pages/room/index',
  },
  {
    key: 'play',
    label: '游玩',
    icon: 'https://xcx.ukb88.com/assets/nav/play.svg',
    iconActive: 'https://xcx.ukb88.com/assets/nav/play_active.svg',
    page: '/pages/arena/index',
  },
  {
    key: 'history',
    label: '历史',
    icon: 'https://xcx.ukb88.com/assets/nav/history.svg',
    iconActive: 'https://xcx.ukb88.com/assets/nav/history_active.svg',
    page: '/pages/result/index',
  },
];

module.exports = {
  AVATAR_POOL,
  buildStageThemeStyle,
  DEFAULT_AVATAR,
  DEFAULT_STAGE,
  GAME_DURATION_SECONDS,
  MATCH_MODE_TEXT,
  HUMAN_NAMES,
  HUMAN_PLAYER_STATE,
  INITIAL_SCORE_RANGE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NEGATIVE_SCORE_RANGE,
  POSITIVE_PROBABILITY,
  POSITIVE_SCORE_RANGE,
  ROBOT_NAMES,
  ROBOT_PLAYER_STATE,
  NAV_TABS,
  PLAYER_STATUS_SELF_READY,
  PLAYER_STATUS_SELF_WAITING,
  resolveStage,
  resolveStageTheme,
  ROOM_PLAYER_COUNT_OPTIONS,
  ROOM_UI_LIMIT,
  ROUND_INTERVAL_SECONDS,
  SELF_PLAYER_NAME,
  SELF_PLAYER_STATE,
  SELF_POSITIVE_PROBABILITY,
  SELF_TEAMMATE_POSITIVE_PROBABILITY,
  STAGES,
  TEAM_RESHUFFLE_PROBABILITY,
  TEAM_SIZE,
  WAITING_SLOT_NAME,
};
