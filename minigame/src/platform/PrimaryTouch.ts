import type {WxTouch, WxTouchEvent} from './wx';
/** Secondary fingers never take over movement or end the primary gesture. */
export class PrimaryTouch {
  private identifier: number | null = null;
  start(event: WxTouchEvent): WxTouch | null {
    if (this.identifier !== null) return null;
    const point = event.changedTouches?.[0] || event.touches?.[0];
    if (!point) return null;
    this.identifier = point.identifier ?? 0;
    return point;
  }
  move(event: WxTouchEvent): WxTouch | null {
    if (this.identifier === null) return null;
    return event.changedTouches?.find((point) => (point.identifier ?? 0) === this.identifier) || null;
  }
  end(event: WxTouchEvent): WxTouch | null {
    const point = this.move(event);
    if (point) this.reset();
    return point;
  }
  reset(): void {this.identifier = null;}
}
