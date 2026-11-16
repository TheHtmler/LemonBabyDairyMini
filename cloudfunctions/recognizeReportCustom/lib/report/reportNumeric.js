const REPORT_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

// 检测值只规范明确的数字字符，不截取文字中的数字，也不对原始精度做舍入。
function normalizeReportDetectionValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim()
    .replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xFF10))
    .replace(/[−﹣－]/g, '-').replace(/＋/g, '+').replace(/．/g, '.')
    .replace(/＜/g, '<').replace(/＞/g, '>').replace(/＝/g, '=')
    .replace(/≦/g, '≤').replace(/≧/g, '≥')
    .replace(/^<\s*=/, '≤').replace(/^>\s*=/, '≥');
  const match = text.match(/^([<>≤≥]?)\s*(.*)$/);
  if (!match) return '';
  let numberText = match[2];
  // 原表可使用乘十与上标记数；只做通用数学记法转换，原文由调用方独立保留。
  const scientific = numberText.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[×x*·]\s*10\s*(?:\^\s*([+-]?\d+)|([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))$/i);
  if (scientific) {
    const exponent = scientific[2] ?? [...scientific[3]].map(char =>
      ({ '⁻': '-', '⁺': '+', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
        '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' })[char]).join('');
    numberText = scientific[1] + 'e' + exponent;
  }
  if (!REPORT_NUMBER_PATTERN.test(numberText) || !Number.isFinite(Number(numberText))) return '';
  return match[1] + numberText;
}

// 比较符描述阈值，不是一次精确测量，不能进入状态、趋势、差值及派生比值计算。
function toExactReportNumber(value) {
  const text = normalizeReportDetectionValue(value);
  if (!text || !REPORT_NUMBER_PATTERN.test(text)) return NaN;
  const number = Number(text);
  // 非零尾数下溢成零时仍保留原文展示，但不能把数值表示损失当作精确的零值。
  if (number === 0 && /[1-9]/.test(text.split(/[eE]/)[0])) return NaN;
  return number;
}

// 仅输出数量诊断，不记录原检验值；按原文判断零，避免数值下溢污染诊断。
function summarizeReportValues(values = []) {
  const summary = { valueCount: values.length, zeroValueCount: 0, nonZeroValueCount: 0,
    qualifiedValueCount: 0, unreadableValueCount: 0 };
  for (const value of values) {
    const text = normalizeReportDetectionValue(value);
    if (!text) summary.unreadableValueCount++;
    else if (/^[<>≤≥]/.test(text)) summary.qualifiedValueCount++;
    else if (/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(text)) summary.zeroValueCount++;
    else summary.nonZeroValueCount++;
  }
  return summary;
}

module.exports = { normalizeReportDetectionValue, toExactReportNumber, summarizeReportValues };
