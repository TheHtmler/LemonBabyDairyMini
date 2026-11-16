const { normalizeReportDetectionValue } = require('../../utils/reportNumeric');

function normalizeSignedNumberText(value = '') {
  const trimmed = `${value ?? ''}`.trim();
  const parenMatch = trimmed.match(/^\(([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\)$/);
  const text = parenMatch ? parenMatch[1] : trimmed;
  return normalizeReportDetectionValue(text) || text;
}

function formatReportNumber(value) {
  // 识别交接、编辑失焦和保存共用原值文本，避免三位小数掩盖来源冲突。
  return normalizeSignedNumberText(value);
}

// 保留比较符、正负号与科学计数法的编辑中状态；非法文字交给保存校验，不能删字后变成另一数值。
function sanitizeSignedDecimalInput(value = '') {
  const text = `${value ?? ''}`.trim()
    .replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xFF10))
    .replace(/[−﹣－]/g, '-').replace(/＋/g, '+').replace(/．/g, '.')
    .replace(/＜/g, '<').replace(/＞/g, '>').replace(/＝/g, '=')
    .replace(/≦/g, '≤').replace(/≧/g, '≥')
    .replace(/^<\s*=/, '≤').replace(/^>\s*=/, '≥')
    .replace(/^([<>≤≥])\s+/, '$1');
  return normalizeReportDetectionValue(text) || text;
}

module.exports = {
  formatReportNumber,
  normalizeSignedNumberText,
  sanitizeSignedDecimalInput
};
