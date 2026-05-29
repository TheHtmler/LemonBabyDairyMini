const {
  BREAST_MILK_TAG_META,
  POWDER_CATEGORIES,
  POWDER_CATEGORY_META,
  PROTEIN_ROLES,
  buildCategoryBadgeStyle
} = require('./formulaPowderUtils');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function formatAmount(value) {
  const normalized = toNumber(value);
  if (!normalized) return '0';
  return normalized.toFixed(2).replace(/\.?0+$/, '');
}

function buildComponentSummarySegment(component = {}) {
  if (component.kind === 'breast_milk') {
    const volume = toNumber(component.volume);
    return volume > 0 ? `母乳 ${formatAmount(volume)}ml` : '';
  }

  if (component.kind !== 'formula_powder') {
    return '';
  }

  const badge = component.categoryShortLabel || getCategoryShortLabel(component.category);
  const name = component.powderName || '配方粉';
  const volume = toNumber(component.waterVolume);
  const powder = toNumber(component.powderWeight);
  const prefix = `${badge ? `${badge} ` : ''}${name}`;

  if (volume > 0 && powder > 0) {
    return `${prefix} ${formatAmount(volume)}ml（粉 ${formatAmount(powder)}g）`;
  }
  if (volume > 0) {
    return `${prefix} ${formatAmount(volume)}ml`;
  }
  if (powder > 0) {
    return `${prefix} 粉 ${formatAmount(powder)}g`;
  }
  return '';
}

function buildComponentSummaryItem(component = {}) {
  if (component.kind === 'breast_milk') {
    const volume = toNumber(component.volume);
    if (volume <= 0) return null;
    return {
      badge: BREAST_MILK_TAG_META.shortLabel,
      badgeClass: BREAST_MILK_TAG_META.badgeClass,
      badgeStyle: buildCategoryBadgeStyle(BREAST_MILK_TAG_META),
      name: '母乳',
      amountText: `${formatAmount(volume)}ml`
    };
  }

  if (component.kind !== 'formula_powder') {
    return null;
  }

  const volume = toNumber(component.waterVolume);
  const powder = toNumber(component.powderWeight);
  if (volume <= 0 && powder <= 0) {
    return null;
  }

  const parts = [];
  if (volume > 0) {
    parts.push(`${formatAmount(volume)}ml`);
  }
  if (powder > 0) {
    parts.push(`粉 ${formatAmount(powder)}g`);
  }

  return {
    badge: component.categoryShortLabel || getCategoryShortLabel(component.category),
    badgeClass: component.categoryBadgeClass || getCategoryBadgeClass(component.category),
    badgeStyle: component.categoryBadgeStyle || buildCategoryBadgeStyle(POWDER_CATEGORY_META[component.category]),
    name: component.powderName || '配方粉',
    amountText: parts.join(' · ')
  };
}

function getCategoryShortLabel(category) {
  if (POWDER_CATEGORY_META[category]) return POWDER_CATEGORY_META[category].shortLabel;
  return '';
}

function getCategoryBadgeClass(category) {
  if (POWDER_CATEGORY_META[category]) return POWDER_CATEGORY_META[category].badgeClass;
  return 'regular';
}

function buildLegacyFields(components = []) {
  return components.reduce((totals, component) => {
    if (component.kind === 'breast_milk') {
      totals.breastVolume += toNumber(component.volume);
      return totals;
    }

    if (component.kind !== 'formula_powder') {
      return totals;
    }

    const role = component.proteinRole || PROTEIN_ROLES.NATURAL;
    const waterVolume = toNumber(component.waterVolume);
    const powderWeight = toNumber(component.powderWeight);

    if (role === PROTEIN_ROLES.SPECIAL || component.category === POWDER_CATEGORIES.SPECIAL_FORMULA) {
      totals.specialVolume += waterVolume;
      totals.specialPowderWeight += powderWeight;
      return totals;
    }

    if (role === PROTEIN_ROLES.NONE || component.category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT) {
      totals.energyPowderWeight += powderWeight;
      return totals;
    }

    totals.formulaVolume += waterVolume;
    totals.formulaPowderWeight += powderWeight;
    return totals;
  }, {
    breastVolume: 0,
    formulaVolume: 0,
    formulaPowderWeight: 0,
    specialVolume: 0,
    specialPowderWeight: 0,
    energyPowderWeight: 0
  });
}

function calculateComponentNutrition(component = {}) {
  const nutrition = component.nutritionSnapshot || {};
  if (component.kind === 'breast_milk') {
    const factor = toNumber(component.volume) / 100;
    return {
      volume: toNumber(component.volume),
      calories: toNumber(nutrition.calories) * factor,
      protein: toNumber(nutrition.protein) * factor,
      carbs: toNumber(nutrition.carbs) * factor,
      fat: toNumber(nutrition.fat) * factor
    };
  }

  if (component.kind === 'formula_powder') {
    const factor = toNumber(component.powderWeight) / 100;
    return {
      volume: toNumber(component.waterVolume),
      calories: toNumber(nutrition.calories) * factor,
      protein: toNumber(nutrition.protein) * factor,
      carbs: toNumber(nutrition.carbs) * factor,
      fat: toNumber(nutrition.fat) * factor
    };
  }

  return {
    volume: 0,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  };
}

function addMilkOverviewStats(target, stats = {}) {
  target.volume += toNumber(stats.volume);
  target.calories += toNumber(stats.calories);
  target.protein += toNumber(stats.protein);
  target.carbs += toNumber(stats.carbs);
  target.fat += toNumber(stats.fat);
}

function roundMilkOverviewGroup(group = {}) {
  return {
    volume: roundValue(group.volume),
    calories: roundValue(group.calories),
    protein: roundValue(group.protein),
    carbs: roundValue(group.carbs),
    fat: roundValue(group.fat)
  };
}

function buildMilkOverviewSnapshot(components = [], summary = {}) {
  const overview = {
    normal: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0 },
    special: { volume: 0, calories: 0, protein: 0, carbs: 0, fat: 0 }
  };

  (components || []).forEach((component) => {
    const stats = calculateComponentNutrition(component);
    const isSpecial = component?.kind === 'formula_powder'
      && (component.proteinRole === PROTEIN_ROLES.SPECIAL || component.category === POWDER_CATEGORIES.SPECIAL_FORMULA);
    addMilkOverviewStats(isSpecial ? overview.special : overview.normal, stats);
  });

  return {
    normal: roundMilkOverviewGroup(overview.normal),
    special: roundMilkOverviewGroup(overview.special),
    totalVolume: roundValue(summary.totalVolume || overview.normal.volume + overview.special.volume),
    totalCalories: roundValue(summary.calories || overview.normal.calories + overview.special.calories)
  };
}

function createFeedingDisplayFromV2(record = {}) {
  const components = Array.isArray(record.formulaComponents) ? record.formulaComponents : [];
  const legacyFields = buildLegacyFields(components);
  const summary = record.nutritionSummary || {};
  const milkOverviewSnapshot = buildMilkOverviewSnapshot(components, summary);
  const hasFormulaNatural = legacyFields.formulaVolume > 0;
  const naturalMilkType = hasFormulaNatural && legacyFields.breastVolume <= 0 ? 'formula' : 'breast';
  const naturalMilkVolume = milkOverviewSnapshot.normal.volume || (
    naturalMilkType === 'formula'
      ? legacyFields.formulaVolume
      : legacyFields.breastVolume
  );

  return {
    ...record,
    id: record.id || record._id || '',
    _id: record._id || record.id || '',
    source: 'milk_feeding_v2',
    isV2FeedingRecord: true,
    startTime: record.startTime || '',
    formattedStartTime: record.startTime || '--:--',
    displayTime: record.startTime || '--:--',
    naturalMilkType,
    naturalMilkVolume: roundValue(naturalMilkVolume),
    totalMilkVolume: milkOverviewSnapshot.totalVolume,
    milkOverviewSnapshot,
    formulaPowderWeight: roundValue(legacyFields.formulaPowderWeight),
    specialMilkVolume: roundValue(legacyFields.specialVolume),
    specialMilkPowder: roundValue(legacyFields.specialPowderWeight),
    energyPowderWeight: roundValue(legacyFields.energyPowderWeight),
    milkSummaryItems: components
      .map(buildComponentSummaryItem)
      .filter(Boolean),
    milkSummaryText: components
      .map(buildComponentSummarySegment)
      .filter(Boolean)
      .join(' · '),
    nutritionDisplay: {
      calories: roundValue(summary.calories),
      carbs: roundValue(summary.carbs),
      fat: roundValue(summary.fat),
      naturalProtein: roundValue(summary.naturalProtein),
      specialProtein: roundValue(summary.specialProtein)
    }
  };
}

function pickBasicInfo(records = []) {
  const snapshot = records.find((record) => record.basicInfoSnapshot)?.basicInfoSnapshot || {};
  return {
    weight: snapshot.weight || '',
    height: snapshot.height || ''
  };
}

function createDailyRecordFromV2(records = [], date, babyUid) {
  const activeRecords = (records || []).filter(Boolean);
  const feedings = activeRecords.map(createFeedingDisplayFromV2);
  const firstRecord = activeRecords[0] || {};
  const basicInfo = pickBasicInfo(activeRecords);

  return {
    _id: firstRecord._id || firstRecord.id || `v2_${date || ''}`,
    id: firstRecord.id || firstRecord._id || `v2_${date || ''}`,
    babyUid: babyUid || firstRecord.babyUid || '',
    date,
    source: 'feeding_records_v2',
    basicInfo,
    feedings,
    intakes: [],
    summary: {}
  };
}

function isActiveMilkFeedingV2Record(record = {}) {
  const status = record.status || 'active';
  return status === 'active' && record.recordType !== 'daily_basic_info';
}

// 把一批 feeding_records_v2 记录按日期聚合成「旧结构」的每日喂奶记录，
// 供奶统计页面复用：每条 feeding 自带 V2 营养快照（nutritionDisplay/milkOverviewSnapshot）。
function groupV2FeedingRecordsByDate(records = [], babyUid = '') {
  const byDate = new Map();
  (Array.isArray(records) ? records : []).forEach((record = {}) => {
    if (!isActiveMilkFeedingV2Record(record)) {
      return;
    }
    const dateKey = record.date || '';
    if (!dateKey) {
      return;
    }
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey).push(record);
  });

  const result = new Map();
  byDate.forEach((dayRecords, dateKey) => {
    result.set(dateKey, createDailyRecordFromV2(dayRecords, dateKey, babyUid || dayRecords[0]?.babyUid || ''));
  });
  return result;
}

module.exports = {
  createDailyRecordFromV2,
  createFeedingDisplayFromV2,
  groupV2FeedingRecordsByDate
};
