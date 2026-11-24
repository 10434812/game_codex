import type {RunWorld} from './RunArena';
import {SelfMotion} from './ArenaMotion';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Presentation only: never mutate authoritative scores, collisions or snapshots. */
export class SnapshotInterpolator {
  private previous: RunWorld | null = null;
  private current: RunWorld | null = null;
  private arrival = 0;
  private interval = 100;
  private selfMotion = new SelfMotion();
  private selfFrame: RunWorld | null = null;
  reset(): void {this.previous = null; this.current = null; this.selfFrame = null; this.selfMotion = new SelfMotion();}
  push(world: RunWorld, now = Date.now(), selfId = ''): void {
    if (this.current && world.elapsedMs <= this.current.elapsedMs) return;
    this.previous = this.current;
    if (this.current) this.interval = clamp(now - this.arrival, 50, 250);
    this.current = world; this.arrival = now;
    this.syncSelf(selfId);
  }
  private syncSelf(selfId: string): void {
    if (!selfId || !this.current || this.selfFrame === this.current) return;
    const runner = this.current.runners.find((item) => item.id === selfId);
    if (!runner) return;
    this.selfMotion.push(runner, this.arrival);
    this.selfFrame = this.current;
  }
  input(dx: number, dy: number, now = Date.now()): void {
    this.selfMotion.input(dx, dy, now);
  }
  sample(selfId = '', now = Date.now()): RunWorld | null {
    const current = this.current; if (!current) return null;
    this.syncSelf(selfId);
    const age = Math.max(0, now - this.arrival), stale = age > 500;
    const ratio = stale ? 1 : clamp(age / this.interval, 0, 1);
    const oldRunners = new Map(this.previous?.runners.map((r) => [r.id, r]));
    const oldDrops = new Map(this.previous?.drops.map((d) => [d.id, d]));
    const position = <T extends {x: number; y: number}>(item: T, previous?: T): T => previous ? {...item, x: previous.x + (item.x - previous.x) * ratio, y: previous.y + (item.y - previous.y) * ratio} : {...item};
    return {...current, runners: current.runners.map((runner) => {
      if (runner.id !== selfId) return position(runner, oldRunners.get(runner.id));
      return {...runner, ...this.selfMotion.sample(now)};
    }), drops: current.drops.map((drop) => position(drop, oldDrops.get(drop.id)))};
  }
}
