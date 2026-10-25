'use strict';

// 只核对模型提供的标签文字，不把标签外的常识、NRV 或另一列含量补成读数。
const UNIT_NAMES = {
  g: 'g', 克: 'g', 公克: 'g', gram: 'g', grams: 'g',
  mg: 'mg', 毫克: 'mg', milligram: 'mg', milligrams: 'mg',
  kj: 'kj', 千焦: 'kj', 千焦耳: 'kj', kilojoule: 'kj', kilojoules: 'kj',
  kcal: 'kcal', 千卡: 'kcal', 大卡: 'kcal', 千卡路里: 'kcal', kilocalorie: 'kcal', kilocalories: 'kcal',
  ml: 'ml', 毫升: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  份: 'portion', serving: 'portion', servings: 'portion'
};
const AMOUNT = /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*(千卡路里|kilocalories?|kilojoules?|milliliters?|millilitres?|milligrams?|grams?|千焦耳|千焦|千卡|大卡|毫克|公克|毫升|servings?|kcal|kj|mg|ml|克|份|g)(?![a-z])/gi;
const LABELS = /饱和脂肪|反式脂肪|糖醇|总糖|能量|热量|蛋白质|蛋白|总脂肪|脂肪|碳水化合物|碳水|膳食纤维|纤维|钠|糖|\b(?:saturated\s+fat|trans\s+fat|sugar\s+alcohols?|sugars?|energy|calories|proteins?|total\s+fat|fat|carbohydrates?|carbs?|dietary\s+fib(?:er|re)|fib(?:er|re)|sodium)\b/gi;

function normalizedText(value) { return typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : ''; }
function labelField(value) {
  if (/^(?:能量|热量|energy|calories)$/.test(value)) return 'calories';
  if (/^(?:蛋白质|蛋白|proteins?)$/.test(value)) return 'protein';
  if (/^(?:总脂肪|脂肪|total\s+fat|fat)$/.test(value)) return 'fat';
  if (/^(?:碳水化合物|碳水|carbohydrates?|carbs?)$/.test(value)) return 'carbs';
  if (/^(?:膳食纤维|纤维|dietary\s+fib(?:er|re)|fib(?:er|re))$/.test(value)) return 'fiber';
  return /^(?:钠|sodium)$/.test(value) ? 'sodium' : null;
}
function amounts(content) {
  const result = []; const pattern = new RegExp(AMOUNT.source, AMOUNT.flags); let match;
  while ((match = pattern.exec(content))) {
    // 不从未支持的小数逗号、负数或残缺数字中截取尾部并误当作正数。
    if (match.index && /[\d.,+\-−]/.test(content[match.index - 1])) continue;
    const source = match[1].replace(/,/g, '');
    const decimals = (source.split('.')[1] || '').length;
    result.push({ value: Number(source), unit: UNIT_NAMES[match[2].toLowerCase()],
      step: Math.pow(10, -decimals), start: match.index, end: pattern.lastIndex });
  }
  return result;
}
function canonical(field, amount) {
  if (field === 'calories') {
    if (amount.unit === 'kj') return { value: amount.value / 4.184, step: amount.step / 4.184 };
    return amount.unit === 'kcal' ? amount : null;
  }
  if (!['g', 'mg'].includes(amount.unit)) return null;
  const factor = field === 'sodium' ? amount.unit === 'g' ? 1000 : 1 : amount.unit === 'mg' ? 0.001 : 1;
  return { value: amount.value * factor, step: amount.step * factor };
}
function sameAmount(field, left, right) {
  const a = canonical(field, left); const b = canonical(field, right);
  if (!a || !b) return false;
  const difference = Math.abs(a.value - b.value);
  if (difference <= 1e-8 * Math.max(1, Math.abs(a.value), Math.abs(b.value))) return true;
  // 同单位必须忠实转录；换单位仅接受合理精度的舍入，且不能把非零读数舍成零。
  if (left.unit === right.unit || a.value === 0 || b.value === 0) return false;
  const rounded = Math.round(b.value / a.step) * a.step;
  return Math.abs(a.value - rounded) <= 1e-8 * Math.max(1, Math.abs(a.value));
}
function sameEvidenceAmount(field, left, right) {
  const a = canonical(field, left); const b = canonical(field, right);
  if (!a || !b) return false;
  if (left.unit === right.unit || a.value === 0 || b.value === 0) return sameAmount(field, left, right);
  // 双单位标示可能分别取整；其精度区间应相交，且与文字顺序无关。
  return Math.abs(a.value - b.value) <= (a.step + b.step) / 2 + 1e-8;
}
function fieldSections(field, content) {
  const pattern = new RegExp(LABELS.source, LABELS.flags); const labels = []; let match;
  while ((match = pattern.exec(content))) labels.push({ field: labelField(match[0]), start: match.index, end: pattern.lastIndex });
  if (!labels.length) return [content];
  return labels.filter(item => item.field === field).map(item => {
    const next = labels.find(candidate => candidate.start >= item.end);
    return content.slice(item.end, next ? next.start : content.length);
  });
}
function isBasisAmount(content, amount) {
  return /(?:每(?:份|次|包|袋|瓶)?|份量|每份量|每份含量|每份用量|per(?:\s+serving)?|serving\s+size)[\s:：(/]*$/.test(content.slice(0, amount.start));
}

function validateNutrientEvidence(field, entry, normalizedUnit, evidenceText) {
  const content = normalizedText(evidenceText);
  const sections = fieldSections(field, content);
  if (!sections.length) return { message: '证据对应其他营养指标', conflict: true };
  const quantities = sections.flatMap(section => amounts(section).filter(amount => !isBasisAmount(section, amount)));
  const values = quantities.filter(amount => canonical(field, amount));
  if (!values.length) return { message: quantities.length ? '标签证据的单位与该营养指标不一致' : '缺少可核对的含量和单位证据', conflict: !!quantities.length };
  // 两列数值不同时不猜测应取哪一列；等价的千焦、千卡双标示仍可采用。
  if (values.some((amount, index) => values.slice(index + 1).some(other => !sameEvidenceAmount(field, amount, other)))) {
    return { message: '证据中有多个不同含量，无法确认应采用哪一列', conflict: true };
  }
  const source = { value: entry.value, unit: normalizedUnit,
    step: Math.pow(10, -((String(entry.value).split('.')[1] || '').length)) };
  return values.some(amount => sameAmount(field, source, amount)) ? null : { message: '数值或单位与标签证据不一致', conflict: true };
}

function readLabelEnergy(evidenceText) {
  const content = normalizedText(evidenceText);
  const values = fieldSections('calories', content).flatMap(amounts)
    .filter(amount => canonical('calories', amount));
  const source = values.find(amount => amount.unit === 'kcal') || values[0];
  return source && !validateNutrientEvidence('calories', source, source.unit, evidenceText)
    ? { value: source.value, unit: source.unit } : null;
}

function validateBasisEvidence(basis, evidenceText) {
  const content = normalizedText(evidenceText);
  const explicit = amounts(content).filter(amount => isBasisAmount(content, amount));
  if (basis.unit === 'portion' && basis.quantity === 1 && /每份|per\s+serving/.test(content)) return null;
  const matches = explicit.filter(amount => amount.unit === basis.unit && amount.value === basis.quantity);
  return matches.length && explicit.every(amount => amount.unit === basis.unit && amount.value === basis.quantity)
    ? null : '计量基准的数值或单位与标签证据不一致，请核对后手工填写';
}

module.exports = { validateNutrientEvidence, validateBasisEvidence, readLabelEnergy };
