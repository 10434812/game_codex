type Props = Record<string, string | number | boolean>;
interface Options {
  track(name: string, props: Props): void;
  owner(): string;
  sameOwner?(previous: string, current: string): boolean;
  now?: () => number;
}
export interface PlayAttempt {
  id: string; owner: string; stageId: number; sourceSessionId: string;
  matching: boolean; startedAt: number; queuedAt: number; roomId: string; done: boolean;
}
// Only explicit requests/cancellations and server-confirmed starts are terminal.
// Hiding a page is recorded separately and does not count as cancelling a match.
export class PlayFlowTracker {
  private readonly options: Options;
  private readonly rooms = new Map<string, PlayAttempt>();
  private sequence = 0;
  constructor(options: Options) {this.options = options;}
  private now(): number {return (this.options.now || Date.now)();}
  private owns(attempt: PlayAttempt): boolean {
    const current = this.options.owner();
    return !!attempt.owner && (attempt.owner === current || !!this.options.sameOwner?.(attempt.owner, current));
  }
  begin(stageId: number, matching = true, sourceSessionId = ''): PlayAttempt {
    const now = this.now();
    const attempt = {id: `${now.toString(36)}_${(++this.sequence).toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
      owner: this.options.owner(), stageId, sourceSessionId, matching, startedAt: now, queuedAt: now, roomId: '', done: false};
    if (sourceSessionId) this.emit('replay_click', attempt);
    if (matching) {this.emit('quick_start', attempt); this.emit('match_request', attempt);}
    return attempt;
  }
  private emit(name: string, attempt: PlayAttempt, props: Props = {}): void {
    if (!this.owns(attempt)) return;
    this.options.track(name, {attemptId: attempt.id, stageId: attempt.stageId,
      source: attempt.sourceSessionId ? 'replay' : 'home',
      ...(attempt.sourceSessionId ? {sourceSessionId: attempt.sourceSessionId} : {}),
      ...(attempt.roomId ? {roomId: attempt.roomId} : {}), ...props});
  }
  queued(attempt: PlayAttempt, roomId: string): void {
    if (attempt.done || !this.owns(attempt) || !roomId) return;
    // Idempotent retries may return the same room. Preserve its original queue clock.
    const previous = this.rooms.get(roomId);
    if (previous && previous.owner === attempt.owner && !previous.done) {
      this.failed(attempt, {statusCode: 409}); return;
    }
    attempt.roomId = roomId; attempt.queuedAt = this.now(); this.rooms.set(roomId, attempt);
    if (attempt.matching) this.emit('match_queue', attempt, {durationMs: Math.max(0, attempt.queuedAt - attempt.startedAt)});
    if (this.rooms.size > 20) this.rooms.delete(this.rooms.keys().next().value as string);
  }
  failed(attempt: PlayAttempt, error: unknown): void {
    if (attempt.done) return;
    const status = Number((error as {statusCode?: number})?.statusCode) || 0;
    const reason = status === 401 ? 'login_expired' : status === 403 ? 'forbidden' : status === 404 || status === 410 ? 'room_unavailable'
      : status === 409 ? 'already_queued' : status === 429 ? 'rate_limited' : status >= 500 ? 'server_error' : 'network_error';
    if (attempt.matching) this.emit('match_failed', attempt, {reason});
    if (attempt.sourceSessionId) this.emit('replay_failed', attempt, {reason});
    attempt.done = true;
  }
  background(roomId: string): void {
    const attempt = this.rooms.get(roomId);
    if (attempt && !attempt.done && attempt.matching) this.emit('match_background', attempt);
  }
  backgroundAll(): void {for (const roomId of this.rooms.keys()) this.background(roomId);}
  cancel(roomId: string, reason = 'user_cancel'): void {
    const attempt = this.rooms.get(roomId);
    if (!attempt || attempt.done) return;
    const waitMs = Math.max(0, this.now() - attempt.queuedAt);
    if (attempt.matching) this.emit('match_cancel', attempt, {reason, waitMs});
    if (attempt.sourceSessionId) this.emit('replay_exit', attempt, {reason});
    attempt.done = true; this.rooms.delete(roomId);
  }
  started(roomId: string, sessionId: string, players: {isRobot?: boolean}[]): void {
    const attempt = this.rooms.get(roomId);
    if (!attempt || attempt.done || !sessionId || !players.length || attempt.sourceSessionId === sessionId) return;
    const botCount = players.filter((player) => player.isRobot === true).length;
    const props = {sessionId, waitMs: Math.max(0, this.now() - attempt.queuedAt), humanCount: players.length - botCount, botCount};
    if (attempt.matching) this.emit('match_started', attempt, props);
    if (attempt.sourceSessionId) this.emit('replay_started', attempt, {sessionId});
    attempt.done = true; this.rooms.delete(roomId);
  }
}
