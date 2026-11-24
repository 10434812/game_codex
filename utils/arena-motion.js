// Generated from minigame/src/core/ArenaMotion.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfMotion = void 0;
exports.readDrag = readDrag;
const RunArena_1 = require("./run-arena");
function readDrag(pointer, x, y, width, height, deadZone, radius) {
    const stepX = x - pointer.lastX, stepY = y - pointer.lastY;
    if (pointer.moved && Math.hypot(stepX, stepY) < deadZone / 3)
        return null;
    let dx = x - pointer.x, dy = y - pointer.y;
    // 反向拖动从上一触点重新计量，手指无需退回旧中心。
    if (pointer.moved && stepX * (pointer.lastX - pointer.x) + stepY * (pointer.lastY - pointer.y) < 0) {
        pointer.x = pointer.lastX;
        pointer.y = pointer.lastY;
        dx = stepX;
        dy = stepY;
    }
    const distance = Math.hypot(dx, dy);
    if (!pointer.moved && distance < deadZone)
        return null;
    pointer.moved = true;
    pointer.lastX = x;
    pointer.lastY = y;
    const fieldX = dx * RunArena_1.FIELD.width / width, fieldY = dy * RunArena_1.FIELD.height / height;
    const length = Math.hypot(fieldX, fieldY);
    const strength = Math.min(1, distance / radius);
    if (distance > radius) {
        pointer.x = x - dx * radius / distance;
        pointer.y = y - dy * radius / distance;
    }
    return length ? { dx: fieldX / length * strength, dy: fieldY / length * strength } : { dx: 0, dy: 0 };
}
const MAX_LEAD_MS = 150;
const STALE_MS = 500;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
/** 客户端只预测本人画面位置。碰撞、积分和其余状态取服务端快照。 */
class SelfMotion {
    constructor() {
        this.runner = null;
        this.point = null;
        this.direction = { dx: 0, dy: 0 };
        this.arrival = 0;
        this.lastFrame = 0;
        this.lastInput = 0;
        this.stoppedAt = 0;
    }
    push(runner, now = Date.now()) {
        if (this.runner?.id !== runner.id) {
            this.point = { x: runner.x, y: runner.y };
            this.lastFrame = now;
        }
        this.runner = runner;
        this.arrival = now;
    }
    input(dx, dy, now = Date.now()) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy))
            return;
        if (dx === 0 && dy === 0 && (this.direction.dx || this.direction.dy))
            this.stoppedAt = now;
        if ((dx || dy) && !this.direction.dx && !this.direction.dy)
            this.lastFrame = now;
        const length = Math.max(1, Math.hypot(dx, dy));
        this.direction = { dx: dx / length, dy: dy / length };
        this.lastInput = now;
    }
    sample(now = Date.now()) {
        const runner = this.runner, point = this.point;
        if (!runner || !point)
            return null;
        const delta = clamp(now - this.lastFrame, 0, 32) / 1000;
        this.lastFrame = Math.max(this.lastFrame, now);
        const age = now - this.arrival;
        if (age > STALE_MS) {
            this.point = { x: runner.x, y: runner.y };
            return this.point;
        }
        const { dx, dy } = this.direction;
        const moving = (dx !== 0 || dy !== 0) && now - this.lastInput <= RunArena_1.FIELD.inputLifetime;
        const speed = RunArena_1.FIELD.speed * (runner.boosted ? RunArena_1.FIELD.boost : 1);
        let x = point.x, y = point.y;
        if (moving) {
            x += dx * speed * delta;
            y += dy * speed * delta;
        }
        const errorX = runner.x - x, errorY = runner.y - y;
        const error = Math.hypot(errorX, errorY);
        const waitingForStop = this.stoppedAt > 0 &&
            (now - this.stoppedAt < MAX_LEAD_MS || runner.dx !== 0 || runner.dy !== 0);
        if (moving || !waitingForStop) {
            const limit = moving ? speed * Math.hypot(dx, dy) * delta * 0.5 : speed * delta;
            const closeBy = moving ? Math.max(0, error - speed * MAX_LEAD_MS / 1000) : error;
            const correction = error > 0 ? Math.min(limit, closeBy) / error : 0;
            x += errorX * correction;
            y += errorY * correction;
        }
        // 快照落后时限制预测距离，转向时允许人物向权威位置靠近。
        const lead = Math.hypot(x - runner.x, y - runner.y);
        const maxLead = Math.max(speed * MAX_LEAD_MS / 1000, Math.hypot(point.x - runner.x, point.y - runner.y));
        if (moving && lead > maxLead) {
            const scale = maxLead / lead;
            x = runner.x + (x - runner.x) * scale;
            y = runner.y + (y - runner.y) * scale;
        }
        this.point = { x: clamp(x, RunArena_1.FIELD.radius, RunArena_1.FIELD.width - RunArena_1.FIELD.radius), y: clamp(y, RunArena_1.FIELD.radius, RunArena_1.FIELD.height - RunArena_1.FIELD.radius) };
        return this.point;
    }
}
exports.SelfMotion = SelfMotion;
