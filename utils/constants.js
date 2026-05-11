const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const ROOM_UI_LIMIT = MAX_PLAYERS;
const GAME_DURATION_SECONDS = 180;
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

const DEFAULT_STAGE = {
  id: 1,
  code: '01',
  name: '万里长城',
  hot: true,
  income: '+150%',
  online: '4.2k',
  image: 'https://xcx.ukb88.com/assets/stages/great-wall-bg.jpg',
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
    image: 'https://xcx.ukb88.com/assets/stages/mount-fuji-bg.jpg',
  },
  {
    id: 3,
    code: '03',
    name: '巴黎铁塔',
    hot: true,
    income: '+135%',
    online: '3.8k',
    image: 'https://xcx.ukb88.com/assets/stages/eiffel-bg.jpg',
  },
  {
    id: 4,
    code: '04',
    name: '大峡谷',
    hot: false,
    income: '+112%',
    online: '2.7k',
    image: 'https://xcx.ukb88.com/assets/stages/grand-canyon-bg.jpg',
  },
  {
    id: 5,
    code: '05',
    name: '泰姬陵',
    hot: false,
    income: '+126%',
    online: '2.9k',
    image: 'https://xcx.ukb88.com/assets/stages/taj-mahal-bg.jpg',
  },
  {
    id: 6,
    code: '06',
    name: '西湖夜游',
    hot: true,
    income: '+142%',
    online: '4.6k',
    image: 'https://xcx.ukb88.com/assets/stages/xihu.png',
  },
  {
    id: 7,
    code: '07',
    name: '鼓浪屿',
    hot: false,
    income: '+118%',
    online: '2.4k',
    image: 'https://xcx.ukb88.com/assets/stages/gulangyu.png',
  },
];

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
