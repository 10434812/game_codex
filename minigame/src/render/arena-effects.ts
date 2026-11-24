/** 两端共用的拾取特效图集与时间轴；小程序版本由 codegen 生成。 */
export const ARENA_EFFECT_ASSETS = {
  bomb: '/assets-pkg/effects/mine-hit-v2.png',
  reward: '/assets-pkg/effects/fortune-pickup-v2.png',
};

export const ARENA_DROP_ASSETS = {
  bomb: '/assets-pkg/items/mine-v2.png',
  bag: '/assets-pkg/items/fortune-bag-v2.png',
  gift: '/assets-pkg/items/gift-box-v2.png',
  shield: '',
  magnet: '',
};

/** 掉落物的单字标记、颜色与数值标签；两端共用，避免各自维护一份。 */
export const ARENA_DROP_META: Record<string, {glyph: string; color: string; label: string; name: string}> = {
  bomb: {glyph: '雷', color: '#693d33', label: '−10', name: '踩雷'},
  bag: {glyph: '福', color: '#b83f2c', label: '+10', name: '福袋'},
  gift: {glyph: '礼', color: '#317966', label: '+20', name: '礼物'},
  shield: {glyph: '盾', color: '#2f6f9a', label: '护盾', name: '护盾'},
  magnet: {glyph: '磁', color: '#8a4a9c', label: '磁铁', name: '磁铁'},
};
export function dropMeta(kind: string | undefined) {return ARENA_DROP_META[kind || ''] || ARENA_DROP_META.bag;}

/** 拾取飘字：连击、冲刺翻倍、护盾挡雷都在这里统一成文案。 */
export function pickupText(effect: {kind?: string; delta: number; appliedDelta?: number; combo?: number; sprint?: boolean; blocked?: boolean}, prefix?: string): string {
  const delta = effect.appliedDelta ?? effect.delta;
  const signed = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}`;
  if (effect.blocked) return '护盾挡雷';
  if (effect.kind === 'shield') return '获得护盾';
  if (effect.kind === 'magnet') return '磁铁生效';
  return `${prefix || dropMeta(effect.kind).name} ${signed}${effect.sprint ? ' 翻倍' : ''}${(effect.combo || 0) > 1 ? ` · ${effect.combo}连` : ''}`;
}

export function pickupEffect(kind: string | undefined, age: number) {
  const bomb = kind === 'bomb', duration = bomb ? 800 : 1000;
  if (!['bomb', 'bag', 'gift', 'shield', 'magnet'].includes(kind || '') || age < 0 || age >= duration) return null;
  const starts = bomb ? [0, 50, 110, 180, 280, 400, 540, 680] : [0, 80, 160, 260, 380, 500, 650, 820];
  const frame = starts.filter((start) => age >= start).length - 1;
  const column = frame % 4, row = Math.floor(frame / 4);
  return {asset: bomb ? ARENA_EFFECT_ASSETS.bomb : ARENA_EFFECT_ASSETS.reward,
    frame, column, row, offsetX: -column * 25, offsetY: -row * 50,
    size: bomb ? 300 : kind === 'gift' ? 340 : 260,
    opacity: Math.min(1, (duration - age) / 180)};
}
