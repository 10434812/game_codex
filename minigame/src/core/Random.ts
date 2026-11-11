/**
 * 随机数工具。小程序端在 game-engine / investment / emote 三处各写了一份同样的
 * randomInt，小游戏端只保留这一份，行为完全一致（含默认 Math.random）。
 */

export type RandomSource = () => number;

export interface RandomOptions {
  random?: RandomSource;
}

export function getRandom(options?: RandomOptions | null): RandomSource {
  return options && typeof options.random === 'function' ? options.random : Math.random;
}

export function randomInt(min: number, max: number, random: RandomSource = Math.random): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function randomPick<T>(list: readonly T[] | null | undefined, random: RandomSource = Math.random): T | null {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  return list[randomInt(0, list.length - 1, random)];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function shuffleInPlace<T>(list: T[], random: RandomSource): T[] {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index, random);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
}
