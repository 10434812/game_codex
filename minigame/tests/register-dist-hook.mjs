/**
 * 让 Node 能运行 tsc 产出的 dist（补 .js 扩展名），
 * 用于验证真正要上传的构建产物，而不是源码。
 */

import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier + '.js', context);
      } catch {
        // 补扩展名失败时保持原样，让真实解析错误照常抛出
      }
    }
    return nextResolve(specifier, context);
  },
});
