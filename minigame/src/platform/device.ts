/**
 * 屏幕与安全区。设计坐标系宽度固定 720（与小程序端棋盘坐标一致），
 * 高度按实际屏幕比例换算，顶部避让状态栏与胶囊。
 */

import type {WxSystemInfo} from './wx';

export const DESIGN_WIDTH = 720;

/** 顶部按钮区高度（设计单位），保证内容不被状态栏/胶囊遮挡。 */
export const HEADER_HEIGHT = 96;

export interface Viewport {
  /** 逻辑宽（设计单位） */
  designWidth: number;
  /** 逻辑高（设计单位） */
  designHeight: number;
  /** 物理像素 → 设计单位的缩放系数 */
  scale: number;
  pixelRatio: number;
  safeTop: number;
  safeBottom: number;
}

export function resolveViewport(info: WxSystemInfo, capsule?: {bottom: number}): Viewport {
  const width = Number(info.windowWidth) || Number(info.screenWidth) || 375;
  const height = Number(info.windowHeight) || Number(info.screenHeight) || 667;
  const scale = width / DESIGN_WIDTH;
  const statusBarHeight = Number(info.statusBarHeight) || 0;
  const capsuleBottom = info.safeArea ? Number(info.safeArea.top) || 0 : 0;
  return {
    designWidth: DESIGN_WIDTH,
    designHeight: Math.round(height / scale),
    scale,
    pixelRatio: Number(info.pixelRatio) || 1,
    safeTop: Math.max(statusBarHeight, capsuleBottom, capsule?.bottom || 0) / scale + 20,
    safeBottom: Math.max(0, height - (info.safeArea?.bottom || height)) / scale + 20,
  };
}
