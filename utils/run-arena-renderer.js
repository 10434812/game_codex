// Generated from minigame/src/render/run-arena-renderer.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFieldRect = runFieldRect;
exports.fieldPoint = fieldPoint;
exports.renderRunArena = renderRunArena;
const RunArena_1 = require("./run-arena");
const arena_effects_1 = require("./arena-effects");
function runFieldRect(width, height, top = 150) {
    return { x: 24, y: top, width: width - 48, height: Math.max(240, height - top - 110) };
}
function fieldPoint(x, y, rect) {
    return { x: (x - rect.x) * RunArena_1.FIELD.width / rect.width, y: (y - rect.y) * RunArena_1.FIELD.height / rect.height };
}
function renderRunArena(ctx, world, players, rect, appearance = {}) {
    const sx = rect.width / RunArena_1.FIELD.width, sy = rect.height / RunArena_1.FIELD.height;
    const px = (x) => rect.x + x * sx, py = (y) => rect.y + y * sy;
    const unit = Math.min(sx, sy);
    const circle = (x, y, radius, fill, stroke = '') => {
        ctx.beginPath();
        ctx.arc(px(x), py(y), radius * unit, 0, Math.PI * 2);
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 3 * unit;
            ctx.stroke();
        }
    };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
    ctx.lineTo(rect.x, rect.y + rect.height);
    ctx.closePath();
    ctx.clip();
    const self = players.find((p) => p.isSelf);
    const selfRunner = world.runners.find((r) => r.id === self?.id);
    for (const r of world.runners) {
        const mate = world.runners.find((m) => m.id === r.mateId);
        if (mate && r.id < mate.id) {
            ctx.strokeStyle = r.boosted ? '#cc781b' : '#b49357';
            ctx.lineWidth = r.boosted ? 5 : 3;
            ctx.beginPath();
            ctx.moveTo(px(r.x), py(r.y));
            const sag = Math.min(65, Math.hypot(r.x - mate.x, r.y - mate.y) * .1);
            ctx.quadraticCurveTo(px((r.x + mate.x) / 2), py((r.y + mate.y) / 2 + sag), px(mate.x), py(mate.y));
            ctx.stroke();
        }
    }
    for (const drop of world.drops) {
        const warning = world.elapsedMs < drop.warningUntil;
        const meta = (0, arena_effects_1.dropMeta)(drop.kind), color = meta.color;
        if (warning) {
            ctx.globalAlpha = .55 + .3 * Math.sin(world.elapsedMs / 100);
            ctx.fillStyle = color;
            ctx.fillRect(px(drop.x) - 3, rect.y, 6, 32);
            ctx.font = `bold ${Math.max(12, 24 * unit)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${meta.glyph} ↓`, px(drop.x), rect.y + 36);
            ctx.globalAlpha = 1;
            continue;
        }
        const dropAsset = (drop.kind === 'bag' ? appearance.bagImage : drop.kind === 'gift' ? appearance.giftImage : '') || arena_effects_1.ARENA_DROP_ASSETS[drop.kind];
        if (drop.kind === 'shield' || drop.kind === 'magnet')
            circle(drop.x, drop.y, 36, '', '#f3c65c');
        const dropImage = appearance.images?.[dropAsset];
        if (dropImage) {
            ctx.drawImage(dropImage, px(drop.x) - 45 * unit, py(drop.y) - 45 * unit, 90 * unit, 90 * unit);
            continue;
        }
        circle(drop.x, drop.y, 27, color);
        ctx.fillStyle = '#fff7df';
        ctx.font = `bold ${30 * unit}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(meta.glyph, px(drop.x), py(drop.y));
        if (drop.kind === 'bomb') {
            ctx.strokeStyle = '#a94a22';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px(drop.x + 8), py(drop.y - 25));
            ctx.lineTo(px(drop.x + 22), py(drop.y - 43));
            ctx.stroke();
        }
    }
    // 绘制在人物下方，火光和金光不会盖住玩家及名牌。
    for (const effect of world.effects) {
        const progress = (world.elapsedMs - effect.at) / 1100;
        if (progress < 0 || progress >= 1)
            continue;
        ctx.globalAlpha = 1 - progress;
        if (effect.type === 'team') {
            circle(effect.x, effect.y, 45 + progress * 150, '', '#d38619');
            for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6, d = 55 + progress * 160;
                circle(effect.x + Math.cos(a) * d, effect.y + Math.sin(a) * d, 6 * (1 - progress), '#cb7416');
            }
        }
        else {
            const effectFrame = (0, arena_effects_1.pickupEffect)(effect.kind, world.elapsedMs - effect.at);
            const sprite = effectFrame && appearance.images?.[effectFrame.asset];
            if (sprite && effectFrame) {
                const cellWidth = sprite.width / 4, cellHeight = sprite.height / 2, size = effectFrame.size * unit;
                ctx.globalAlpha = effectFrame.opacity;
                ctx.drawImage(sprite, effectFrame.column * cellWidth, effectFrame.row * cellHeight, cellWidth, cellHeight, px(effect.x) - size / 2, py(effect.y) - size / 2, size, size);
            }
            else if (effectFrame) {
                // 图集解码前保留即时反馈，积分提示始终由真实碰撞事件驱动。
                const bomb = effect.kind === 'bomb', color = bomb ? '#c34424' : '#b87816';
                circle(effect.x, effect.y, 38 + progress * (bomb ? 125 : 90), '', color);
                if (bomb) {
                    circle(effect.x, effect.y, (1 - progress) * 62, '#ef8b28');
                    circle(effect.x, effect.y, (1 - progress) * 30, '#fff0b5');
                }
                for (let i = 0; i < 12; i++) {
                    const angle = i * Math.PI / 6, distance = 38 + progress * (bomb ? 155 : 105);
                    circle(effect.x + Math.cos(angle) * distance, effect.y + Math.sin(angle) * distance, (bomb ? 9 : 6) * (1 - progress), i % 2 ? color : '#f3c65c');
                }
            }
        }
    }
    ctx.globalAlpha = 1;
    for (const r of world.runners) {
        const p = players.find((item) => item.id === r.id);
        if (!p)
            continue;
        const incoming = selfRunner && r.targetId === selfRunner.id;
        const selected = selfRunner?.targetId === r.id;
        if (incoming || selected)
            circle(r.x, r.y, 47, '', incoming ? '#317966' : '#ad5e16');
        if (r.boosted)
            circle(r.x, r.y, 42, '#edd09a');
        if ((r.magnetUntil || 0) > world.elapsedMs)
            circle(r.x, r.y, RunArena_1.FIELD.magnetRange, '', '#8a4a9c55');
        if (r.shield)
            circle(r.x, r.y, 46, '', '#2f6f9a');
        circle(r.x, r.y + 7, RunArena_1.FIELD.radius + 1, '#d2bd94');
        circle(r.x, r.y, RunArena_1.FIELD.radius, p.isSelf ? '#ab4e16' : r.mateId ? '#317966' : '#725538', '#fff9e9');
        ctx.fillStyle = '#fff9e9';
        ctx.font = `bold ${29 * unit}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.isSelf ? '我' : p.name.slice(0, 1), px(r.x), py(r.y));
        const avatar = appearance.images?.[(p.isSelf && appearance.skinImage ? appearance.skinImage : p.avatar) || ''];
        if (avatar) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(px(r.x), py(r.y), (RunArena_1.FIELD.radius - 3) * unit, 0, Math.PI * 2);
            ctx.clip();
            const d = (RunArena_1.FIELD.radius - 3) * unit;
            ctx.drawImage(avatar, px(r.x) - d, py(r.y) - d, d * 2, d * 2);
            ctx.restore();
        }
        const ring = p.isSelf && appearance.images?.[appearance.ringImage || ''];
        if (ring)
            ctx.drawImage(ring, px(r.x) - 48 * unit, py(r.y) - 48 * unit, 96 * unit, 96 * unit);
        const pet = p.isSelf && appearance.images?.[appearance.petImage || ''];
        if (pet)
            ctx.drawImage(pet, px(r.x) + 32 * unit, py(r.y) + 10 * unit, 44 * unit, 44 * unit);
        if (incoming || selected || r.boosted) {
            ctx.fillStyle = incoming ? '#245d4f' : '#81430d';
            ctx.font = `${21 * unit}px sans-serif`;
            ctx.fillText(incoming ? '点我同意' : selected ? '等待同意 · 追上碰面' : '并肩加速', px(r.x), py(r.y - 60));
        }
    }
    // 名牌与聊天在所有头像之后绘制，交错跑动时仍清晰可读。
    const labels = [];
    const labelOrder = [...world.runners].sort((a, b) => Number(b.id === self?.id) - Number(a.id === self?.id));
    for (const r of labelOrder) {
        const p = players.find((p) => p.id === r.id);
        if (!p)
            continue;
        const labelFont = Math.max(12, 32 * unit);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${labelFont}px sans-serif`;
        ctx.fillStyle = '#51361e';
        const name = `${p.name.slice(0, 5)}${p.isRobot ? '·机器人' : ''} · ${p.score}`, w = ctx.measureText(name).width + 8, h = labelFont + 6;
        const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        const candidates = [57, -62, 100, -105, 145, -150].flatMap((dy) => [0, 110, -110, 200, -200].map((dx) => ({
            x: Math.max(rect.x + 4, Math.min(rect.x + rect.width - w - 4, px(r.x + dx) - w / 2)),
            y: Math.max(rect.y + 4, Math.min(rect.y + rect.height - h - 4, py(r.y + dy) - h / 2)), width: w, height: h,
        })));
        const cost = (label) => labels.filter((l) => overlap(l, label)).length * 10000 + world.runners.filter((body) => overlap(label, { x: px(body.x) - 37 * unit, y: py(body.y) - 37 * unit, width: 74 * unit, height: 74 * unit })).length * 3000 + Math.hypot(label.x + w / 2 - px(r.x), label.y + h / 2 - py(r.y + 57));
        let label = candidates[0];
        let bestCost = cost(label);
        for (let i = 1; i < candidates.length; i++) {
            const candidate = candidates[i];
            const candidateCost = cost(candidate);
            if (candidateCost < bestCost) {
                label = candidate;
                bestCost = candidateCost;
            }
        }
        labels.push(label);
        if (Math.hypot(label.x + w / 2 - px(r.x), label.y - py(r.y)) > 85 * unit) {
            ctx.strokeStyle = '#b49a6c';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px(r.x), py(r.y));
            ctx.lineTo(label.x + w / 2, label.y + h / 2);
            ctx.stroke();
        }
        ctx.fillStyle = appearance.paper || '#f6ebd1';
        ctx.fillRect(label.x, label.y, w, h);
        ctx.fillStyle = '#51361e';
        ctx.fillText(name, label.x + w / 2, label.y + h / 2);
        const emote = appearance.emotes?.[r.id];
        if (emote) {
            ctx.font = `bold ${24 * unit}px sans-serif`;
            ctx.fillStyle = '#245d4f';
            ctx.fillText(emote, px(r.x), py(r.y - 82));
        }
    }
    for (const effect of world.effects) {
        const progress = (world.elapsedMs - effect.at) / 1100;
        if (progress < 0 || progress >= 1)
            continue;
        ctx.globalAlpha = Math.min(1, (1 - progress) * 3);
        ctx.font = `bold ${32 * unit}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = effect.delta < 0 ? '#a42f27' : '#27725d';
        const linked = effect.appliedLinkedDelta ?? effect.linkedDelta;
        const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
        const text = effect.type === 'team' ? '组队成功' : `${(0, arena_effects_1.pickupText)(effect)}${effect.teammateId && linked ? ` / 队友${signed(linked)}` : ''}`;
        const textWidth = ctx.measureText(text).width + 18 * unit;
        const textX = Math.max(rect.x + textWidth / 2 + 4, Math.min(rect.x + rect.width - textWidth / 2 - 4, px(effect.x)));
        const above = py(effect.y - 155 - progress * 65);
        const textY = above >= rect.y + 24 * unit ? above : Math.min(rect.y + rect.height - 24 * unit, py(effect.y + 100 - progress * 25));
        ctx.fillStyle = '#fff7e6';
        ctx.fillRect(textX - textWidth / 2, textY - 22 * unit, textWidth, 44 * unit);
        ctx.fillStyle = effect.delta < 0 ? '#a42f27' : '#27725d';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, textX, textY);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}
