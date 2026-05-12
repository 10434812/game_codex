const STAGE_MEDAL_MAP = {
  '万里长城': {
    achievement: '长城守望者',
    shortName: '长城',
    symbol: '城',
    accent: '#c86f18',
    glow: '#f1b24b',
  },
  '富士山': {
    achievement: '富士远眺者',
    shortName: '富士',
    symbol: '岳',
    accent: '#b65f86',
    glow: '#e6a6bd',
  },
  '巴黎铁塔': {
    achievement: '巴黎追光者',
    shortName: '巴黎',
    symbol: '塔',
    accent: '#9b6a24',
    glow: '#d7a454',
  },
  '大峡谷': {
    achievement: '峡谷远征者',
    shortName: '峡谷',
    symbol: '谷',
    accent: '#a9572c',
    glow: '#de8a52',
  },
  '泰姬陵': {
    achievement: '陵光旅人',
    shortName: '泰姬',
    symbol: '陵',
    accent: '#8f657b',
    glow: '#c996ad',
  },
  '西湖夜游': {
    achievement: '西湖泛月者',
    shortName: '西湖',
    symbol: '湖',
    accent: '#2f7e73',
    glow: '#75bdb0',
  },
  '鼓浪屿': {
    achievement: '海屿听潮者',
    shortName: '鼓浪',
    symbol: '屿',
    accent: '#2f6f9e',
    glow: '#7ab2d8',
  },
};

function normalizeStageName(stage) {
  if (typeof stage === 'string') {
    return stage.trim();
  }
  return String((stage && stage.name) || '').trim();
}

function getTier(gain, rank) {
  const scoreGain = Math.max(0, Number(gain) || 0);
  const rankNumber = Math.max(0, Number(rank) || 0);

  if (rankNumber === 1 || scoreGain >= 300) {
    return {
      key: 'legend',
      label: '金章',
      rim: '#f5b744',
      plate: '#fff3c8',
    };
  }
  if ((rankNumber > 0 && rankNumber <= 3) || scoreGain >= 180) {
    return {
      key: 'silver',
      label: '银章',
      rim: '#9aa8b7',
      plate: '#eef3f6',
    };
  }
  return {
    key: 'bronze',
    label: '铜章',
    rim: '#b46a3a',
    plate: '#f7ddc4',
  };
}

function buildAchievement(stage) {
  const stageName = normalizeStageName(stage);
  const config = STAGE_MEDAL_MAP[stageName];
  if (config) {
    return config.achievement;
  }
  return stageName ? `${stageName}旅者` : '远方旅者';
}

function buildAchievementMedal(options = {}) {
  const stageName = normalizeStageName(options.stage || options.stageName);
  const config = STAGE_MEDAL_MAP[stageName] || {};
  const achievement = String(options.achievement || config.achievement || buildAchievement(stageName));
  const tier = getTier(options.gain, options.rank);
  const shortName = config.shortName || achievement.slice(0, 2) || '远方';

  return {
    key: config.symbol || shortName,
    achievement,
    shortName,
    symbol: config.symbol || shortName.slice(0, 1) || '旅',
    tierKey: tier.key,
    tierLabel: tier.label,
    accent: config.accent || '#c86f18',
    glow: config.glow || '#f1b24b',
    rim: tier.rim,
    plate: tier.plate,
  };
}

module.exports = {
  buildAchievement,
  buildAchievementMedal,
};
