import * as api from './ApiClient';
export interface Milestone {id: string; title: string; target: number; progress: number; reward: number; claimed: boolean}
interface PassportStage {id: number; name: string; stamped: boolean}
export interface ScenicPassport {
  stages: PassportStage[]; stampedCount: number; badge: boolean;
  newStamp: PassportStage | null; nextStage: PassportStage | null;
}
export interface RetentionSummary {
  date: string; level: number; totalExp: number; games: number; wins: number;
  checkin: {claimed: boolean; streak: number; day: number; reward: number; calendar: {day: number; reward: number; current: boolean; claimed: boolean}[]};
  milestones: Milestone[];
  passport?: ScenicPassport;
}
export interface LeaderboardEntry {id: number; rank: number; nickName: string; level: number; totalExp: number}
const invalid = () => new Error('成长数据异常，请刷新重试');
function record(value: unknown): Record<string, unknown> {if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>;}
function integer(value: unknown, minimum = 0): number {if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalid(); return value;}
function boolean(value: unknown): boolean {if (typeof value !== 'boolean') throw invalid(); return value;}
function text(value: unknown): string {if (typeof value !== 'string' || value.length > 128) throw invalid(); return value;}
function passportStage(value: unknown): PassportStage {
  const stage = record(value);
  return {id: integer(stage.id, 1), name: text(stage.name), stamped: boolean(stage.stamped)};
}
export function parsePassport(value: unknown): ScenicPassport | undefined {
  if (value == null) return undefined;
  const data = record(value);
  if (!Array.isArray(data.stages)) throw invalid();
  return {stages: data.stages.map(passportStage), stampedCount: integer(data.stampedCount), badge: boolean(data.badge),
    newStamp: data.newStamp == null ? null : passportStage(data.newStamp),
    nextStage: data.nextStage == null ? null : passportStage(data.nextStage)};
}
export function parseRetention(value: unknown): RetentionSummary {
  const data = record(value), checkin = record(data.checkin), date = text(data.date), day = integer(checkin.day, 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || day > 7 || !Array.isArray(checkin.calendar) || checkin.calendar.length !== 7 || !Array.isArray(data.milestones) || data.milestones.length > 20) throw invalid();
  const calendar = checkin.calendar.map((raw, index) => {
    const item = record(raw); if (integer(item.day, 1) !== index + 1) throw invalid();
    return {day: index + 1, reward: integer(item.reward), current: boolean(item.current), claimed: boolean(item.claimed)};
  });
  const milestones = data.milestones.map((raw) => {
    const item = record(raw), id = text(item.id), target = integer(item.target, 1), progress = integer(item.progress);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(id) || progress > target) throw invalid();
    return {id, title: text(item.title), target, progress, reward: integer(item.reward), claimed: boolean(item.claimed)};
  });
  return {date, level: integer(data.level, 1), totalExp: integer(data.totalExp), games: integer(data.games), wins: integer(data.wins),
    checkin: {day, claimed: boolean(checkin.claimed), streak: integer(checkin.streak), reward: integer(checkin.reward), calendar}, milestones,
    ...(data.passport == null ? {} : {passport: parsePassport(data.passport)})};
}
export async function claimRetention(id: string): Promise<{alreadyClaimed: boolean; reward: number; coins: number}> {
  const value = record(await api.post(id === 'checkin' ? '/retention/checkin' : `/retention/milestones/${encodeURIComponent(id)}/claim`, {}));
  return {alreadyClaimed: boolean(value.alreadyClaimed), reward: integer(value.reward), coins: integer(value.coins)};
}
export async function fetchExperienceLeaderboard(): Promise<LeaderboardEntry[]> {
  const data = await api.get('/leaderboard', {type: 'exp', limit: 20});
  if (!Array.isArray(data) || data.length > 20) throw new Error('排行榜数据异常，请重试');
  let rank = 1, previousExp = -1;
  return data.map((raw, index) => {const item = record(raw), totalExp = integer(item.totalExp); if (totalExp !== previousExp) rank = index + 1; previousExp = totalExp; return {id: integer(item.id, 1), rank, nickName: text(item.nickName), level: integer(item.level, 1), totalExp};});
}
