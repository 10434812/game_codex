// Generated from minigame/src/core/RunArena.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD = void 0;
exports.linkedScore = linkedScore;
exports.runPerformanceMap = runPerformanceMap;
exports.createRunWorld = createRunWorld;
exports.restoreRunWorld = restoreRunWorld;
exports.setRunInput = setRunInput;
exports.selectRunTarget = selectRunTarget;
exports.runTeams = runTeams;
exports.advanceRunArena = advanceRunArena;
/** 实时对局规则源。scripts/generate-run-arena.mjs 生成小程序与服务端 CommonJS。 */
exports.FIELD = { width: 1000, height: 1200, radius: 34, speed: 260, boost: 1.18, boostDistance: 210, contactDistance: 80, inputLifetime: 800, warningMs: 700,
    firstDropDelayMs: 3000, dropIntervalMs: 5000, maxDrops: 10 };
const bound = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function linkedScore(delta) { return Math.sign(delta) * Math.floor(Math.abs(delta) / 2); }
const emptyStats = (complete) => ({ bags: 0, gifts: 0, bombs: 0, contributed: 0, received: 0, causedLoss: 0, complete });
function runPerformanceMap(world) {
    return Object.fromEntries((world?.runners || []).filter((r) => r.stats).map((r) => [r.id, { ...r.stats }]));
}
function createRunWorld(players) {
    const columns = players.length <= 4 ? 2 : 3, rows = Math.ceil(players.length / columns);
    return { version: 1, elapsedMs: 0, nextDropAt: exports.FIELD.firstDropDelayMs, sequence: 0, eventSequence: 0, drops: [], effects: [],
        runners: players.map((p, i) => ({ id: p.id, x: 170 + (i % columns) * 660 / (columns - 1), y: rows <= 1 ? 600 : 260 + Math.floor(i / columns) * 680 / (rows - 1),
            dx: 0, dy: 0, inputUntil: 0, targetId: '', mateId: '', boosted: false, botUntil: 0, stats: emptyStats(true) })) };
}
/** 恢复方向归零；历史固定棋盘存档迁移为可继续跑动的场地。 */
function restoreRunWorld(saved, players, teams, elapsedMs) {
    const fallback = createRunWorld(players);
    fallback.elapsedMs = Math.max(0, elapsedMs);
    fallback.nextDropAt = fallback.elapsedMs + exports.FIELD.firstDropDelayMs;
    if (fallback.elapsedMs > 0)
        fallback.runners.forEach((r) => { r.stats.complete = false; });
    if (saved?.version === 1 && Array.isArray(saved.runners) && Array.isArray(saved.drops)
        && saved.runners.length === players.length && players.every((p) => saved.runners.filter((r) => r.id === p.id && Number.isFinite(r.x) && Number.isFinite(r.y)).length === 1)
        && Number.isFinite(saved.elapsedMs) && saved.elapsedMs >= 0 && Number.isFinite(saved.nextDropAt)
        && Number.isSafeInteger(saved.sequence) && Number.isSafeInteger(saved.eventSequence)) {
        return { ...saved, effects: [], drops: saved.drops.filter((d) => ['bag', 'gift', 'bomb'].includes(d.kind) && [d.x, d.y, d.speed, d.warningUntil, d.value].every(Number.isFinite)),
            runners: saved.runners.map((r) => ({ ...r, stats: r.stats ? { ...r.stats } : emptyStats(false), dx: 0, dy: 0, inputUntil: 0, botUntil: 0, boosted: false })) };
    }
    for (const team of teams) {
        if (team.memberIds.length !== 2)
            continue;
        const a = fallback.runners.find((r) => r.id === team.memberIds[0]), b = fallback.runners.find((r) => r.id === team.memberIds[1]);
        if (a && b && a !== b && !a.mateId && !b.mateId) {
            a.mateId = b.id;
            b.mateId = a.id;
        }
    }
    return fallback;
}
/** 输入只包含方向。位置、速度、碰撞与积分由规则层推进。 */
function setRunInput(world, id, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy))
        return false;
    const runner = world.runners.find((r) => r.id === id);
    if (!runner)
        return false;
    const length = Math.hypot(dx, dy);
    runner.dx = length > 1 ? dx / length : dx;
    runner.dy = length > 1 ? dy / length : dy;
    runner.inputUntil = world.elapsedMs + exports.FIELD.inputLifetime;
    return true;
}
/** 单方点选表达邀请；双向点选且接触时成队。退出时双方同步恢复独立。 */
function selectRunTarget(world, id, targetId) {
    const self = world.runners.find((r) => r.id === id);
    if (!self)
        return false;
    if (targetId === null) {
        const mate = world.runners.find((r) => r.id === self.mateId);
        if (mate) {
            mate.mateId = '';
            mate.targetId = '';
            mate.boosted = false;
        }
        self.mateId = '';
        self.targetId = '';
        self.boosted = false;
        world.runners.forEach((r) => { if (r.targetId === id)
            r.targetId = ''; });
        return true;
    }
    const target = world.runners.find((r) => r.id === targetId);
    if (!target || target.id === id || self.mateId || target.mateId)
        return false;
    self.targetId = self.targetId === targetId ? '' : targetId;
    return true;
}
function runTeams(world) {
    return world.runners.filter((r) => r.mateId && r.id < r.mateId)
        .map((r) => ({ id: `run-${r.id}-${r.mateId}`, memberIds: [r.id, r.mateId] }));
}
function botInput(world, runner, random) {
    if (runner.botUntil > world.elapsedMs)
        return;
    runner.botUntil = world.elapsedMs + 350 + random() * 300;
    const invitation = world.runners.find((r) => r.targetId === runner.id && !r.mateId);
    if (invitation && !runner.mateId)
        runner.targetId = invitation.id;
    const target = world.runners.find((r) => r.id === runner.targetId && r.targetId === runner.id);
    const danger = world.drops.find((d) => d.kind === 'bomb' && distance(d, runner) < 145 && d.warningUntil <= world.elapsedMs);
    const reward = world.drops.filter((d) => d.kind !== 'bomb' && d.y > 0)
        .sort((a, b) => distance(a, runner) - distance(b, runner))[0];
    const dx = danger ? runner.x - danger.x : target ? target.x - runner.x : reward ? reward.x - runner.x : 0;
    const dy = danger ? runner.y - danger.y : target ? target.y - runner.y : reward ? reward.y - runner.y : 0;
    setRunInput(world, runner.id, dx, dy);
}
function frame(world, players, dt, random, events) {
    world.elapsedMs += dt;
    world.effects = world.effects.filter((e) => world.elapsedMs - e.at < 1100);
    if (world.elapsedMs >= world.nextDropAt) {
        if (world.drops.length < exports.FIELD.maxDrops) {
            const roll = random();
            const kind = roll < 0.24 ? 'bomb' : roll < 0.64 ? 'bag' : 'gift';
            world.drops.push({ id: `drop-${++world.sequence}`, kind, x: 60 + random() * (exports.FIELD.width - 120), y: -28,
                value: kind === 'bomb' ? -10 : kind === 'bag' ? 10 : 20, speed: 210 + random() * 90, warningUntil: world.elapsedMs + exports.FIELD.warningMs });
        }
        world.nextDropAt = world.elapsedMs + exports.FIELD.dropIntervalMs;
    }
    for (const r of world.runners) {
        const player = players.find((p) => p.id === r.id);
        if (player?.isRobot)
            botInput(world, r, random);
        const mate = world.runners.find((m) => m.id === r.mateId);
        r.boosted = !!mate && distance(r, mate) <= exports.FIELD.boostDistance;
        if (r.inputUntil <= world.elapsedMs) {
            r.dx = 0;
            r.dy = 0;
        }
        const step = exports.FIELD.speed * (r.boosted ? exports.FIELD.boost : 1) * dt / 1000;
        r.x = bound(r.x + r.dx * step, exports.FIELD.radius, exports.FIELD.width - exports.FIELD.radius);
        r.y = bound(r.y + r.dy * step, exports.FIELD.radius, exports.FIELD.height - exports.FIELD.radius);
    }
    for (const r of world.runners) {
        const target = world.runners.find((m) => m.id === r.targetId);
        if (r.mateId || !target || target.mateId || target.targetId !== r.id || distance(r, target) > exports.FIELD.contactDistance)
            continue;
        r.mateId = target.id;
        target.mateId = r.id;
        r.targetId = '';
        target.targetId = '';
        const event = { id: ++world.eventSequence, type: 'team', actorId: r.id, teammateId: target.id, delta: 0, linkedDelta: 0,
            x: (r.x + target.x) / 2, y: (r.y + target.y) / 2, at: world.elapsedMs };
        world.effects.push(event);
        events.push(event);
    }
    world.drops = world.drops.filter((drop) => {
        if (world.elapsedMs < drop.warningUntil)
            return true;
        drop.y += drop.speed * dt / 1000;
        const hit = world.runners.filter((r) => distance(r, drop) <= exports.FIELD.radius + 23)
            .sort((a, b) => distance(a, drop) - distance(b, drop) || a.id.localeCompare(b.id))[0];
        if (!hit)
            return drop.y <= exports.FIELD.height + 40;
        const actor = players.find((p) => p.id === hit.id);
        if (!actor)
            return false;
        const mate = players.find((p) => p.id === hit.mateId);
        const delta = drop.value, beforeScore = actor.score, beforeMateScore = mate?.score || 0;
        actor.score = Math.max(0, actor.score + delta);
        const linkedDelta = mate ? linkedScore(delta) : 0;
        if (mate)
            mate.score = Math.max(0, mate.score + linkedDelta);
        const appliedDelta = actor.score - beforeScore, appliedLinkedDelta = mate ? mate.score - beforeMateScore : 0;
        const stats = hit.stats || (hit.stats = emptyStats(false));
        if (drop.kind === 'bag')
            stats.bags++;
        else if (drop.kind === 'gift')
            stats.gifts++;
        else
            stats.bombs++;
        stats.contributed += Math.max(0, appliedLinkedDelta);
        stats.causedLoss += Math.max(0, -appliedLinkedDelta);
        const mateRunner = world.runners.find((r) => r.id === mate?.id);
        if (mateRunner)
            (mateRunner.stats || (mateRunner.stats = emptyStats(false))).received += Math.max(0, appliedLinkedDelta);
        const event = { id: ++world.eventSequence, type: 'pickup', actorId: hit.id, teammateId: mate?.id || '', delta, linkedDelta,
            appliedDelta, appliedLinkedDelta, x: hit.x, y: hit.y, at: world.elapsedMs, kind: drop.kind };
        world.effects.push(event);
        events.push(event);
        return false;
    });
}
/** 使用固定上限子步，避免长帧穿过掉落物。调用者负责限定本局剩余时间。 */
function advanceRunArena(source, sourcePlayers, deltaMs, random = Math.random) {
    const world = { ...source, runners: source.runners.map((r) => ({ ...r, ...(r.stats ? { stats: { ...r.stats } } : {}) })), drops: source.drops.map((d) => ({ ...d })), effects: [...source.effects] };
    const players = sourcePlayers.map((p) => ({ ...p }));
    const events = [];
    let remaining = Number.isFinite(deltaMs) ? bound(deltaMs, 0, 1000) : 0;
    while (remaining > 0) {
        const dt = Math.min(20, remaining);
        frame(world, players, dt, random, events);
        remaining -= dt;
    }
    const teams = runTeams(world);
    for (const p of players) {
        p.teamId = teams.find((t) => t.memberIds.includes(p.id))?.id || null;
        p.independent = !p.teamId;
    }
    return { world, players, teams, events };
}
