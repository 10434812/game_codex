const api = require('./api-client');

let cachedOpportunities = [];
let cachedReport = null;
let lastFetchTime = 0;
let pendingPromise = null;

function normalizeOpportunity(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    sourceKey: item.sourceKey || '',
    category: item.category || '股票',
    realityCategory: item.realityCategory || item.category || 'stock',
    name: item.name || '现实机会',
    metricLabel: item.metricLabel || '',
    metricValue: item.metricValue,
    changePercent: item.changePercent,
    currency: item.currency || '',
    unit: item.unit || '',
    trend: item.trend || 'unknown',
    riskLevel: item.riskLevel || '',
    riskText: item.riskText || '',
    summary: item.summary || '',
    observedAt: item.observedAt || '',
  };
}

function getCachedOpportunities() {
  return cachedOpportunities.slice();
}

function getCachedReport() {
  return cachedReport ? {...cachedReport} : null;
}

function pickOpportunity(random = Math.random) {
  if (!cachedOpportunities.length) return null;
  const index = Math.min(cachedOpportunities.length - 1, Math.floor(random() * cachedOpportunities.length));
  return cachedOpportunities[index];
}

async function fetchFortuneReality(force = false) {
  const now = Date.now();
  if (!force && now - lastFetchTime < 60 * 1000) {
    return getCachedOpportunities();
  }
  if (pendingPromise) {
    return pendingPromise;
  }

  pendingPromise = api.get('/fortune-bags/public')
    .then((data) => {
      if (!data || data.enabled === false) {
        cachedOpportunities = [];
        cachedReport = null;
        lastFetchTime = Date.now();
        return getCachedOpportunities();
      }

      const list = Array.isArray(data.opportunities) ? data.opportunities : [];
      cachedOpportunities = list.map(normalizeOpportunity).filter(Boolean);
      cachedReport = data.report || null;
      lastFetchTime = Date.now();
      return getCachedOpportunities();
    })
    .catch((error) => {
      console.warn('[fortune-reality] fetch error:', error);
      lastFetchTime = Date.now();
      return getCachedOpportunities();
    })
    .finally(() => {
      pendingPromise = null;
    });

  return pendingPromise;
}

module.exports = {
  fetchFortuneReality,
  getCachedOpportunities,
  getCachedReport,
  pickOpportunity,
};
