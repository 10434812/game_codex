const api = require('./api-client');
const STATS_STORAGE_KEY = 'game_codex_player_stats_v1';
const MAX_RECORDS = 200;

const DEFAULT_STATE = {
  totalIncome: 0,
  totalExp: 0,
  records: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const income = Math.max(0, Math.floor(Number(record.income) || 0));
  const exp = Math.max(0, Math.floor(Number(record.exp) || 0));
  const id = String(record.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    id,
    createdAt: Number(record.createdAt) || Date.now(),
    stageName: String(record.stageName || '未知场景'),
    achievement: String(record.achievement || ''),
    income,
    exp,
    modeText: String(record.modeText || ''),
  };
}

function normalizeState(raw) {
  const base = {
    ...DEFAULT_STATE,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  const records = Array.isArray(base.records)
    ? base.records.map(normalizeRecord).filter(Boolean).slice(0, MAX_RECORDS)
    : [];
  return {
    totalIncome: Math.max(0, Math.floor(Number(base.totalIncome) || 0)),
    totalExp: Math.max(0, Math.floor(Number(base.totalExp) || 0)),
    records,
  };
}

function loadState() {
  try {
    return normalizeState(wx.getStorageSync(STATS_STORAGE_KEY));
  } catch (error) {
    return normalizeState(null);
  }
}

function saveState(state) {
  const normalized = normalizeState(state);
  try {
    wx.setStorageSync(STATS_STORAGE_KEY, normalized);
  } catch (error) { console.warn('[player-stats] saveStats error:', error); }
  return normalized;
}

function getState() {
  return clone(loadState());
}

function getSummary() {
  const state = loadState();
  return {
    totalIncome: state.totalIncome,
    totalExp: state.totalExp,
    recordsCount: state.records.length,
  };
}

function getIncomeRecords() {
  return clone(loadState().records);
}

function recordSettlement(payload = {}) {
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

  const next = saveState({
    totalIncome: state.totalIncome + income,
    totalExp: state.totalExp + exp,
    records: [record, ...state.records].slice(0, MAX_RECORDS),
  });
  return clone(next);
}

async function fetchSummary() {
  try {
    if (!api.isLoggedIn()) return getSummary();
    const data = await api.get('/stats/summary');
    if (data) {
      return {
        totalIncome: data.totalIncome || 0,
        totalExp: data.totalExp || 0,
        recordsCount: data.recordCount || 0,
      };
    }
  } catch (err) {
    console.warn('[player-stats] fetchSummary error:', err);
  }
  return getSummary();
}

async function fetchHistory(page = 1, limit = 20) {
  try {
    if (api.isLoggedIn()) {
      return await api.get('/stats/history', { page, limit });
    }
  } catch (err) {
    console.warn('[player-stats] fetchHistory error:', err);
  }
  return { records: [], total: 0, page, limit };
}

function __resetForTests() {
  try {
    wx.removeStorageSync(STATS_STORAGE_KEY);
  } catch (error) { console.warn('[player-stats] clearStats error:', error); }
  return getState();
}

module.exports = {
  getIncomeRecords,
  getState,
  getSummary,
  fetchSummary,
  fetchHistory,
  recordSettlement,
  __resetForTests,
};
