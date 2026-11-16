const ReportModel = require('../../models/report');
const { buildIndicatorDisplay, formatReportRange, hasReportValue } = require('../../utils/reportDisplay');
const { formatReportNumber } = require('./reportNumberFormat');
const { normalizeReportUnit } = require('./reportRecognitionRules');

function valueKey(value) {
  if (!hasReportValue(value)) return '';
  const text = String(value).replace(/\s+/g, '').replace(/＜/g, '<').replace(/＞/g, '>');
  const match = text.match(/^(<=|>=|[<>≤≥])?([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i);
  if (!match) return text;
  const number = Number(match[2]);
  // 常见小数与科学计数法统一；过长的有效位保留原文，不能因浮点舍入掩盖不同结果。
  const significant = match[2].split(/[eE]/)[0].replace(/[^0-9]/g, '').replace(/^0+/, '');
  const underflow = number === 0 && /[1-9]/.test(significant);
  const numeric = Number.isFinite(number) && !underflow && significant.length <= 15 ? String(number) : match[2];
  const operator = (match[1] || '').replace('<=', '≤').replace('>=', '≥');
  return operator + numeric;
}

function unitKey(value) {
  return normalizeReportUnit(value);
}

function rangeQualifier(indicator) {
  return String(indicator.refRange || '').replace(/＜/g, '<').replace(/＞/g, '>')
    .replace(/<=/g, '≤').replace(/>=/g, '≥').match(/[<>≤≥]/g)?.join('') || '';
}

function fingerprint(indicator) {
  return JSON.stringify(['value', 'minRange', 'maxRange'].map(key => valueKey(indicator[key]))
    .concat(unitKey(indicator.unit), rangeQualifier(indicator)));
}

function choiceSignature(variant) {
  // 新的原文证据或范围变化必须重新核对，不能沿用同值项目此前的选择。
  return variant.raw.needsReview
    ? JSON.stringify([fingerprint(variant.raw), variant.sourceTexts.slice().sort(), variant.raw.reviewReason || ''])
    : variant.signature;
}

function canMerge(left, right) {
  if (valueKey(left.value) !== valueKey(right.value)) return false;
  if (Boolean(left.confirmationBlocked) !== Boolean(right.confirmationBlocked)
    || left.confirmationBlocked && left.reviewReason !== right.reviewReason) return false;
  if (left.refRange && right.refRange && rangeQualifier(left) !== rangeQualifier(right)) return false;
  if (hasReportValue(left.unit) && hasReportValue(right.unit) && unitKey(left.unit) !== unitKey(right.unit)) return false;
  for (const key of ['minRange', 'maxRange']) {
    if (hasReportValue(left[key]) && hasReportValue(right[key]) && valueKey(left[key]) !== valueKey(right[key])) return false;
  }
  const min = hasReportValue(left.minRange) ? left.minRange : right.minRange;
  const max = hasReportValue(left.maxRange) ? left.maxRange : right.maxRange;
  return !hasReportValue(min) || !hasReportValue(max) || !Number.isFinite(Number(min))
    || !Number.isFinite(Number(max)) || Number(min) <= Number(max);
}

function combineVariant(variant, indicator, raw, signature) {
  if (!variant.signatures.includes(signature)) variant.signatures.push(signature);
  for (const text of raw.sourceTexts || (raw.sourceText ? [raw.sourceText] : [])) {
    if (!variant.sourceTexts.includes(text)) variant.sourceTexts.push(text);
  }
  const preferred = (raw.matchScore || 0) > (variant.raw.matchScore || 0) ? { indicator, raw } : variant;
  const combined = { ...preferred.raw };
  combined.needsReview = variant.raw.needsReview === true || raw.needsReview === true;
  combined.confirmationBlocked = variant.raw.confirmationBlocked === true || raw.confirmationBlocked === true;
  combined.reviewReason = variant.raw.reviewReason || raw.reviewReason || '';
  for (const key of ['minRange', 'maxRange', 'unit']) {
    combined[key] = hasReportValue(variant.raw[key]) ? variant.raw[key] : hasReportValue(raw[key]) ? raw[key] : '';
  }
  combined.refRange = variant.raw.refRange || raw.refRange || '';
  combined.sourceRowIds = [...new Set((variant.raw.sourceRowIds || [variant.raw.sourceRowId])
    .concat(raw.sourceRowIds || [raw.sourceRowId]).filter(Boolean))];
  variant.indicator = { ...preferred.indicator, unit: combined.unit,
    needsReview: combined.needsReview, reviewReason: combined.reviewReason,
    value: formatReportNumber(combined.value), minRange: formatReportNumber(combined.minRange),
    maxRange: formatReportNumber(combined.maxRange) };
  variant.raw = combined;
}

function mergeReportPages(pages, reportType, choices = {}) {
  const groups = new Map();
  let itemCount = 0;
  let unrecognizedCount = 0;
  pages.forEach(page => {
    if (page.status !== 'success' || !page.result) return;
    itemCount += page.result.context?.itemCount || 0;
    for (const warning of page.result.context?.warnings || []) {
      if (warning.code === 'UNRECOGNIZED_ROWS' && Number.isSafeInteger(warning.count)) unrecognizedCount += warning.count;
    }
    const entries = Array.isArray(page.result.candidates) ? page.result.candidates.map(item => [item.key, item])
      : Object.entries(page.result.indicators || {});
    entries.forEach(([key, indicator]) => {
      if (!hasReportValue(indicator.value)) return;
      const raw = page.result.rawIndicators?.[key] || indicator;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ indicator, raw });
    });
  });
  const indicators = {};
  const rows = [];
  const conflicts = [];
  ReportModel.getIndicators(reportType).forEach(config => {
    const candidates = groups.get(config.key);
    if (!candidates) return;
    const variants = [];
    candidates.forEach(({ indicator, raw }) => {
      const signature = fingerprint(raw);
      const compatible = variants.find(variant => canMerge(variant.raw, raw));
      if (compatible) combineVariant(compatible, indicator, raw, signature);
      else variants.push({ signature, signatures: [signature], indicator, raw,
        sourceTexts: raw.sourceTexts ? [...raw.sourceTexts] : raw.sourceText ? [raw.sourceText] : [] });
    });
    const needsChoice = variants.length > 1 || variants.some(variant => variant.raw.needsReview === true);
    const selected = !needsChoice ? variants[0]
      : variants.find(variant => !variant.raw.confirmationBlocked && (variant.raw.needsReview
        ? choiceSignature(variant) === choices[config.key] : variant.signatures.includes(choices[config.key])));
    const evidence = variants.map(variant => {
      const ids = variant.raw.sourceRowIds || [variant.raw.sourceRowId];
      const photos = [...new Set(ids.filter(Boolean).map(id => {
        const match = id.match(/^p(\d+)r/);
        return match ? '第' + match[1] + '张照片' : '第1张照片';
      }))];
      return {
        signature: choiceSignature(variant), valueText: String(variant.raw.rawValue || variant.raw.value),
        sourceText: variant.sourceTexts.join(' / '), reviewReason: variant.raw.reviewReason || '',
        confirmationBlocked: variant.raw.confirmationBlocked === true,
        unit: variant.raw.unit || '', sourceLabel: photos.join('、'),
        rangeText: variant.raw.refRange || formatReportRange(variant.raw.minRange, variant.raw.maxRange) || '未识别参考范围'
      };
    });
    if (needsChoice) {
      conflicts.push({ key: config.key, variants: evidence });
    }
    if (!selected) {
      rows.push({ ...buildIndicatorDisplay(config, {}), needsReview: true, hasConflict: true, evidence,
        reviewHint: evidence.some(item => item.confirmationBlocked) ? '单位需核对，请对照原图手工填写' : '原行结果不一致，请选择正确来源' });
      return;
    }
    indicators[config.key] = { ...selected.indicator, needsReview: false, reviewReason: '' };
    rows.push({ ...buildIndicatorDisplay({ ...config, unit: selected.indicator.unit || config.unit }, selected.indicator),
      needsReview: false, hasConflict: needsChoice, evidence,
      valueText: selected.raw.rawValue ?? selected.raw.value,
      rangeText: selected.raw.refRange || formatReportRange(selected.raw.minRange, selected.raw.maxRange),
      sourceName: selected.sourceTexts.join(' / '),
      sourceLabel: evidence.find(item => item.signature === choiceSignature(selected))?.sourceLabel || '' });
  });
  return { indicators, rows, conflicts, context: { itemCount, unrecognizedCount } };
}

module.exports = { mergeReportPages };
