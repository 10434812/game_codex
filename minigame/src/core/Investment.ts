/**
 * 机缘福袋（原 utils/investment.js）。
 * 注意：当前版本已去金融化——buildOpportunity 只发固定 60 分加成，
 * 不含投入、不含随机盈亏。移植时保持这个语义，不要恢复历史盈亏逻辑。
 */

import {randomInt, randomPick, type RandomSource} from './Random';

export interface FortunePoolItem {
  category: string;
  name: string;
}

export interface Opportunity extends FortunePoolItem {
  bonus: number;
  summary: string;
  asset: string;
}

export const FORTUNE_POOL: readonly FortunePoolItem[] = [
  {category: '秘境', name: '神秘古井'},
  {category: '秘境', name: '灵龟秘境'},
  {category: '奇遇', name: '锦鲤跃龙门'},
  {category: '奇遇', name: '月下灵泉'},
  {category: '祥瑞', name: '祥云福地'},
  {category: '祥瑞', name: '金鳞洞天'},
];

export const FORTUNE_BAG_ASSETS: Record<string, string> = {
  秘境: 'https://xcx.ukb88.com/assets/battle/fortune-fangchan.png',
  奇遇: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
  祥瑞: 'https://xcx.ukb88.com/assets/battle/fortune-gupiao.png',
};

export function getFortuneBagAsset(category?: string | null): string {
  return (category ? FORTUNE_BAG_ASSETS[category] : '') || FORTUNE_BAG_ASSETS['秘境'];
}

export function buildOpportunity(_selfScore?: number, random: RandomSource = Math.random): Opportunity {
  const item = randomPick(FORTUNE_POOL, random) || {category: '秘境', name: '随机机缘'};
  return {
    ...item,
    bonus: 60,
    summary: '领取即可获得固定积分加成，不涉及投入或随机盈亏。',
    asset: getFortuneBagAsset(item.category),
  };
}

export {randomInt, randomPick};
