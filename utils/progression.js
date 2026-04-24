function getLevelRequirement(level) {
  const lv = Math.max(1, Number(level) || 1);
  return 120 + (lv - 1) * 40;
}

function buildExpProgress(totalExp) {
  let remaining = Math.max(0, Math.floor(Number(totalExp) || 0));
  let level = 1;
  let required = getLevelRequirement(level);

  while (remaining >= required) {
    remaining -= required;
    level += 1;
    required = getLevelRequirement(level);
  }

  const percent = required > 0 ? Math.max(0, Math.min(100, Math.floor((remaining / required) * 100))) : 0;

  return {
    level,
    current: remaining,
    required,
    left: Math.max(0, required - remaining),
    percent,
  };
}

module.exports = {
  buildExpProgress,
  getLevelRequirement,
};
