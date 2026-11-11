// 对稳定成员使用 setData 字段路径；成员增删或排序改变时提交完整数组。
function appendViewPatch(current, next, path, patch) {
  if (current === next) return;
  if (current === null || next === null || typeof current !== 'object' || typeof next !== 'object') {
    patch[path] = next;
    return;
  }
  if (Array.isArray(next)) {
    if (!Array.isArray(current) || current.length !== next.length ||
        next.some((item, i) => item.id !== current[i]?.id)) {
      patch[path] = next;
      return;
    }
    next.forEach((item, i) => appendViewPatch(current[i], item, path + '[' + i + ']', patch));
    return;
  }
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(current).length || keys.some((key) => !Object.prototype.hasOwnProperty.call(current, key))) {
    patch[path] = next;
    return;
  }
  for (const key of keys) appendViewPatch(current[key], next[key], path + '.' + key, patch);
}

function appendArenaViewPatch(current, next, patch = {}) {
  for (const key of Object.keys(next)) appendViewPatch(current[key], next[key], key, patch);
  return patch;
}
module.exports = {appendArenaViewPatch};
