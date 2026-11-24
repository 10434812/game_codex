import {installPlatformLifecycle} from './platform/lifecycle';
import {reportError} from './core/Analytics';
import {PrimaryTouch} from './platform/PrimaryTouch';
import {GameApplication} from './GameApplication';
import {resolveViewport} from './platform/device';
import {getWx, type WxTouchEvent} from './platform/wx';

function boot(): void {
  const wxApi = getWx();
  if (!wxApi) return;
  const canvas = wxApi.createCanvas();
  const viewport = resolveViewport(wxApi.getSystemInfoSync(), wxApi.getMenuButtonBoundingClientRect?.());
  const scale = viewport.scale * viewport.pixelRatio;
  canvas.width = Math.round(viewport.designWidth * scale);
  canvas.height = Math.round(viewport.designHeight * scale);
  const context = canvas.getContext('2d');
  const app = new GameApplication(viewport);
  installPlatformLifecycle(() => app.shareData(), () => app.clearImageCaches(), reportError);
  const primary = new PrimaryTouch();
  const point = (touch: ReturnType<PrimaryTouch['start']>) => touch ? {x: touch.clientX / viewport.scale, y: touch.clientY / viewport.scale} : null;
  wxApi.onTouchStart((event: WxTouchEvent) => {const p = point(primary.start(event)); if (p) app.touchStart(p.x, p.y);});
  wxApi.onTouchMove((event: WxTouchEvent) => {const p = point(primary.move(event)); if (p) app.touchMove(p.x, p.y);});
  wxApi.onTouchEnd((event: WxTouchEvent) => {const p = point(primary.end(event)); if (p) app.touchEnd(p.x, p.y);});
  wxApi.onTouchCancel((event: WxTouchEvent) => {if (primary.end(event)) app.cancelTouch();});
  let hidden = false, last = Date.now();
  wxApi.onHide(() => {hidden = true; primary.reset(); app.hide();});
  wxApi.onShow((options) => {hidden = false; last = Date.now(); void app.show(options?.query);});
  void app.initialize();
  const frame = () => {
    const now = Date.now();
    if (!hidden) {
      app.update(Math.min(64, now - last));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      app.render(context);
    }
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
