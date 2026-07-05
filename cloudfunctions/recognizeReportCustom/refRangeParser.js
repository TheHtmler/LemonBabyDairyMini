const SIGNED_NUMBER_PATTERN = '(\\(-?\\d+(?:\\.\\d+)?\\)|-?\\d+(?:\\.\\d+)?)';
const RANGE_PATTERN = new RegExp(`${SIGNED_NUMBER_PATTERN}\\s*[-~–—]\\s*${SIGNED_NUMBER_PATTERN}`);

function normalizeSignedNumberToken(token = '') {
  const trimmed = `${token || ''}`.trim();
  const parenMatch = trimmed.match(/^\((-?\d+(?:\.\d+)?)\)$/);
  return parenMatch ? parenMatch[1] : trimmed;
}

function parseSignedRange(text = '') {
  const normalized = String(text || '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[～~]/g, '-')
    .replace(/[–—]/g, '-');

  const match = normalized.match(RANGE_PATTERN);
  if (!match) return null;

  return {
    minRange: normalizeSignedNumberToken(match[1]),
    maxRange: normalizeSignedNumberToken(match[2])
  };
}

function parseRefRange(refRange = '') {
  const text = `${refRange || ''}`.trim();
  if (!text) {
    return { minRange: '', maxRange: '' };
  }

  const rangeMatch = parseSignedRange(text);
  if (rangeMatch) {
    return rangeMatch;
  }

  return { minRange: '', maxRange: '' };
}

module.exports = {
  parseRefRange,
  parseSignedRange,
  normalizeSignedNumberToken
};
