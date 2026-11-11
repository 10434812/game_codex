// Generated from minigame/src/render/arena-effects.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARENA_DROP_ASSETS = exports.ARENA_EFFECT_ASSETS = void 0;
exports.pickupEffect = pickupEffect;
/** 两端共用的拾取特效图集与时间轴；小程序版本由 codegen 生成。 */
exports.ARENA_EFFECT_ASSETS = {
    bomb: '/assets-pkg/effects/mine-hit-v2.png',
    reward: '/assets-pkg/effects/fortune-pickup-v2.png',
};
exports.ARENA_DROP_ASSETS = {
    bomb: '/assets-pkg/items/mine-v2.png',
    bag: '/assets-pkg/items/fortune-bag-v2.png',
    gift: '/assets-pkg/items/gift-box-v2.png',
};
function pickupEffect(kind, age) {
    const bomb = kind === 'bomb', duration = bomb ? 800 : 1000;
    if (!['bomb', 'bag', 'gift'].includes(kind || '') || age < 0 || age >= duration)
        return null;
    const starts = bomb ? [0, 50, 110, 180, 280, 400, 540, 680] : [0, 80, 160, 260, 380, 500, 650, 820];
    const frame = starts.filter((start) => age >= start).length - 1;
    const column = frame % 4, row = Math.floor(frame / 4);
    return { asset: bomb ? exports.ARENA_EFFECT_ASSETS.bomb : exports.ARENA_EFFECT_ASSETS.reward,
        frame, column, row, offsetX: -column * 25, offsetY: -row * 50,
        size: bomb ? 300 : kind === 'gift' ? 340 : 260,
        opacity: Math.min(1, (duration - age) / 180) };
}
