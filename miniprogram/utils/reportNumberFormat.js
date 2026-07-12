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

// 输入过程中保留可选负号与小数点，兼容华为等机型纯数字键盘无法输入负号的问题（需配合 type="text"）。
function sanitizeSignedDecimalInput(value = '') {
  const raw = `${value ?? ''}`;
  if (raw === '') return '';

  const trimmed = raw.trim();
  const leadingMinus = trimmed.startsWith('-');
  let body = leadingMinus ? trimmed.slice(1) : trimmed;

  body = body.replace(/-/g, '').replace(/[^\d.]/g, '');

  const dotIndex = body.indexOf('.');
  if (dotIndex !== -1) {
    body = body.slice(0, dotIndex + 1) + body.slice(dotIndex + 1).replace(/\./g, '');
  }

  if (leadingMinus) {
    return body === '' ? '-' : `-${body}`;
  }

  return body;
}

module.exports = {
  formatReportNumber,
  normalizeSignedNumberText,
  sanitizeSignedDecimalInput
};
