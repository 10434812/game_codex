import * as api from './ApiClient';
import {parseRetention, type RetentionSummary} from './Retention';
import * as runtime from './RuntimeConfig';

export interface DailyTask {id: string; title: string; target: number; progress: number; reward: number; claimed: boolean}
export interface DailyTasks {date: string; tasks: DailyTask[]; retention?: RetentionSummary}

export async function fetchDailyTasks(): Promise<DailyTasks> {
  const value = await api.get('/tasks', runtime.isApiSupported('retention') ? {includeRetention: 1} : null);
  if (!value || typeof value !== 'object' || !('date' in value) || typeof value.date !== 'string' || !('tasks' in value) || !Array.isArray(value.tasks)) throw new Error('每日任务数据异常，请重试');
  const tasks: DailyTask[] = [];
  for (const item of value.tasks) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.claimed !== 'boolean' || ![item.target, item.progress, item.reward].every((n) => Number.isSafeInteger(n) && n >= 0) || item.target < 1 || item.progress > item.target) throw new Error('每日任务数据异常，请重试');
    tasks.push({id: item.id, title: item.title, target: item.target, progress: item.progress, reward: item.reward, claimed: item.claimed});
  }
  return {date: value.date, tasks, ...('retention' in value && value.retention ? {retention: parseRetention(value.retention)} : {})};
}
