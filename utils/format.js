function formatNumber(value) {
  const amount = Number(value || 0);
  const normalized = Number.isFinite(amount) ? amount : 0;
  return normalized.toLocaleString('en-US');
}

function formatCurrency(value, options = {}) {
  const amount = Number(value || 0);
  const normalized = Number.isFinite(amount) ? amount : 0;
  const showSign = options.showSign === true;
  const sign = showSign && normalized > 0 ? '+' : normalized < 0 ? '-' : '';
  return `${sign}¥${formatNumber(Math.abs(normalized))}`;
}

function formatDateTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

module.exports = {
  formatCurrency,
  formatDateTime,
  formatNumber,
};
