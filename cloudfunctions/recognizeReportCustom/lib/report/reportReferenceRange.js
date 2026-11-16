const { normalizeReportDetectionValue } = require('./reportNumeric');

function exactBound(raw) {
  const text = String(raw).trim();
  const value = normalizeReportDetectionValue(text.startsWith('(') && text.endsWith(')')
    ? text.slice(1, -1).trim() : text);
  return value && !/^[<>≤≥]/.test(value) ? value : '';
}

// 必须完整辨认范围，不从说明文字或指数中截取局部数字，不为单边范围补0。
function parseRefRange(raw = '') {
  const empty = { minRange: '', maxRange: '' };
  if (typeof raw !== 'string') return empty;
  const text = raw.trim().replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[−﹣－]/g, '-');
  if (!text || text.length > 160) return empty;
  const inequality = normalizeReportDetectionValue(text);
  if (inequality && /^[<>≤≥]/.test(inequality)) {
    return /^[<≤]/.test(inequality)
      ? { minRange: '', maxRange: inequality.slice(1) }
      : { minRange: inequality.slice(1), maxRange: '' };
  }
  let found = null;
  for (let index = 1; index < text.length - 1; index++) {
    if (!/[-~～–—至]/.test(text[index])) continue;
    const lower = exactBound(text.slice(0, index));
    const upper = exactBound(text.slice(index + 1));
    if (!lower || !upper) continue;
    if (found) return empty;
    found = { minRange: lower, maxRange: upper };
  }
  return found || empty;
}

module.exports = { parseRefRange };
