/**
 * 让 Node 能解析 Cocos/微信风格的无扩展名相对导入（补 .ts）。
 * 仅用于测试：Cocos 的 TS 编译不允许写 .ts 后缀，而 Node ESM 必须带扩展名。
 */

import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(specifier + '.ts', context);
      } catch {
        // 补扩展名失败时保持原样，让真实解析错误照常抛出
      }
    }
    return nextResolve(specifier, context);
  },
});
