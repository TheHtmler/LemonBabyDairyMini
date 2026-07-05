function normalizeSignedNumberText(value = '') {
  const trimmed = `${value ?? ''}`.trim();
  const parenMatch = trimmed.match(/^\((-?\d+(?:\.\d+)?)\)$/);
  return parenMatch ? parenMatch[1] : trimmed;
}

function formatReportNumber(value, precision = 3) {
  const text = normalizeSignedNumberText(value);
  if (!text) return '';

  const num = Number(text);
  if (!Number.isFinite(num)) {
    return text;
  }

  return num.toFixed(precision);
}

module.exports = {
  formatReportNumber,
  normalizeSignedNumberText
};
