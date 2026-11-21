// 只统一同一单位的书写，不改变尺度，也不进行数值换算。
function normalizeReportUnit(unit = '') {
  let text = String(unit || '').trim()
    .replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[μµ]/g, 'u')
    .replace(/[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, exponent => '^' + [...exponent].map(char =>
      ({ '⁻': '-', '⁺': '+', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
        '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' })[char]).join(''))
    .replace(/\s+/g, '')
    .replace(/[－−–]/g, '-')
    .replace(/[／]/g, '/')
    .toLowerCase();
  if (!text || /^(?:无|无单位|none|n\/a|na|--|-)$/.test(text)) return '';
  if (/^(?:百分比|百分率|percent|percentage|pct)$/.test(text)) return '%';
  text = text.replace(/^[×x*](?=10\^)/, '').replace(/10\*\*(\d+)/g, '10^$1');
  if (!text.includes('/')) text = text.replace(/[·.*]?(l|dl|ml|ul)\^?-1$/, '/$1');
  return text;
}

function areReportUnitsEquivalent(first, second) {
  return normalizeReportUnit(first) === normalizeReportUnit(second);
}

module.exports = { normalizeReportUnit, areReportUnitsEquivalent };
