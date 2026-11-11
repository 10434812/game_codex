/**
 * 小游戏运行时提供、但 TypeScript 标准库不含的全局声明。
 * 只声明本项目实际使用的部分，避免引入 DOM lib（小游戏没有 DOM）。
 *
 * 本文件必须保持为「全局脚本」——不能出现顶层 import/export，
 * 否则所有 declare 都会变成模块局部声明而失效；因此 wx 的类型引用
 * 只能使用 import('./wx') 的内联形式。
 */

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(handle: number): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(handle: number): void;
declare function requestAnimationFrame(callback: (time: number) => void): number;
declare function cancelAnimationFrame(handle: number): void;

declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

/**
 * 小游戏运行时注入的全局对象；Node 侧测试不注入时为 undefined。
 * 用 typeof 判断即可安全读取，不需要对 globalThis 做类型断言。
 */
declare var wx: import('./wx').WxApi | undefined;
