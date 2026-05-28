const MilkNutritionProfileModel = require('../../models/nutritionProfile');
const FeedingRecordV2Model = require('../../models/feedingRecordV2');
const { getBabyUid } = require('../../utils/index');
const {
  BREAST_MILK_TAG_META,
  POWDER_CATEGORY_META,
  POWDER_STATUSES,
  PROTEIN_ROLES,
  buildCategoryBadgeStyle,
  sortFormulaPowdersByCategory
} = require('../../utils/formulaPowderUtils');

const getNutritionProfileSettings = MilkNutritionProfileModel.getNutritionProfileSettings.bind(MilkNutritionProfileModel);
const getV2RecordsByDate = FeedingRecordV2Model.getRecordsByDate.bind(FeedingRecordV2Model);
const resolveBasicInfoSnapshot = FeedingRecordV2Model.resolveBasicInfoSnapshot.bind(FeedingRecordV2Model);
const wxApi = wx;
const getCurrentPagesApi = typeof getCurrentPages === 'function' ? getCurrentPages : () => [];

const ROLE_META = {
  natural: {
    title: '天然蛋白',
    planTitle: '天然蛋白小队',
    shortTitle: '天然',
    unit: 'g',
    accentClass: 'natural',
    emptyText: '选一个母乳或普通配方粉，系统会按蛋白缺口分配。'
  },
  special: {
    title: '特殊蛋白',
    planTitle: '特殊蛋白小队',
    shortTitle: '特殊',
    unit: 'g',
    accentClass: 'special',
    emptyText: '选一个特殊配方粉，剩余特殊蛋白会自动换算成粉重。'
  },
  energy: {
    title: '能量补充',
    planTitle: '能量补充小队',
    shortTitle: '能量',
    unit: 'kcal',
    accentClass: 'energy',
    emptyText: '如果热量还有缺口，可以选能量粉补齐。'
  }
};

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toPositiveNumber(value, fallback = 0) {
  const num = toNumber(value, fallback);
  return num > 0 ? num : 0;
}

function roundValue(value, precision = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
}

function formatInputValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${roundValue(num)}` : '';
}

function formatDisplayValue(value, suffix = '') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${roundValue(Math.max(0, num))}${suffix}`;
}

function getPowderRole(powder = {}) {
  if (powder.proteinRole === PROTEIN_ROLES.SPECIAL || powder.category === 'special_formula') {
    return 'special';
  }
  if (powder.proteinRole === PROTEIN_ROLES.NONE || powder.category === 'energy_supplement') {
    return 'energy';
  }
  return 'natural';
}

function enrichPowder(powder = {}) {
  const meta = POWDER_CATEGORY_META[powder.category] || {};
  return {
    ...powder,
    categoryShortLabel: meta.shortLabel || '奶',
    categoryBadgeClass: meta.badgeClass || '',
    categoryBadgeStyle: buildCategoryBadgeStyle(meta)
  };
}

function sumRecordNutrition(records = []) {
  return (records || []).reduce((acc, record) => {
    const summary = record.nutritionSummary || {};
    acc.naturalProtein += toPositiveNumber(summary.naturalProtein);
    acc.specialProtein += toPositiveNumber(summary.specialProtein);
    acc.calories += toPositiveNumber(summary.calories);
    return acc;
  }, {
    naturalProtein: 0,
    specialProtein: 0,
    calories: 0
  });
}

function calculateWaterFromPowder(powderWeight, ratio = {}) {
  const powder = toPositiveNumber(ratio.powder);
  const water = toPositiveNumber(ratio.water);
  const weight = toPositiveNumber(powderWeight);
  if (!powder || !water || !weight) return 0;
  return roundValue((weight * water) / powder);
}

function calculatePowderFromWater(waterVolume, ratio = {}) {
  const powder = toPositiveNumber(ratio.powder);
  const water = toPositiveNumber(ratio.water);
  const volume = toPositiveNumber(waterVolume);
  if (!powder || !water || !volume) return 0;
  return roundValue((volume * powder) / water);
}

function isSameRecord(record = {}, recordId = '') {
  if (!recordId) return false;
  return record._id === recordId || record.id === recordId;
}

Page({
  data: {
    babyUid: '',
    selectedDate: '',
    editingRecordId: '',
    loading: false,
    nutritionSettings: {},
    formulaPowders: [],
    existingRecords: [],
    calculationMode: 'protein',
    weight: '',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    goalCards: [],
    optionGroups: [],
    selectedKeys: [],
    allocationWeights: {},
    manualDrafts: {},
    planItems: [],
    planGroups: [],
    showDetailPanel: false,
    planSummary: {
      naturalProtein: 0,
      specialProtein: 0,
      calories: 0,
      totalVolume: 0,
      totalPowderWeight: 0
    }
  },

  async onLoad(options = {}) {
    const selectedDate = options.date || formatDateKey();
    const babyUid = getBabyUid() || getApp().globalData.babyUid || '';
    if (wxApi.setNavigationBarTitle) {
      wxApi.setNavigationBarTitle({ title: '剩余奶量规划' });
    }

    this.setData({
      babyUid,
      selectedDate,
      editingRecordId: options.recordId || options.id || ''
    });

    await this.loadPageData();
  },

  async loadPageData() {
    if (!this.data.babyUid) {
      wxApi.showToast({ title: '缺少宝宝信息', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const [settings, basicInfo, records] = await Promise.all([
        getNutritionProfileSettings(this.data.babyUid, { includeLegacyFallback: false }),
        resolveBasicInfoSnapshot(this.data.babyUid, this.data.selectedDate, {
          includeFallbacks: false,
          includeProfileInitial: true
        }),
        getV2RecordsByDate(this.data.babyUid, this.data.selectedDate)
      ]);
      const editorSeed = this.getPreviousEditorSeed();
      const formulaPowderSource = (settings?.formulaPowders || []).length
        ? settings.formulaPowders
        : (editorSeed.formulaPowders || []);
      const formulaPowders = this.enrichPlannerPowders((formulaPowderSource || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED));
      const activeRecords = (records || []).filter((record) => !isSameRecord(record, this.data.editingRecordId));
      const basicInfoForPlanner = this.mergeBasicInfoWithEditorSeed(basicInfo, editorSeed);

      this.setData({
        nutritionSettings: settings || {},
        formulaPowders,
        existingRecords: activeRecords,
        weight: formatInputValue(basicInfoForPlanner.weight),
        naturalProteinCoefficientInput: formatInputValue(basicInfoForPlanner.naturalProteinCoefficient),
        specialProteinCoefficientInput: formatInputValue(basicInfoForPlanner.specialProteinCoefficient),
        calorieCoefficientInput: formatInputValue(basicInfoForPlanner.calorieCoefficient),
        loading: false
      }, () => {
        this.setDefaultSelections();
      });
    } catch (error) {
      console.error('加载剩余奶量规划失败：', error);
      this.setData({ loading: false });
      wxApi.showToast({ title: '加载失败，请稍后再试', icon: 'none' });
    }
  },

  enrichPlannerPowders(powders = []) {
    return sortFormulaPowdersByCategory((powders || []).map(enrichPowder));
  },

  getPreviousEditorSeed() {
    const pages = getCurrentPagesApi();
    const prevPage = pages[pages.length - 2];
    if (!prevPage || prevPage.route !== 'pkg-milk/milk-feeding-editor-v2/index') {
      return {};
    }
    const data = prevPage.data || {};
    return {
      weight: data.weight,
      naturalProteinCoefficient: data.naturalProteinCoefficientInput,
      specialProteinCoefficient: data.specialProteinCoefficientInput,
      calorieCoefficient: data.calorieCoefficientInput,
      formulaPowders: data.formulaPowders || []
    };
  },

  mergeBasicInfoWithEditorSeed(basicInfo = {}, editorSeed = {}) {
    const merged = { ...(basicInfo || {}) };
    ['weight', 'naturalProteinCoefficient', 'specialProteinCoefficient', 'calorieCoefficient'].forEach((field) => {
      if (!toPositiveNumber(merged[field]) && toPositiveNumber(editorSeed[field])) {
        merged[field] = editorSeed[field];
      }
    });
    return merged;
  },

  getPlannerSources() {
    const settings = this.data.nutritionSettings || {};
    const breastSource = {
      key: 'breast_milk',
      kind: 'breast_milk',
      role: 'natural',
      name: '母乳',
      categoryShortLabel: BREAST_MILK_TAG_META.shortLabel || '母',
      categoryBadgeClass: BREAST_MILK_TAG_META.badgeClass || 'breast',
      categoryBadgeStyle: buildCategoryBadgeStyle(BREAST_MILK_TAG_META),
      nutritionPer100ml: {
        protein: toPositiveNumber(settings.natural_milk_protein),
        calories: toPositiveNumber(settings.natural_milk_calories),
        fat: toPositiveNumber(settings.natural_milk_fat),
        carbs: toPositiveNumber(settings.natural_milk_carbs)
      }
    };
    const powderSources = (this.data.formulaPowders || []).map((powder) => ({
      key: `powder:${powder.id}`,
      kind: 'formula_powder',
      role: getPowderRole(powder),
      powder,
      powderId: powder.id,
      name: powder.name || '未命名奶粉',
      categoryShortLabel: powder.categoryShortLabel || '奶',
      categoryBadgeClass: powder.categoryBadgeClass || '',
      categoryBadgeStyle: powder.categoryBadgeStyle || '',
      nutritionPer100g: powder.nutritionPer100g || {},
      mixRatio: powder.mixRatio || {}
    }));

    return [breastSource, ...powderSources];
  },

  computeGoalState() {
    const weight = toPositiveNumber(this.data.weight);
    const naturalCoefficient = toPositiveNumber(this.data.naturalProteinCoefficientInput);
    const specialCoefficient = toPositiveNumber(this.data.specialProteinCoefficientInput);
    const calorieCoefficient = toPositiveNumber(this.data.calorieCoefficientInput);
    const targets = {
      naturalProtein: weight && naturalCoefficient ? roundValue(weight * naturalCoefficient) : 0,
      specialProtein: weight && specialCoefficient ? roundValue(weight * specialCoefficient) : 0,
      calories: weight && calorieCoefficient ? roundValue(weight * calorieCoefficient) : 0
    };
    const consumed = sumRecordNutrition(this.data.existingRecords || []);
    const remaining = {
      naturalProtein: Math.max(0, roundValue(targets.naturalProtein - consumed.naturalProtein)),
      specialProtein: Math.max(0, roundValue(targets.specialProtein - consumed.specialProtein)),
      calories: Math.max(0, roundValue(targets.calories - consumed.calories))
    };

    return {
      weight,
      targets,
      consumed,
      remaining
    };
  },

  getActiveGoalCards(goalState = this.computeGoalState()) {
    const cards = this.buildGoalCards(goalState);
    if (this.data.calculationMode === 'calorie') {
      return cards.filter((card) => card.key === 'energy');
    }
    return cards.filter((card) => card.key === 'natural' || card.key === 'special');
  },

  buildGoalCards(goalState = this.computeGoalState()) {
    const cardDefs = [
      ['natural', 'naturalProtein', 'g'],
      ['special', 'specialProtein', 'g'],
      ['energy', 'calories', 'kcal']
    ];

    return cardDefs.map(([role, field, unit]) => {
      const meta = ROLE_META[role];
      return {
        key: role,
        title: meta.title,
        accentClass: meta.accentClass,
        consumedText: formatDisplayValue(goalState.consumed[field], unit),
        targetText: goalState.targets[field] ? formatDisplayValue(goalState.targets[field], unit) : `--${unit}`,
        remainingText: goalState.targets[field] ? formatDisplayValue(goalState.remaining[field], unit) : `--${unit}`,
        done: goalState.targets[field] > 0 && goalState.remaining[field] <= 0
      };
    });
  },

  setDefaultSelections() {
    const goalState = this.computeGoalState();
    const sources = this.getPlannerSources();
    const nextKeys = [];
    const pickFirst = (role, shouldPick, checkerRole = role) => {
      if (!shouldPick) return;
      const source = sources.find((item) => item.role === role && this.sourceCanContribute(item, checkerRole));
      if (source) nextKeys.push(source.key);
    };

    if (this.data.calculationMode === 'calorie') {
      const energySource = sources.find((item) => item.role === 'energy' && this.sourceCanContribute(item, 'energy'));
      const fallbackSource = sources.find((item) => this.sourceCanContribute(item, 'energy'));
      const source = energySource || fallbackSource;
      if (goalState.remaining.calories > 0 && source) {
        nextKeys.push(source.key);
      }
    } else {
      pickFirst('natural', goalState.remaining.naturalProtein > 0);
      pickFirst('special', goalState.remaining.specialProtein > 0);
    }

    this.setData({
      selectedKeys: nextKeys,
      allocationWeights: this.normalizeAllocationWeights(nextKeys, {}),
      manualDrafts: {}
    }, () => {
      this.rebuildPlan();
    });
  },

  sourceCanContribute(source = {}, role = source.role) {
    if (source.kind === 'breast_milk') {
      if (role === 'energy') {
        return toPositiveNumber(source.nutritionPer100ml?.calories) > 0;
      }
      return role === 'natural' && toPositiveNumber(source.nutritionPer100ml?.protein) > 0;
    }

    const ratio = source.mixRatio || {};
    const hasStandardRatio = toPositiveNumber(ratio.powder) > 0 && toPositiveNumber(ratio.water) > 0;
    if (!hasStandardRatio) return false;

    if (role === 'energy') {
      return toPositiveNumber(source.nutritionPer100g?.calories) > 0;
    }

    return toPositiveNumber(source.nutritionPer100g?.protein) > 0;
  },

  buildOptionGroups(goalState = this.computeGoalState()) {
    const selectedSet = new Set(this.data.selectedKeys || []);
    const sources = this.getPlannerSources();
    const allocationPercents = this.buildAllocationPercents(
      sources.filter((source) => selectedSet.has(source.key))
    );

    return ['natural', 'special', 'energy'].map((role) => {
      const meta = ROLE_META[role];
      const options = sources
        .filter((source) => source.role === role)
        .map((source) => ({
          key: source.key,
          name: source.name,
          role,
          selected: selectedSet.has(source.key),
          allocationPercent: allocationPercents[source.key] || 0,
          categoryShortLabel: source.categoryShortLabel,
          categoryBadgeClass: source.categoryBadgeClass,
          categoryBadgeStyle: source.categoryBadgeStyle
        }));
      const remainingField = role === 'natural'
        ? 'naturalProtein'
        : (role === 'special' ? 'specialProtein' : 'calories');

      return {
        key: role,
        title: meta.title,
        accentClass: meta.accentClass,
        remainingText: formatDisplayValue(goalState.remaining[remainingField], meta.unit),
        emptyText: meta.emptyText,
        options
      };
    });
  },

  toggleSource(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const selectedSet = new Set(this.data.selectedKeys || []);
    const manualDrafts = { ...(this.data.manualDrafts || {}) };

    if (selectedSet.has(key)) {
      selectedSet.delete(key);
      delete manualDrafts[key];
    } else {
      selectedSet.add(key);
    }

    const selectedKeys = Array.from(selectedSet);
    this.setData({
      selectedKeys,
      allocationWeights: this.normalizeAllocationWeights(selectedKeys, this.data.allocationWeights || {}),
      manualDrafts
    }, () => {
      this.rebuildPlan();
    });
  },

  switchCalculationMode(e) {
    const mode = e.currentTarget.dataset.mode === 'calorie' ? 'calorie' : 'protein';
    if (mode === this.data.calculationMode) return;
    this.setData({
      calculationMode: mode,
      selectedKeys: [],
      allocationWeights: {},
      manualDrafts: {}
    }, () => {
      this.setDefaultSelections();
    });
  },

  onCoefficientInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [field]: e.detail.value
    }, () => {
      this.rebuildPlan();
    });
  },

  onAllocationInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const selectedKeys = this.data.selectedKeys || [];
    const nextWeights = this.adjustAllocationWeight(
      key,
      toPositiveNumber(e.detail.value),
      selectedKeys,
      this.data.allocationWeights || {}
    );

    this.setData({
      allocationWeights: nextWeights
    }, () => {
      this.rebuildPlan();
    });
  },

  onPlanInput(e) {
    const key = e.currentTarget.dataset.key;
    const field = e.currentTarget.dataset.field;
    if (!key || !field) return;
    const source = this.getPlannerSources().find((item) => item.key === key);
    const value = toPositiveNumber(e.detail.value);
    const draft = {
      ...((this.data.manualDrafts || {})[key] || {}),
      manual: true,
      [field]: value
    };

    if (source?.kind === 'formula_powder') {
      if (field === 'powderWeight') {
        draft.waterVolume = calculateWaterFromPowder(value, source.mixRatio);
      }
      if (field === 'waterVolume') {
        draft.powderWeight = calculatePowderFromWater(value, source.mixRatio);
      }
    }

    this.setData({
      manualDrafts: {
        ...(this.data.manualDrafts || {}),
        [key]: draft
      }
    }, () => {
      this.rebuildPlan();
    });
  },

  resetManualItem(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const manualDrafts = { ...(this.data.manualDrafts || {}) };
    delete manualDrafts[key];
    this.setData({ manualDrafts }, () => {
      this.rebuildPlan();
    });
  },

  toggleDetailPanel() {
    this.setData({
      showDetailPanel: !this.data.showDetailPanel
    });
  },

  valuesFromProteinShare(source = {}, share = 0) {
    const proteinShare = toPositiveNumber(share);
    if (source.kind === 'breast_milk') {
      const proteinPerMl = toPositiveNumber(source.nutritionPer100ml?.protein) / 100;
      return {
        volume: proteinPerMl ? roundValue(proteinShare / proteinPerMl) : 0
      };
    }

    const proteinPer100g = toPositiveNumber(source.nutritionPer100g?.protein);
    const powderWeight = proteinPer100g ? roundValue((proteinShare * 100) / proteinPer100g) : 0;
    return {
      powderWeight,
      waterVolume: calculateWaterFromPowder(powderWeight, source.mixRatio)
    };
  },

  valuesFromCalorieShare(source = {}, share = 0) {
    const calorieShare = toPositiveNumber(share);
    if (source.kind === 'breast_milk') {
      const caloriesPerMl = toPositiveNumber(source.nutritionPer100ml?.calories) / 100;
      return {
        volume: caloriesPerMl ? roundValue(calorieShare / caloriesPerMl) : 0
      };
    }

    const caloriesPer100g = toPositiveNumber(source.nutritionPer100g?.calories);
    const powderWeight = caloriesPer100g ? roundValue((calorieShare * 100) / caloriesPer100g) : 0;
    return {
      powderWeight,
      waterVolume: calculateWaterFromPowder(powderWeight, source.mixRatio)
    };
  },

  buildPlanItem(source = {}, values = {}, manual = false, allocationPercent = 0) {
    let nutrition = {};
    let volume = 0;
    let powderWeight = 0;
    let waterVolume = 0;

    if (source.kind === 'breast_milk') {
      volume = roundValue(toPositiveNumber(values.volume));
      const factor = volume / 100;
      const sourceNutrition = source.nutritionPer100ml || {};
      nutrition = {
        naturalProtein: roundValue(toPositiveNumber(sourceNutrition.protein) * factor),
        specialProtein: 0,
        calories: roundValue(toPositiveNumber(sourceNutrition.calories) * factor)
      };
    } else {
      powderWeight = roundValue(toPositiveNumber(values.powderWeight));
      waterVolume = roundValue(toPositiveNumber(values.waterVolume));
      const factor = powderWeight / 100;
      const sourceNutrition = source.nutritionPer100g || {};
      const protein = roundValue(toPositiveNumber(sourceNutrition.protein) * factor);
      nutrition = {
        naturalProtein: source.role === 'natural' ? protein : 0,
        specialProtein: source.role === 'special' ? protein : 0,
        calories: roundValue(toPositiveNumber(sourceNutrition.calories) * factor)
      };
    }

    const totalProtein = roundValue(nutrition.naturalProtein + nutrition.specialProtein);
    return {
      key: source.key,
      kind: source.kind,
      role: source.role,
      name: source.name,
      powderId: source.powderId || '',
      categoryShortLabel: source.categoryShortLabel,
      categoryBadgeClass: source.categoryBadgeClass,
      categoryBadgeStyle: source.categoryBadgeStyle,
      manual,
      allocationPercent: roundValue(allocationPercent),
      volume,
      powderWeight,
      waterVolume,
      protein: totalProtein,
      naturalProtein: nutrition.naturalProtein,
      specialProtein: nutrition.specialProtein,
      calories: nutrition.calories,
      mainValueText: source.kind === 'breast_milk'
        ? `${formatDisplayValue(volume, 'ml')}`
        : `${formatDisplayValue(powderWeight, 'g')}`,
      nutritionText: `${formatDisplayValue(totalProtein, 'g')} 蛋白 / ${formatDisplayValue(nutrition.calories, 'kcal')}`
    };
  },

  buildProteinRolePlan(role, sources = [], gap = 0) {
    const manualDrafts = this.data.manualDrafts || {};
    const manualSources = sources.filter((source) => manualDrafts[source.key]?.manual);
    const autoSources = sources.filter((source) => !manualDrafts[source.key]?.manual);
    const allocationPercents = this.buildAllocationPercents(sources);
    const autoPercents = this.buildAllocationPercents(autoSources, allocationPercents);
    const manualItems = manualSources.map((source) => this.buildPlanItem(
      source,
      manualDrafts[source.key],
      true,
      allocationPercents[source.key] || 0
    ));
    const proteinField = role === 'special' ? 'specialProtein' : 'naturalProtein';
    const manualProtein = manualItems.reduce((sum, item) => sum + toPositiveNumber(item[proteinField]), 0);
    const remainingGap = Math.max(0, roundValue(gap - manualProtein));
    const autoItems = autoSources.map((source) => this.buildPlanItem(
      source,
      this.valuesFromProteinShare(source, remainingGap * ((autoPercents[source.key] || 0) / 100)),
      false,
      autoPercents[source.key] || 0
    ));

    return sources.map((source) => (
      [...manualItems, ...autoItems].find((item) => item.key === source.key)
    )).filter(Boolean);
  },

  buildEnergyPlan(sources = [], calorieGap = 0) {
    const manualDrafts = this.data.manualDrafts || {};
    const manualSources = sources.filter((source) => manualDrafts[source.key]?.manual);
    const autoSources = sources.filter((source) => !manualDrafts[source.key]?.manual);
    const allocationPercents = this.buildAllocationPercents(sources);
    const autoPercents = this.buildAllocationPercents(autoSources, allocationPercents);
    const manualItems = manualSources.map((source) => this.buildPlanItem(
      source,
      manualDrafts[source.key],
      true,
      allocationPercents[source.key] || 0
    ));
    const manualCalories = manualItems.reduce((sum, item) => sum + toPositiveNumber(item.calories), 0);
    const remainingGap = Math.max(0, roundValue(calorieGap - manualCalories));
    const autoItems = autoSources.map((source) => this.buildPlanItem(
      source,
      this.valuesFromCalorieShare(source, remainingGap * ((autoPercents[source.key] || 0) / 100)),
      false,
      autoPercents[source.key] || 0
    ));

    return sources.map((source) => (
      [...manualItems, ...autoItems].find((item) => item.key === source.key)
    )).filter(Boolean);
  },

  buildPlanGroups(planItems = []) {
    return ['natural', 'special', 'energy'].map((role) => ({
      key: role,
      ...ROLE_META[role],
      items: planItems.filter((item) => item.role === role)
    }));
  },

  summarizePlan(planItems = []) {
    return planItems.reduce((acc, item) => {
      acc.naturalProtein = roundValue(acc.naturalProtein + toPositiveNumber(item.naturalProtein));
      acc.specialProtein = roundValue(acc.specialProtein + toPositiveNumber(item.specialProtein));
      acc.calories = roundValue(acc.calories + toPositiveNumber(item.calories));
      acc.totalVolume = roundValue(acc.totalVolume + toPositiveNumber(item.volume) + toPositiveNumber(item.waterVolume));
      acc.totalPowderWeight = roundValue(acc.totalPowderWeight + toPositiveNumber(item.powderWeight));
      return acc;
    }, {
      naturalProtein: 0,
      specialProtein: 0,
      calories: 0,
      totalVolume: 0,
      totalPowderWeight: 0
    });
  },

  getSelectedSourcesByKeys(selectedKeys = this.data.selectedKeys || []) {
    const selectedSet = new Set(selectedKeys);
    return this.getPlannerSources().filter((source) => selectedSet.has(source.key));
  },

  getAllocationGroups(sources = this.getSelectedSourcesByKeys()) {
    const contributableSources = (sources || []).filter((source) => (
      this.sourceCanContribute(source, this.data.calculationMode === 'calorie' ? 'energy' : source.role)
    ));
    if (this.data.calculationMode === 'calorie') {
      return [contributableSources];
    }
    return [
      contributableSources.filter((source) => source.role === 'natural'),
      contributableSources.filter((source) => source.role === 'special')
    ];
  },

  buildAllocationPercents(sources = this.getSelectedSourcesByKeys(), weightOverride = this.data.allocationWeights || {}) {
    const result = {};
    this.getAllocationGroups(sources).forEach((group) => {
      if (!group.length) return;
      const values = group.map((source) => {
        const value = toPositiveNumber(weightOverride[source.key]);
        return value > 0 ? value : 100 / group.length;
      });
      const total = values.reduce((sum, value) => sum + value, 0);
      group.forEach((source, index) => {
        result[source.key] = total > 0
          ? roundValue((values[index] / total) * 100)
          : roundValue(100 / group.length);
      });
    });
    return result;
  },

  normalizeAllocationWeights(selectedKeys = this.data.selectedKeys || [], weights = this.data.allocationWeights || {}) {
    return this.buildAllocationPercents(this.getSelectedSourcesByKeys(selectedKeys), weights);
  },

  adjustAllocationWeight(key, value, selectedKeys = this.data.selectedKeys || [], weights = this.data.allocationWeights || {}) {
    const selectedSources = this.getSelectedSourcesByKeys(selectedKeys);
    const targetGroup = this.getAllocationGroups(selectedSources).find((group) => (
      group.some((source) => source.key === key)
    )) || [];
    if (!targetGroup.length) return { ...weights };

    const clampedValue = Math.max(0, Math.min(100, roundValue(value)));
    const siblings = targetGroup.filter((source) => source.key !== key);
    const remaining = Math.max(0, roundValue(100 - clampedValue));
    const siblingTotal = siblings.reduce((sum, source) => sum + toPositiveNumber(weights[source.key]), 0);
    const next = { ...weights, [key]: clampedValue };

    siblings.forEach((source) => {
      next[source.key] = siblingTotal > 0
        ? roundValue((toPositiveNumber(weights[source.key]) / siblingTotal) * remaining)
        : roundValue(remaining / siblings.length);
    });

    return next;
  },

  rebuildPlan() {
    const goalState = this.computeGoalState();
    const selectedSet = new Set(this.data.selectedKeys || []);
    const sources = this.getPlannerSources().filter((source) => selectedSet.has(source.key));
    const planItems = this.data.calculationMode === 'calorie'
      ? this.buildEnergyPlan(
        sources.filter((source) => this.sourceCanContribute(source, 'energy')),
        goalState.remaining.calories
      )
      : [
        ...this.buildProteinRolePlan(
          'natural',
          sources.filter((source) => source.role === 'natural'),
          goalState.remaining.naturalProtein
        ),
        ...this.buildProteinRolePlan(
          'special',
          sources.filter((source) => source.role === 'special'),
          goalState.remaining.specialProtein
        )
      ];

    this.setData({
      goalCards: this.getActiveGoalCards(goalState),
      optionGroups: this.buildOptionGroups(goalState),
      planItems,
      planGroups: this.buildPlanGroups(planItems),
      planSummary: this.summarizePlan(planItems)
    });
  },

  buildApplyEntries() {
    return (this.data.planItems || [])
      .map((item) => {
        if (item.kind === 'breast_milk' && toPositiveNumber(item.volume) > 0) {
          return {
            kind: 'breast_milk',
            volume: roundValue(item.volume)
          };
        }

        if (item.kind === 'formula_powder' && toPositiveNumber(item.powderWeight) > 0) {
          return {
            kind: 'formula_powder',
            powderId: item.powderId,
            waterVolume: roundValue(item.waterVolume),
            powderWeight: roundValue(item.powderWeight),
            ratioMode: 'standard'
          };
        }

        return null;
      })
      .filter(Boolean);
  },

  applyPlanToEditor() {
    const entries = this.buildApplyEntries();
    if (!entries.length) {
      wxApi.showToast({ title: '先选一个奶粉吧', icon: 'none' });
      return;
    }

    const pages = getCurrentPagesApi();
    const prevPage = pages[pages.length - 2];
    if (!prevPage || typeof prevPage.applyGoalPlannerEntries !== 'function') {
      wxApi.showToast({ title: '请返回喂奶页后重试', icon: 'none' });
      return;
    }

    prevPage.applyGoalPlannerEntries(entries);
    wxApi.showToast({ title: '已放入本次喂奶', icon: 'success' });
    wxApi.navigateBack();
  },

  cancelPlanner() {
    wxApi.navigateBack();
  }
});
