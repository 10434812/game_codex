/**
 * 玩家战绩（原 utils/player-stats.js）。
 * 本地按对局 id 去重记录，最多保留 200 条；有登录态时优先读服务端汇总。
 */

import * as api from './ApiClient';
import {readJson, removeKey, writeJson} from '../platform/storage';

const STATS_STORAGE_KEY = 'game_codex_player_stats_v1';
const MAX_RECORDS = 200;

export interface StatsRecord {
  id: string;
  createdAt: number;
  stageName: string;
  achievement: string;
  income: number;
  exp: number;
  modeText: string;
}

export interface StatsState {
  totalIncome: number;
  totalExp: number;
  records: StatsRecord[];
}

export interface StatsSummary {
  totalIncome: number;
  totalExp: number;
  recordsCount: number;
}

export interface SettlementPayload {
  id?: string;
  resultId?: string;
  income?: unknown;
  exp?: unknown;
  stageName?: unknown;
  achievement?: unknown;
  modeText?: unknown;
  createdAt?: unknown;
}

export interface HistoryPage {
  records: StatsRecord[];
  total: number;
  page: number;
  limit: number;
}

const DEFAULT_STATE: StatsState = {
  totalIncome: 0,
  totalExp: 0,
  records: [],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRecord(record: unknown): StatsRecord | null {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const source = record as Partial<StatsRecord>;
  const income = Math.max(0, Math.floor(Number(source.income) || 0));
  const exp = Math.max(0, Math.floor(Number(source.exp) || 0));
  const id = String(source.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    createdAt: Number(source.createdAt) || Date.now(),
    stageName: String(source.stageName || '未知场景'),
    achievement: String(source.achievement || ''),
    income,
    exp,
    modeText: String(source.modeText || ''),
  };
}

function normalizeState(raw: unknown): StatsState {
  const source = raw && typeof raw === 'object' ? (raw as Partial<StatsState>) : {};
  const base = {...DEFAULT_STATE, ...source};
  const records = Array.isArray(base.records)
    ? base.records
        .map((record) => normalizeRecord(record))
        .filter((record): record is StatsRecord => record !== null)
        .slice(0, MAX_RECORDS)
    : [];
  return {
    totalIncome: Math.max(0, Math.floor(Number(base.totalIncome) || 0)),
    totalExp: Math.max(0, Math.floor(Number(base.totalExp) || 0)),
    records,
  };
}

function loadState(): StatsState {
  return normalizeState(readJson<StatsState>(STATS_STORAGE_KEY));
}

function saveState(state: StatsState): StatsState {
  const normalized = normalizeState(state);
  writeJson(STATS_STORAGE_KEY, normalized);
  return normalized;
}

export function getState(): StatsState {
  return clone(loadState());
}

export function getSummary(): StatsSummary {
  const state = loadState();
  return {
    totalIncome: state.totalIncome,
    totalExp: state.totalExp,
    recordsCount: state.records.length,
  };
}

export function getIncomeRecords(): StatsRecord[] {
  return clone(loadState().records);
}

export function recordSettlement(payload: SettlementPayload = {}): StatsState {
  const id = String(payload.id || payload.resultId || '').trim();
  if (!id) {
    return getState();
  }
  const income = Math.max(0, Math.floor(Number(payload.income) || 0));
  const exp = Math.max(0, Math.floor(Number(payload.exp) || 0));
  const state = loadState();

  if (state.records.some((item) => item.id === id)) {
    return clone(state);
  }

  const record = normalizeRecord({
    id,
    createdAt: payload.createdAt || Date.now(),
    stageName: payload.stageName,
    achievement: payload.achievement,
    income,
    exp,
    modeText: payload.modeText,
  });

  if (!record) {
    return clone(state);
  }

  return clone(
    saveState({
      totalIncome: state.totalIncome + income,
      totalExp: state.totalExp + exp,
      records: [record, ...state.records].slice(0, MAX_RECORDS),
    })
  );
}

export async function fetchSummary(): Promise<StatsSummary | null> {
  const token = api.getToken();
  if (!token) return getSummary();
  try {
    const data = await api.get('/stats/summary');
    if (token !== api.getToken()) return null;
    if (data && typeof data === 'object') {
      const remote = data as {totalIncome?: number; totalExp?: number; recordCount?: number};
      if (!Number.isFinite(Number(remote.totalExp)) || Number(remote.totalExp) < 0) return null;
      return {
        totalIncome: remote.totalIncome || 0,
        totalExp: remote.totalExp || 0,
        recordsCount: remote.recordCount || 0,
      };
    }
  } catch (error) {
    console.warn('[player-stats] fetchSummary error:', error);
  }
  return null;
}

export async function fetchHistory(page = 1, limit = 20): Promise<HistoryPage> {
  try {
    if (api.isLoggedIn()) {
      const data = await api.get('/stats/history', {page, limit});
      if (data && typeof data === 'object') {
        const remote = data as Partial<HistoryPage>;
        return {
          records: Array.isArray(remote.records) ? remote.records : [],
          total: Number(remote.total) || 0,
          page: Number(remote.page) || page,
          limit: Number(remote.limit) || limit,
        };
      }
    }
  } catch (error) {
    console.warn('[player-stats] fetchHistory error:', error);
  }
  return {records: [], total: 0, page, limit};
}

export function clearLocalData(): StatsState {
  removeKey(STATS_STORAGE_KEY);
  return getState();
}

/** @private 仅测试使用 - 生产代码不要调用 */
export function __resetForTests(): StatsState {
  removeKey(STATS_STORAGE_KEY);
  return getState();
}
