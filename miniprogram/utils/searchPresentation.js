const { FIELDS } = require('./search-core/contracts');
const { MEASURES } = require('./search-core/capabilities');
const { compareNutrient } = require('./search-core/nutrition');

const LABELS = { calories: '能量', protein: '蛋白质', fat: '脂肪', carbs: '碳水', fiber: '膳食纤维', sodium: '钠' };
const UNITS = { g: '克', mg: '毫克', ml: '毫升', kcal: '千卡', portion: '份' };

function basisText(quantity, unit, material) {
  if (!(quantity > 0) || !unit) return '计量基准未提供';
  return '每 ' + quantity + ' ' + (UNITS[unit] || unit) +
    (material === 'dry_powder' ? '干粉' : material === 'prepared_formula' ? '冲调液' : '');
}

function resultConditions(response) {
  return (response.chips || []).filter(chip => ['source', 'basis', 'filter'].includes(chip.kind))
    .map(chip => String(chip.label || '').replace(/(\d)(kcal|mg|ml|g)\b/g, (_, value, unit) => value + (UNITS[unit] || unit)))
    .filter(Boolean).join(' · ');
}

function displayItem(item, interpretation = {}) {
  const basis = item.nutritionBasis || {};
  const nutrients = item.nutrients || {};
  const fieldSources = (item.provenance || {}).fieldSources || {};
  const values = FIELDS.map(key => {
    const entry = nutrients[key] || {};
    return { key, label: LABELS[key], value: entry.state === 'known' ? Math.round(entry.value * 1000) / 1000 + ' ' + entry.unit : '未提供',
      isEstimate: entry.state === 'known' && fieldSources[key] === 'model_estimate' };
  });
  const calories = nutrients.calories || {};
  const nativeBasis = basisText(basis.quantity, basis.unit, basis.material);
  const energyText = calories.state === 'known' ? Math.round(calories.value * 1000) / 1000 + ' 千卡' : '未提供';
  const proteinText = values.find(value => value.key === 'protein').value;
  let primaryNutrition = { label: '能量', value: energyText, basis: nativeBasis.replace(/^每\s*/, ''), isEstimate: calories.state === 'known' && fieldSources.calories === 'model_estimate' };
  let secondaryNutrition = '蛋白质 ' + proteinText + ' / ' + primaryNutrition.basis;
  const filter = (interpretation.filters || []).find(value => value.field && value.field.startsWith('nutrition.') && MEASURES[value.field]);
  if (filter) {
    const meta = MEASURES[filter.field];
    // 展示重点使用与服务端筛选相同的数量、单位及奶粉形态，不把原始份量冒充筛选基准。
    const compared = compareNutrient({ ...item, nutrients }, { ...filter, field: meta.field }, interpretation.powderBasis);
    const material = item.type === 'powder' ? interpretation.powderBasis === 'dry' ? 'dry_powder' : 'prepared_formula' : '';
    primaryNutrition = { label: meta.label,
      value: compared.state === 'unknown' ? '缺少可比较数据' : Math.round(compared.value * 1000) / 1000 + ' ' + (UNITS[meta.unit] || meta.unit),
      basis: basisText(filter.basisQuantity, filter.basisUnit, material).replace(/^每\s*/, ''),
      isEstimate: compared.state !== 'unknown' && fieldSources[meta.field] === 'model_estimate' };
    if (meta.field !== 'calories') secondaryNutrition = '能量 ' + energyText + ' / ' + nativeBasis.replace(/^每\s*/, '');
  }
  return { ...item, answers: item.answers || [], ingredients: item.ingredients || [], values, proteinText, energyText,
    primaryNutrition, secondaryNutrition,
    thumbnailUrl: typeof item.image === 'string' ? item.image : '',
    typeLabel: ({ medication: '药物', powder: '奶粉', recipe: '食谱', meal: '餐次', water: '饮水', milk: '喂奶', growth: '成长', sleep: '睡眠', bowel: '尿布' })[item.type] || '食物',
    hasNutrition: ['food', 'powder'].includes(item.type),
    medicationText: [item.dosage && item.dosage + ' ' + (item.unit || ''), item.frequency].filter(Boolean).join(' · '),
    medicationDetails: item.type === 'medication' ? [
      { label: '已设置剂量', value: item.dosage ? item.dosage + ' ' + (item.unit || '') : '未填写' },
      { label: '已设置频率', value: item.frequency || '未填写' },
      { label: '浓度', value: item.concentration ? item.concentration + ' ' + (item.concentrationUnit || '') + '/' + (item.volumeUnit || '') : '未填写' },
      { label: '备注', value: item.notes || '未填写' }
    ] : [],
    actualUnitText: UNITS[item.actualUnit] || item.actualUnit || '',
    basisText: nativeBasis,
    sourceText: ({ system: '系统', mine: '我的', history: '记录' })[item.source] || '饮食记录' };
}

module.exports = { displayItem, resultConditions };
