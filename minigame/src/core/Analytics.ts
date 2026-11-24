import * as privacy from './PrivacyConsent';
import * as api from './ApiClient';
import {getWx} from '../platform/wx';
import {PlayFlowTracker} from './PlayFlow';
interface Event {name: string; ts: number; props?: Record<string, string | number | boolean>; token: string}
interface Options {
  allowed(): boolean;
  token(): string;
  device(): string;
  send(body: unknown, token: string): Promise<boolean>;
}
const safeKeys = new Set(['sessionId', 'roomId', 'stageId', 'rank', 'score', 'itemId', 'taskId', 'source', 'message', 'stack', 'attemptId', 'sourceSessionId', 'reason', 'waitMs', 'durationMs', 'humanCount', 'botCount', 'preloadCount']);
const redact = (value: unknown) => String(value || '').replace(/Bearer\s+\S+/gi, '[redacted]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]').replace(/([?&](?:token|code|openid|session_key|key)=)[^&\s]*/gi, '$1[redacted]').slice(0, 200);
export class AnalyticsQueue {
  private events: Event[] = [];
  private timer: number | null = null;
  private pending: Promise<boolean> | null = null;
  private lastTs = 0;
  private readonly options: Options;
  constructor(options: Options) {this.options = options;}
  track(name: string, props: Record<string, unknown> = {}): void {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) return;
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(props)) {
      if (!safeKeys.has(key)) continue;
      if (typeof value === 'string') clean[key] = redact(value).slice(0, key === 'stack' || key === 'message' ? 150 : 64);
      else if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') clean[key] = value as number | boolean;
    }
    this.lastTs = Math.max(Date.now(), this.lastTs + 1);
    this.events.push({name, ts: this.lastTs, props: clean, token: this.options.allowed() ? this.options.token() : ''});
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    if (this.events.length >= 20) void this.flush(); else this.schedule();
  }
  private schedule(): void {
    if (this.timer !== null || !this.events.length) return;
    this.timer = setTimeout(() => {this.timer = null; void this.flush();}, 10000);
    (this.timer as unknown as {unref?: () => void}).unref?.();
  }
  flush(): Promise<boolean> {
    if (this.pending) return this.pending;
    if (this.timer !== null) clearTimeout(this.timer); this.timer = null;
    if (!this.events.length || !this.options.allowed()) {this.schedule(); return Promise.resolve(false);}
    const token = this.events[0].token, batch: Event[] = [];
    for (const event of this.events) {if (batch.length >= 50 || event.token !== token) break; batch.push(event);}
    this.pending = Promise.resolve().then(() => this.options.send({client: 'minigame', deviceId: this.options.device(), events: batch.map(({token: _token, ...event}) => event)}, token))
      .catch(() => false).then((ok) => {if (ok) {const sent = new Set(batch); this.events = this.events.filter((event) => !sent.has(event));} return ok;})
      .finally(() => {this.pending = null; this.schedule();});
    return this.pending;
  }
  discard(): void {this.events = []; if (this.timer !== null) clearTimeout(this.timer); this.timer = null;}
}
const DEVICE_KEY = 'jinli.analytics.device.v1';
export const analytics = new AnalyticsQueue({
  allowed: privacy.isAllowed, token: api.getToken,
  device() {
    const wx = getWx(); if (!wx) throw new Error('platform_unavailable');
    let id = wx.getStorageSync(DEVICE_KEY);
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      id = `mg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      wx.setStorageSync(DEVICE_KEY, id);
    }
    return id as string;
  },
  send: (body, token) => new Promise((resolve) => {
    const wx = getWx(); if (!wx) {resolve(false); return;}
    wx.request({url: `${api.getBaseUrl()}/events`, method: 'POST', timeout: 8000,
      header: {'content-type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, data: body,
      success: (response) => resolve(response.statusCode >= 200 && response.statusCode < 300 && (response.data as {code?: number})?.code === 0), fail: () => resolve(false)});
  }),
});
export function reportError(error: unknown): void {
  const e = error as {message?: string; stack?: string};
  analytics.track('client_error', {message: e?.message || String(error), stack: e?.stack || ''});
}
export const playFlow = new PlayFlowTracker({track: (name, props) => analytics.track(name, props), owner: api.getToken});
