const FORTUNE_POOL = [
  {category: '秘境', name: '神秘古井'},
  {category: '秘境', name: '灵龟秘境'},
  {category: '奇遇', name: '锦鲤跃龙门'},
  {category: '奇遇', name: '月下灵泉'},
  {category: '祥瑞', name: '祥云福地'},
  {category: '祥瑞', name: '金鳞洞天'},
];

const FORTUNE_BAG_ASSETS = {
  秘境: 'https://xcx.ukb88.com/assets/battle/fortune-fangchan.png',
  奇遇: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
  祥瑞: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
};

function randomInt(min, max, random = Math.random) {
  return min + Math.floor(random() * (max - min + 1));
}

function randomPick(list, random = Math.random) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  return list[randomInt(0, list.length - 1, random)];
}

function getFortuneBagAsset(category) {
  return FORTUNE_BAG_ASSETS[category] || FORTUNE_BAG_ASSETS.秘境;
}

function buildOpportunity(_selfScore, random = Math.random) {
  const item = randomPick(FORTUNE_POOL, random) || {category: '秘境', name: '随机机缘'};
  return {
    ...item,
    bonus: 60,
    summary: '领取即可获得固定积分加成，不涉及投入或随机盈亏。',
    asset: getFortuneBagAsset(item.category),
  };
}

module.exports = {
  FORTUNE_BAG_ASSETS,
  FORTUNE_POOL,
  buildOpportunity,
  getFortuneBagAsset,
  randomInt,
  randomPick,
};
