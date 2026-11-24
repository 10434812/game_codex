export interface GrowthGoal {id: string; title: string; text: string; ready: boolean; reward: number; actionLabel: string}
export function selectGrowthGoal(value: unknown): GrowthGoal | null {
  const milestones = (value as {milestones?: unknown})?.milestones;
  if (!Array.isArray(milestones)) return null;
  const valid = milestones.filter((m): m is {id: string; title: string; target: number; progress: number; reward: number; claimed: boolean} =>
    !!m && typeof m.id === 'string' && typeof m.title === 'string' && m.title.length > 0 && m.title.length <= 128
    && m.claimed === false && [m.target, m.progress, m.reward].every((n) => Number.isSafeInteger(n) && n >= 0)
    && m.target > 0 && m.progress <= m.target && m.reward > 0);
  valid.sort((a, b) => Number(b.progress === b.target) - Number(a.progress === a.target) || b.progress / b.target - a.progress / a.target);
  const goal = valid[0]; if (!goal) return null;
  const ready = goal.progress === goal.target, remaining = goal.target - goal.progress;
  const next = ['first_game', 'ten_games'].includes(goal.id) ? `再完成 ${remaining} 局`
    : goal.id === 'first_win' ? `再赢 ${remaining} 局` : goal.id === 'thousand_exp' ? `再获得 ${remaining} 经验` : `${goal.title} ${goal.progress}/${goal.target}`;
  return {id: goal.id, title: goal.title, ready, reward: goal.reward,
    text: ready ? `已完成「${goal.title}」，可领取 ${goal.reward} 锦鲤币` : `${next}可领取 ${goal.reward} 锦鲤币`,
    actionLabel: ready ? '领取成长奖励' : '查看成长目标'};
}
