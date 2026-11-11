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
  const touch = (event: WxTouchEvent) => {
    const point = event.changedTouches?.[0] || event.touches?.[0];
    return point ? {x: point.clientX / viewport.scale, y: point.clientY / viewport.scale} : null;
  };
  wxApi.onTouchStart((event) => {const point = touch(event); if (point) app.touchStart(point.x, point.y);});
  wxApi.onTouchMove((event) => {const point = touch(event); if (point) app.touchMove(point.x, point.y);});
  wxApi.onTouchEnd((event) => {const point = touch(event); if (point) app.touchEnd(point.x, point.y);});
  wxApi.onTouchCancel(() => app.cancelTouch());
  let hidden = false, last = Date.now();
  wxApi.onHide(() => {hidden = true; app.hide();});
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
