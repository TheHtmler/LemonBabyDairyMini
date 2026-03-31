const TREATMENT_RECORD_TYPES = [
  { value: 'iv', label: '输液' },
];

const TREATMENT_ITEM_CATEGORIES = [
  { value: 'dextrose_10', label: '10%葡萄糖' },
  { value: 'dextrose_5', label: '5%葡萄糖' },
  { value: 'levocarnitine', label: '左卡尼丁' },
  { value: 'arginine', label: '精氨酸' },
  { value: 'sodium_bicarbonate', label: '碳酸氢钠' },
  { value: 'custom', label: '自定义药物' }
];

const TREATMENT_ITEM_UNITS = ['ml', 'mg', 'g', 'ug', '袋', '支', '片', '剂'];

const DEFAULT_NUTRITION_CATEGORIES = ['dextrose_10', 'dextrose_5'];

function roundNumber(value, precision = 2) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(num * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.round(num);
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function shouldCountInNutrition(item = {}) {
  if (typeof item.countInNutrition === 'boolean') {
    return item.countInNutrition;
  }
  return DEFAULT_NUTRITION_CATEGORIES.includes(item.category);
}

function getTreatmentTypeLabel(value) {
  const match = TREATMENT_RECORD_TYPES.find(item => item.value === value);
  return match ? match.label : '治疗记录';
}

function getTreatmentCategoryLabel(value) {
  const match = TREATMENT_ITEM_CATEGORIES.find(item => item.value === value);
  return match ? match.label : '';
}

function getTreatmentCategoryIndex(value) {
  const index = TREATMENT_ITEM_CATEGORIES.findIndex(item => item.value === value);
  return index >= 0 ? index : 0;
}

function getDefaultTreatmentGroupName(index = 0) {
  return `第${index + 1}组`;
}

function getDefaultTreatmentUnit(category = '') {
  if (!category) return 'ml';
  if (category === 'sodium_bicarbonate') return 'ml';
  if (category === 'levocarnitine' || category === 'arginine') return 'mg';
  if (category === 'dextrose_10' || category === 'dextrose_5') return 'ml';
  return 'ml';
}

function getTreatmentUnitIndex(unit = 'ml') {
  const index = TREATMENT_ITEM_UNITS.findIndex(item => item === unit);
  return index >= 0 ? index : 0;
}

function createTreatmentItem(category = '') {
  const safeCategory = category || '';
  const unit = getDefaultTreatmentUnit(safeCategory);
  return {
    id: `treatment_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category: safeCategory,
    categoryIndex: safeCategory ? getTreatmentCategoryIndex(safeCategory) : -1,
    name: safeCategory ? getTreatmentCategoryLabel(safeCategory) : '',
    amount: '',
    unit,
    unitIndex: getTreatmentUnitIndex(unit),
    calories: '',
    carbsG: '',
    proteinG: '',
    fatG: '',
    countInNutrition: DEFAULT_NUTRITION_CATEGORIES.includes(category),
    notes: ''
  };
}

function createTreatmentGroup(index = 0, category = 'dextrose_10') {
  return {
    id: `treatment_group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: getDefaultTreatmentGroupName(index),
    items: []
  };
}

function createEmptyTreatmentOverview() {
  return {
    count: 0,
    groupCount: 0,
    itemCount: 0,
    nutritionItemCount: 0,
    totalCalories: 0,
    carbs: 0,
    protein: 0,
    fat: 0
  };
}

function normalizeGroups(record = {}) {
  if (Array.isArray(record.groups) && record.groups.length > 0) {
    return record.groups;
  }
  if (Array.isArray(record.items) && record.items.length > 0) {
      return [{
      id: `legacy_group_${record._id || Date.now()}`,
      name: getDefaultTreatmentGroupName(0),
      items: record.items
    }];
  }
  return [];
}

function buildTreatmentGroupLine(group = {}, index = 0) {
  const groupName = group.name || getDefaultTreatmentGroupName(index);
  const names = (Array.isArray(group.items) ? group.items : [])
    .map(item => {
      const itemName = item.name || getTreatmentCategoryLabel(item.category);
      const amount = item.amount === '' || item.amount === undefined || item.amount === null ? '' : `${item.amount}`;
      const unit = item.unit || '';
      const dosageText = amount ? `${amount}${unit}` : '';
      if (!itemName) return '';
      return dosageText ? `${itemName} ${dosageText}` : itemName;
    })
    .filter(Boolean);
  return names.length > 0 ? `${groupName} · ${names.join(' + ')}` : groupName;
}

function formatTreatmentRecordsForDisplay(records = []) {
  return (Array.isArray(records) ? records : [])
    .filter(Boolean)
    .map(record => {
      const groups = normalizeGroups(record);
      const summary = record.summary || createEmptyTreatmentOverview();
      const groupPreviewLines = groups.map((group, index) => buildTreatmentGroupLine(group, index));

      return {
        ...record,
        groups,
        groupCount: groups.length,
        typeLabel: getTreatmentTypeLabel(record.recordType),
        displayTime: record.startTime || '',
        summary,
        groupPreviewLines,
        overflowGroupCount: 0,
        notePreview: (record.notes || '').toString().trim()
      };
    })
    .sort((a, b) => {
      const timeA = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
      const timeB = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
      return timeB - timeA;
    });
}

function summarizeTreatmentRecords(records = []) {
  const summary = createEmptyTreatmentOverview();
  const validRecords = Array.isArray(records) ? records.filter(Boolean) : [];

  validRecords.forEach(record => {
    summary.count += 1;
    const groups = normalizeGroups(record);
    summary.groupCount += groups.length;
    const beforeNutritionItemCount = summary.nutritionItemCount;
    const beforeCalories = summary.totalCalories;
    const beforeCarbs = summary.carbs;
    const beforeProtein = summary.protein;
    const beforeFat = summary.fat;

    groups.forEach(group => {
      const items = Array.isArray(group.items) ? group.items : [];
      items.forEach(item => {
        summary.itemCount += 1;
        if (!shouldCountInNutrition(item)) {
          return;
        }
        summary.nutritionItemCount += 1;
        summary.totalCalories += toNumber(item.calories);
        summary.carbs += toNumber(item.carbsG);
        summary.protein += toNumber(item.proteinG);
        summary.fat += toNumber(item.fatG);
      });
    });

    const recordHasNutritionItems = summary.nutritionItemCount > beforeNutritionItemCount;
    if (!recordHasNutritionItems) {
      const legacySummary = record.summary || {};
      const legacyCalories = toNumber(legacySummary.totalCalories);
      const legacyCarbs = toNumber(legacySummary.carbs);
      const legacyProtein = toNumber(legacySummary.protein);
      const legacyFat = toNumber(legacySummary.fat);
      const legacyHasNutrition = legacyCalories > 0 || legacyCarbs > 0 || legacyProtein > 0 || legacyFat > 0;

      if (legacyHasNutrition) {
        summary.nutritionItemCount += 1;
        summary.totalCalories = beforeCalories + legacyCalories;
        summary.carbs = beforeCarbs + legacyCarbs;
        summary.protein = beforeProtein + legacyProtein;
        summary.fat = beforeFat + legacyFat;
      }
    }
  });

  summary.totalCalories = roundCalories(summary.totalCalories);
  summary.carbs = roundNumber(summary.carbs, 2);
  summary.protein = roundNumber(summary.protein, 2);
  summary.fat = roundNumber(summary.fat, 2);

  return summary;
}

function calculateTreatmentGroupSummary(group = {}) {
  return summarizeTreatmentRecords([{ groups: [group] }]);
}

function calculateTreatmentRecordSummary(groups = []) {
  return summarizeTreatmentRecords([{ groups }]);
}

function mergeTreatmentIntoMacroSummary(baseSummary = {}, treatmentRecords = []) {
  const treatmentSummary = summarizeTreatmentRecords(treatmentRecords);
  return {
    ...baseSummary,
    calories: roundCalories(toNumber(baseSummary.calories) + treatmentSummary.totalCalories),
    protein: roundNumber(toNumber(baseSummary.protein) + treatmentSummary.protein, 2),
    naturalProtein: roundNumber(toNumber(baseSummary.naturalProtein), 2),
    specialProtein: roundNumber(toNumber(baseSummary.specialProtein), 2),
    carbs: roundNumber(toNumber(baseSummary.carbs) + treatmentSummary.carbs, 2),
    fat: roundNumber(toNumber(baseSummary.fat) + treatmentSummary.fat, 2)
  };
}

function mergeTreatmentIntoOverview(baseOverview = {}, treatmentRecords = []) {
  return {
    ...baseOverview,
    treatment: summarizeTreatmentRecords(treatmentRecords)
  };
}

module.exports = {
  TREATMENT_RECORD_TYPES,
  TREATMENT_ITEM_CATEGORIES,
  TREATMENT_ITEM_UNITS,
  DEFAULT_NUTRITION_CATEGORIES,
  shouldCountInNutrition,
  getTreatmentTypeLabel,
  getTreatmentCategoryLabel,
  getTreatmentCategoryIndex,
  getDefaultTreatmentGroupName,
  getDefaultTreatmentUnit,
  getTreatmentUnitIndex,
  createTreatmentItem,
  createTreatmentGroup,
  createEmptyTreatmentOverview,
  formatTreatmentRecordsForDisplay,
  summarizeTreatmentRecords,
  calculateTreatmentGroupSummary,
  calculateTreatmentRecordSummary,
  mergeTreatmentIntoMacroSummary,
  mergeTreatmentIntoOverview
};
