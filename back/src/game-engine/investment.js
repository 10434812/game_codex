const INVESTMENT_POOL = [
  {category: '股票', name: '新能源龙头'},
  {category: '股票', name: '芯片指数ETF'},
  {category: '房产', name: '核心商圈写字楼'},
  {category: '房产', name: '地铁口租赁公寓'},
  {category: '比特币', name: 'BTC 波段机会'},
  {category: '比特币', name: '矿企联动仓位'},
];

const FORTUNE_BAG_ASSETS = {
  房产: 'https://xcx.ukb88.com/assets/battle/fortune-fangchan.png',
  股票: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
  比特币: 'https://xcx.ukb88.com/assets/battle/fortune-bitebi.png',
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
  return FORTUNE_BAG_ASSETS[category] || FORTUNE_BAG_ASSETS.房产;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRiskRangeMap() {
  return {
    high: {min: 0.18, max: 1.72, label: '高波动'},
    mid: {min: 0.52, max: 1.38, label: '中波动'},
    low: {min: 0.76, max: 1.14, label: '稳健'},
  };
}

function buildOpportunity(selfScore, random = Math.random) {
  const item = randomPick(INVESTMENT_POOL, random) || {category: '股票', name: '随机机会'};
  const riskLevel = selfScore < 250 ? 'high' : selfScore < 520 ? 'mid' : 'low';
  const costMin = selfScore < 250 ? 50 : 80;
  const costMax = selfScore < 250 ? 210 : selfScore < 520 ? 280 : 360;
  const cost = randomInt(costMin, costMax, random);
  const rangeMap = getRiskRangeMap();
  const range = rangeMap[riskLevel] || rangeMap.mid;
  return {
    ...item,
    cost,
    riskLevel,
    riskText: range.label,
    floatRangeText: `${Math.round((range.min - 1) * 100)}% ~ +${Math.round((range.max - 1) * 100)}%`,
    summary: '买入后需等待时机卖出，持有时间越长波动越大。',
    asset: getFortuneBagAsset(item.category),
  };
}

function settlePosition(position, random = Math.random) {
  const risk = position && position.riskLevel ? position.riskLevel : 'mid';
  const cost = Math.max(1, Number(position && position.cost ? position.cost : 1));
  const buyAt = Number(position && position.buyAt ? position.buyAt : Date.now());
  const holdSeconds = Math.max(0, Math.round((Date.now() - buyAt) / 1000));
  const baseRange = getRiskRangeMap()[risk] || getRiskRangeMap().mid;

  // 持有越久，围绕中心值的波动越大，不再提供正向收益加成。
  const center = (baseRange.min + baseRange.max) / 2;
  const halfSpan = (baseRange.max - baseRange.min) / 2;
  const volatilityBoost = clamp(holdSeconds / 180, 0, 0.36);
  const span = halfSpan * (1 + volatilityBoost);
  const min = Math.max(0.05, center - span);
  const max = center + span;
  const multiplier = min + (max - min) * random();
  const proceeds = Math.max(0, Math.round(cost * multiplier));
  const pnl = proceeds - cost;
  const pnlSign = pnl >= 0 ? '+' : '';
  return {
    proceeds,
    pnl,
    pnlText: `${pnlSign}${pnl}`,
    multiplierText: `${Math.round(multiplier * 100)}%`,
  };
}

module.exports = {
  FORTUNE_BAG_ASSETS,
  INVESTMENT_POOL,
  buildOpportunity,
  getFortuneBagAsset,
  settlePosition,
};
