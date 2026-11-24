// Generated from minigame/src/core/PlayFlow.ts
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayFlowTracker = void 0;
// Only explicit requests/cancellations and server-confirmed starts are terminal.
// Hiding a page is recorded separately and does not count as cancelling a match.
class PlayFlowTracker {
    constructor(options) {
        this.rooms = new Map();
        this.sequence = 0;
        this.options = options;
    }
    now() { return (this.options.now || Date.now)(); }
    owns(attempt) {
        const current = this.options.owner();
        return !!attempt.owner && (attempt.owner === current || !!this.options.sameOwner?.(attempt.owner, current));
    }
    begin(stageId, matching = true, sourceSessionId = '') {
        const now = this.now();
        const attempt = { id: `${now.toString(36)}_${(++this.sequence).toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
            owner: this.options.owner(), stageId, sourceSessionId, matching, startedAt: now, queuedAt: now, roomId: '', done: false };
        if (sourceSessionId)
            this.emit('replay_click', attempt);
        if (matching) {
            this.emit('quick_start', attempt);
            this.emit('match_request', attempt);
        }
        return attempt;
    }
    emit(name, attempt, props = {}) {
        if (!this.owns(attempt))
            return;
        this.options.track(name, { attemptId: attempt.id, stageId: attempt.stageId,
            source: attempt.sourceSessionId ? 'replay' : 'home',
            ...(attempt.sourceSessionId ? { sourceSessionId: attempt.sourceSessionId } : {}),
            ...(attempt.roomId ? { roomId: attempt.roomId } : {}), ...props });
    }
    queued(attempt, roomId) {
        if (attempt.done || !this.owns(attempt) || !roomId)
            return;
        // Idempotent retries may return the same room. Preserve its original queue clock.
        const previous = this.rooms.get(roomId);
        if (previous && previous.owner === attempt.owner && !previous.done) {
            this.failed(attempt, { statusCode: 409 });
            return;
        }
        attempt.roomId = roomId;
        attempt.queuedAt = this.now();
        this.rooms.set(roomId, attempt);
        if (attempt.matching)
            this.emit('match_queue', attempt, { durationMs: Math.max(0, attempt.queuedAt - attempt.startedAt) });
        if (this.rooms.size > 20)
            this.rooms.delete(this.rooms.keys().next().value);
    }
    failed(attempt, error) {
        if (attempt.done)
            return;
        const status = Number(error?.statusCode) || 0;
        const reason = status === 401 ? 'login_expired' : status === 403 ? 'forbidden' : status === 404 || status === 410 ? 'room_unavailable'
            : status === 409 ? 'already_queued' : status === 429 ? 'rate_limited' : status >= 500 ? 'server_error' : 'network_error';
        if (attempt.matching)
            this.emit('match_failed', attempt, { reason });
        if (attempt.sourceSessionId)
            this.emit('replay_failed', attempt, { reason });
        attempt.done = true;
    }
    background(roomId) {
        const attempt = this.rooms.get(roomId);
        if (attempt && !attempt.done && attempt.matching)
            this.emit('match_background', attempt);
    }
    backgroundAll() { for (const roomId of this.rooms.keys())
        this.background(roomId); }
    cancel(roomId, reason = 'user_cancel') {
        const attempt = this.rooms.get(roomId);
        if (!attempt || attempt.done)
            return;
        const waitMs = Math.max(0, this.now() - attempt.queuedAt);
        if (attempt.matching)
            this.emit('match_cancel', attempt, { reason, waitMs });
        if (attempt.sourceSessionId)
            this.emit('replay_exit', attempt, { reason });
        attempt.done = true;
        this.rooms.delete(roomId);
    }
    started(roomId, sessionId, players) {
        const attempt = this.rooms.get(roomId);
        if (!attempt || attempt.done || !sessionId || !players.length || attempt.sourceSessionId === sessionId)
            return;
        const botCount = players.filter((player) => player.isRobot === true).length;
        const props = { sessionId, waitMs: Math.max(0, this.now() - attempt.queuedAt), humanCount: players.length - botCount, botCount };
        if (attempt.matching)
            this.emit('match_started', attempt, props);
        if (attempt.sourceSessionId)
            this.emit('replay_started', attempt, { sessionId });
        attempt.done = true;
        this.rooms.delete(roomId);
    }
}
exports.PlayFlowTracker = PlayFlowTracker;
