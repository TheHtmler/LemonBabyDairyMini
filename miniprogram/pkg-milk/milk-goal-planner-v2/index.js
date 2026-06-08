const MilkNutritionProfileModel = require('../../models/nutritionProfile');
const FeedingRecordV2Model = require('../../models/feedingRecordV2');
const DailySummaryV2Model = require('../../models/dailySummaryV2');
const TreatmentRecordModel = require('../../models/treatmentRecord');
const dailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { mergeFoodNutrition, mergeTreatmentNutrition } = require('../../utils/dailySummaryV2Utils');
const { getBabyUid } = require('../../utils/index');
const {
  normalizeTargetMode,
  pickCoefficient,
  readNutritionTargetPreferences,
  writeNutritionTargetPreferences
} = require('../../utils/nutritionTargetPreferences');
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
const getRecentV2Record = FeedingRecordV2Model.getRecentRecord.bind(FeedingRecordV2Model);
const getRecentDayMealCount = FeedingRecordV2Model.getRecentDayMealCount.bind(FeedingRecordV2Model);
const resolveBasicInfoSnapshot = FeedingRecordV2Model.resolveBasicInfoSnapshot.bind(FeedingRecordV2Model);
const upsertGrowthRecordForDate = FeedingRecordV2Model.upsertGrowthRecordForDate.bind(FeedingRecordV2Model);
const markDailySummaryDirty = DailySummaryV2Model.markDirty.bind(DailySummaryV2Model);
// 食物现统一存于旧版 feeding_records.intakes（“复制到某天”也写在这里），
// 与数据记录页同源；不要读 V2 food_intake_records，否则复制来的食物算不进来。
const getFoodIntakesByDate = dailyRecordV2Service.loadLegacyFoodIntakes.bind(dailyRecordV2Service);
const getTreatmentsByDate = TreatmentRecordModel.findByDate.bind(TreatmentRecordModel);
const wxApi = wx;
const getCurrentPagesApi = typeof getCurrentPages === 'function' ? getCurrentPages : () => [];
const getAppApi = typeof getApp === 'function' ? getApp : () => ({ globalData: {} });

// 目标系数（天然/特殊蛋白、热量）属于“计算用的设定”，与真实喂养记录解耦：
// 只本地按宝宝记住上次填的值，绝不写入 growth_records_v2，避免污染记录页的实时汇总。
const DEFAULT_PLANNED_MEALS = 8;
const MIN_PLANNED_MEALS = 1;
const MAX_PLANNED_MEALS = 14;

const ROLE_LABELS = {
  natural: '天然蛋白',
  special: '特殊蛋白',
  energy: '能量补充'
};

// 奶粉来源分组：统一按 天然蛋白来源 → 特殊蛋白来源 → 能量补充来源 排列。
// roles 决定该组可选哪些来源，checkRole 决定来源是否能贡献（蛋白或热量）。
// optional=true 的分组（能量补充）默认不选，用户可手动添加。
// 热量维度只看热量贡献，蛋白系数作为结果反推展示，不作为输入门槛。
function getGroupRoleConfig(mode) {
  if (mode === 'calorie') {
    return [
      { key: 'natural', label: '天然蛋白来源', hint: '母乳 / 普通配方粉', roles: ['natural'], checkRole: 'energy' },
      { key: 'special', label: '特殊蛋白来源', hint: '特殊配方粉', roles: ['special'], checkRole: 'energy' },
      { key: 'energy', label: '能量补充来源', hint: '能量粉', roles: ['energy'], checkRole: 'energy', optional: true }
    ];
  }
  return [
    { key: 'natural', label: '天然蛋白来源', hint: '母乳 / 普通配方粉', roles: ['natural'], checkRole: 'natural' },
    { key: 'special', label: '特殊蛋白来源', hint: '特殊配方粉', roles: ['special'], checkRole: 'special' }
  ];
}

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

// 来源/奶粉的统一展示顺序：母乳(0) → 普奶(1) → 特奶(2) → 能量粉(3)。
// 仅影响展示排序，不改变计算数值。
function sourceDisplayOrder(source = {}) {
  if (source.kind === 'breast_milk') return 0;
  if (source.role === 'special') return 2;
  if (source.role === 'energy') return 3;
  return 1;
}

function sortByDisplayOrder(list = []) {
  return (list || [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = sourceDisplayOrder(a.item) - sourceDisplayOrder(b.item);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((entry) => entry.item);
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
    acc.protein += toPositiveNumber(summary.protein);
    acc.calories += toPositiveNumber(summary.calories);
    return acc;
  }, {
    naturalProtein: 0,
    specialProtein: 0,
    protein: 0,
    calories: 0
  });
}

// 奶之外的已摄入（食物 + 治疗），口径对齐记录页当日汇总 buildMacroSummary：
// 天然/特殊蛋白只算 食物（治疗无蛋白拆分），热量算 食物 + 治疗。
// 同时保留 food / treatment 分项，供“计算依据”面板透明展示来源构成。
function computeOtherIntake(foodIntakes = [], treatmentRecords = []) {
  const food = mergeFoodNutrition(foodIntakes || []);
  const treatment = mergeTreatmentNutrition(treatmentRecords || []);
  const foodBreakdown = {
    naturalProtein: toPositiveNumber(food.naturalProtein),
    specialProtein: toPositiveNumber(food.specialProtein),
    protein: toPositiveNumber(food.protein),
    calories: toPositiveNumber(food.calories)
  };
  const treatmentBreakdown = {
    naturalProtein: 0,
    specialProtein: 0,
    // 治疗的蛋白不归入天然/特殊（无法拆分），但仍作为总蛋白展示给用户参考。
    protein: toPositiveNumber(treatment.protein),
    calories: toPositiveNumber(treatment.calories)
  };
  return {
    naturalProtein: foodBreakdown.naturalProtein + treatmentBreakdown.naturalProtein,
    specialProtein: foodBreakdown.specialProtein + treatmentBreakdown.specialProtein,
    calories: foodBreakdown.calories + treatmentBreakdown.calories,
    food: foodBreakdown,
    treatment: treatmentBreakdown
  };
}

function calculateWaterFromPowder(powderWeight, ratio = {}) {
  const powder = toPositiveNumber(ratio.powder);
  const water = toPositiveNumber(ratio.water);
  const weight = toPositiveNumber(powderWeight);
  if (!powder || !water || !weight) return 0;
  return roundValue((weight * water) / powder);
}

function isSameRecord(record = {}, recordId = '') {
  if (!recordId) return false;
  return record._id === recordId || record.id === recordId;
}

function componentSourceKey(component = {}) {
  if (component.kind === 'breast_milk') return 'breast_milk';
  if (component.kind === 'formula_powder' && component.powderId) return `powder:${component.powderId}`;
  return '';
}

// 按时间从新到旧收集曾经用过的奶来源 key，用于默认选中“最近用过的那种”。
function collectRecentSourceKeys(records = [], recentRecord = null) {
  const keys = [];
  const pushFromRecord = (record) => {
    (record?.formulaComponents || []).forEach((component) => {
      const key = componentSourceKey(component);
      if (key) keys.push(key);
    });
  };
  (records || []).forEach(pushFromRecord);
  if (recentRecord) pushFromRecord(recentRecord);
  return keys;
}

function showModalAsync(options = {}) {
  return new Promise((resolve) => {
    wxApi.showModal({
      ...options,
      success: resolve,
      fail: () => resolve({ confirm: false, cancel: true })
    });
  });
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
    // 当日来自食物 + 治疗的已摄入（奶之外的来源），与记录页当日汇总口径一致。
    otherIntake: { naturalProtein: 0, specialProtein: 0, calories: 0 },
    recentSourceKeys: [],
    fedMeals: 0,
    plannedMeals: DEFAULT_PLANNED_MEALS,

    calculationMode: 'protein',
    // 热量维度的优先策略：'natural' 天然优先（默认）/ 'special' 特殊优先。
    caloriePriority: 'natural',

    weight: '',
    weightEditing: false,
    weightDraft: '',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    coefficientTargetHints: {
      naturalProtein: '--',
      specialProtein: '--',
      calorie: '--'
    },

    selectedKeys: [],
    selectedSourcesText: '',
    multiSelect: false,
    expandedSourceGroup: '',
    sourceGroups: [],
    showSourcePopup: false,

    result: { ready: false, done: false, hint: '请先填写体重和系数', rows: [], totalVolume: 0 },
    perMeal: { hasRemaining: false, remainingMeals: 0, rows: [], note: '' },
    detailCards: [],
    intakeBreakdown: [],
    showDetailPanel: false
  },

  async onLoad(options = {}) {
    const selectedDate = options.date || formatDateKey();
    const babyUid = getBabyUid() || (getAppApi().globalData && getAppApi().globalData.babyUid) || '';
    const requestedMode = options.mode === 'calorie' || options.mode === 'protein'
      ? normalizeTargetMode(options.mode)
      : '';
    this._requestedModeFromUrl = requestedMode;
    if (wxApi.setNavigationBarTitle) {
      wxApi.setNavigationBarTitle({ title: '剩余奶量推荐' });
    }

    this.setData({
      babyUid,
      selectedDate,
      editingRecordId: options.recordId || options.id || '',
      ...(requestedMode ? { calculationMode: requestedMode } : {})
    });

    await this.loadPageData();
  },

  onShow() {
    // 从配奶设置页配置完奶粉返回时，只刷新奶粉档案，保留本次已选来源/已填系数。
    if (this._pendingPowderRefresh) {
      this._pendingPowderRefresh = false;
      this.reloadFormulaPowders();
    }
  },

  // 选奶弹窗内的引导入口：新用户没配过奶粉时分组无可选项，这里跳到配奶设置页去添加奶粉。
  goToManagePowders() {
    this._pendingPowderRefresh = true;
    wxApi.navigateTo({
      url: '/pkg-milk/nutrition-profile-settings/index?view=powders',
      fail: (err) => {
        this._pendingPowderRefresh = false;
        console.error('打开配奶设置页失败：', err);
      }
    });
  },

  // 仅刷新奶粉档案与依赖它的来源分组，不重置已选来源（selectedKeys）。
  async reloadFormulaPowders() {
    if (!this.data.babyUid) return;
    try {
      const settings = await getNutritionProfileSettings(this.data.babyUid, { includeLegacyFallback: false });
      const formulaPowders = this.enrichPlannerPowders(((settings && settings.formulaPowders) || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED));
      this.setData({
        nutritionSettings: settings || this.data.nutritionSettings,
        formulaPowders
      }, () => {
        this.rebuild();
      });
    } catch (error) {
      console.error('刷新奶粉档案失败：', error);
    }
  },

  async loadPageData() {
    if (!this.data.babyUid) {
      wxApi.showToast({ title: '缺少宝宝信息', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const [settings, basicInfo, records, recentRecord, foodIntakes, treatmentResult, recentDayMealCount] = await Promise.all([
        getNutritionProfileSettings(this.data.babyUid, { includeLegacyFallback: false }),
        resolveBasicInfoSnapshot(this.data.babyUid, this.data.selectedDate, {
          includeFallbacks: false,
          includeProfileInitial: true
        }),
        getV2RecordsByDate(this.data.babyUid, this.data.selectedDate),
        getRecentV2Record(this.data.babyUid, this.data.selectedDate).catch(() => null),
        getFoodIntakesByDate(this.data.babyUid, this.data.selectedDate).catch(() => []),
        getTreatmentsByDate(this.data.selectedDate, this.data.babyUid).catch(() => ({ data: [] })),
        getRecentDayMealCount(this.data.babyUid, this.data.selectedDate).catch(() => 0)
      ]);
      const editorSeed = this.getPreviousEditorSeed();
      const formulaPowderSource = (settings?.formulaPowders || []).length
        ? settings.formulaPowders
        : (editorSeed.formulaPowders || []);
      const formulaPowders = this.enrichPlannerPowders((formulaPowderSource || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED));
      const activeRecords = (records || []).filter((record) => !isSameRecord(record, this.data.editingRecordId));
      const basicInfoForPlanner = this.mergeBasicInfoWithEditorSeed(basicInfo, editorSeed);
      const recentSourceKeys = collectRecentSourceKeys(activeRecords, recentRecord);
      // 食物 + 治疗也是真实摄入，必须计入“已摄入”，否则剩余奶量会被高估。
      const otherIntake = computeOtherIntake(foodIntakes, (treatmentResult && treatmentResult.data) || []);
      // 系数优先用本地记住的目标值，没有再回退到档案/历史的快照值。
      const localTarget = readNutritionTargetPreferences(this.data.babyUid, wxApi);
      const preferredMode = this._requestedModeFromUrl
        || (localTarget.preferredTargetMode ? normalizeTargetMode(localTarget.preferredTargetMode) : this.data.calculationMode);
      // 默认计划顿数取“最近一天的喂奶顿数”；没有历史时回退到默认值。
      const plannedMeals = recentDayMealCount > 0
        ? Math.max(MIN_PLANNED_MEALS, Math.min(MAX_PLANNED_MEALS, recentDayMealCount))
        : DEFAULT_PLANNED_MEALS;

      this.setData({
        nutritionSettings: settings || {},
        formulaPowders,
        existingRecords: activeRecords,
        otherIntake,
        recentSourceKeys,
        plannedMeals,
        fedMeals: activeRecords.length,
        calculationMode: preferredMode,
        weight: formatInputValue(basicInfoForPlanner.weight),
        naturalProteinCoefficientInput: formatInputValue(pickCoefficient(localTarget.naturalProteinCoefficient, basicInfoForPlanner.naturalProteinCoefficient)),
        specialProteinCoefficientInput: formatInputValue(pickCoefficient(localTarget.specialProteinCoefficient, basicInfoForPlanner.specialProteinCoefficient)),
        calorieCoefficientInput: formatInputValue(pickCoefficient(localTarget.calorieCoefficient, basicInfoForPlanner.calorieCoefficient)),
        loading: false
      }, () => {
        this.setDefaultSelections();
      });
    } catch (error) {
      console.error('加载剩余奶量推荐失败：', error);
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

    // 统一按 母乳 → 普奶 → 特奶 → 能量粉 排序，保证各处展示顺序一致。
    return sortByDisplayOrder([breastSource, ...powderSources]);
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
    const milkConsumed = sumRecordNutrition(this.data.existingRecords || []);
    const other = this.data.otherIntake || { naturalProtein: 0, specialProtein: 0, calories: 0 };
    const emptyMacro = { naturalProtein: 0, specialProtein: 0, calories: 0 };
    const breakdown = {
      milk: milkConsumed,
      food: other.food || emptyMacro,
      treatment: other.treatment || emptyMacro
    };
    // 已摄入 = 奶 + 食物 + 治疗（与记录页当日汇总一致），不再只看奶。
    const consumed = {
      naturalProtein: roundValue(milkConsumed.naturalProtein + toPositiveNumber(other.naturalProtein)),
      specialProtein: roundValue(milkConsumed.specialProtein + toPositiveNumber(other.specialProtein)),
      calories: roundValue(milkConsumed.calories + toPositiveNumber(other.calories))
    };
    const remaining = {
      naturalProtein: Math.max(0, roundValue(targets.naturalProtein - consumed.naturalProtein)),
      specialProtein: Math.max(0, roundValue(targets.specialProtein - consumed.specialProtein)),
      calories: Math.max(0, roundValue(targets.calories - consumed.calories))
    };

    return { weight, targets, consumed, remaining, breakdown };
  },

  // ---- 缺口 → 单条来源的奶量/粉重 ----
  makeRow(source = {}, drinkingVolume = 0, powderWeight = 0) {
    const volume = roundValue(toPositiveNumber(drinkingVolume), 0);
    const weight = roundValue(toPositiveNumber(powderWeight), 1);
    let calories = 0;
    let naturalProtein = 0;
    let specialProtein = 0;

    if (source.kind === 'breast_milk') {
      const nutrition = source.nutritionPer100ml || {};
      const factor = volume / 100;
      naturalProtein = roundValue(toPositiveNumber(nutrition.protein) * factor);
      calories = roundValue(toPositiveNumber(nutrition.calories) * factor);
    } else {
      const nutrition = source.nutritionPer100g || {};
      const factor = weight / 100;
      const protein = roundValue(toPositiveNumber(nutrition.protein) * factor);
      if (source.role === 'special') {
        specialProtein = protein;
      } else if (source.role === 'natural') {
        naturalProtein = protein;
      }
      calories = roundValue(toPositiveNumber(nutrition.calories) * factor);
    }

    return {
      key: source.key,
      kind: source.kind,
      role: source.role,
      name: source.name,
      roleLabel: ROLE_LABELS[source.role] || '',
      categoryShortLabel: source.categoryShortLabel,
      categoryBadgeClass: source.categoryBadgeClass,
      categoryBadgeStyle: source.categoryBadgeStyle,
      volume,
      volumeText: `${volume} ml`,
      powderWeight: weight,
      powderText: source.kind === 'formula_powder' && weight > 0 ? `奶粉 ${weight} g` : '',
      calories,
      naturalProtein,
      specialProtein
    };
  },

  rowFromProtein(source = {}, proteinShare = 0) {
    const share = toPositiveNumber(proteinShare);
    if (source.kind === 'breast_milk') {
      const proteinPer100ml = toPositiveNumber(source.nutritionPer100ml?.protein);
      const volume = proteinPer100ml > 0 ? (share * 100) / proteinPer100ml : 0;
      return this.makeRow(source, volume, 0);
    }
    const proteinPer100g = toPositiveNumber(source.nutritionPer100g?.protein);
    const powderWeight = proteinPer100g > 0 ? (share * 100) / proteinPer100g : 0;
    const waterVolume = calculateWaterFromPowder(powderWeight, source.mixRatio);
    return this.makeRow(source, waterVolume, powderWeight);
  },

  rowFromCalorie(source = {}, calorieShare = 0) {
    const share = toPositiveNumber(calorieShare);
    if (source.kind === 'breast_milk') {
      const caloriesPer100ml = toPositiveNumber(source.nutritionPer100ml?.calories);
      const volume = caloriesPer100ml > 0 ? (share * 100) / caloriesPer100ml : 0;
      return this.makeRow(source, volume, 0);
    }
    const caloriesPer100g = toPositiveNumber(source.nutritionPer100g?.calories);
    const powderWeight = caloriesPer100g > 0 ? (share * 100) / caloriesPer100g : 0;
    const waterVolume = calculateWaterFromPowder(powderWeight, source.mixRatio);
    return this.makeRow(source, waterVolume, powderWeight);
  },

  buildProteinRows(sources = [], gap = 0) {
    const usable = (sources || []).filter((source) => this.sourceCanContribute(source, source.role));
    if (!usable.length) return [];
    const share = gap > 0 ? gap / usable.length : 0;
    return usable.map((source) => this.rowFromProtein(source, share));
  },

  buildCalorieFillRows(sources = [], calorieGap = 0) {
    const usable = (sources || []).filter((source) => this.sourceCanContribute(source, 'energy'));
    if (!usable.length) return [];
    const share = calorieGap > 0 ? calorieGap / usable.length : 0;
    return usable.map((source) => this.rowFromCalorie(source, share));
  },

  // 热量维度只按热量缺口计算；蛋白系数作为结果反推展示，不参与热量优先的输入门槛。
  buildCalorieRows(selectedSources = [], goalState = this.computeGoalState()) {
    return this.buildCalorieFillRows(selectedSources, goalState.remaining.calories);
  },

  // 按蛋白算时，反推这套方案的全天热量系数（v1 功能）：
  // 全天热量 = 已摄入(奶+食物+治疗) + 推荐补充的热量；系数 = 全天热量 / 体重。
  buildCalorieEstimate(goalState = this.computeGoalState(), rows = []) {
    if (this.data.calculationMode !== 'protein') return null;
    const weight = toPositiveNumber(goalState.weight);
    if (!weight) return null;
    const rowCalories = (rows || []).reduce((sum, row) => sum + toPositiveNumber(row.calories), 0);
    const totalCalories = roundValue(toPositiveNumber(goalState.consumed.calories) + rowCalories);
    if (totalCalories <= 0) return null;
    return {
      totalText: `${Math.round(totalCalories)} kcal`,
      coefText: `${roundValue(totalCalories / weight, 1)}`
    };
  },

  // 按热量算时，反推这套方案的全天天然/特殊蛋白系数：
  // 全天蛋白 = 已摄入(奶+食物) + 推荐补充的蛋白；系数 = 全天蛋白 / 体重。
  buildProteinEstimate(goalState = this.computeGoalState(), rows = []) {
    if (this.data.calculationMode !== 'calorie') return null;
    const weight = toPositiveNumber(goalState.weight);
    if (!weight) return null;
    const rowNatural = (rows || []).reduce((sum, row) => sum + toPositiveNumber(row.naturalProtein), 0);
    const rowSpecial = (rows || []).reduce((sum, row) => sum + toPositiveNumber(row.specialProtein), 0);
    const totalNatural = roundValue(toPositiveNumber(goalState.consumed.naturalProtein) + rowNatural);
    const totalSpecial = roundValue(toPositiveNumber(goalState.consumed.specialProtein) + rowSpecial);
    if (totalNatural <= 0 && totalSpecial <= 0) return null;
    return {
      naturalCoefText: `${roundValue(totalNatural / weight, 2)}`,
      specialCoefText: `${roundValue(totalSpecial / weight, 2)}`,
      naturalText: `${roundValue(totalNatural)} g`,
      specialText: `${roundValue(totalSpecial)} g`
    };
  },

  computeResult(goalState = this.computeGoalState()) {
    const mode = this.data.calculationMode;
    const emptyResult = { ready: false, done: false, hint: '', rows: [], totalVolume: 0, calorieEstimate: null, proteinEstimate: null };

    if (!goalState.weight) {
      return { ...emptyResult, hint: '请先填写体重' };
    }

    const naturalCoef = toPositiveNumber(this.data.naturalProteinCoefficientInput);
    const specialCoef = toPositiveNumber(this.data.specialProteinCoefficientInput);
    const calorieCoef = toPositiveNumber(this.data.calorieCoefficientInput);

    const selectedSet = new Set(this.data.selectedKeys || []);
    const selectedSources = this.getPlannerSources().filter((source) => selectedSet.has(source.key));

    let rows = [];
    let gapsRemaining = 0;

    if (mode === 'calorie') {
      if (!calorieCoef) return { ...emptyResult, hint: '请先填写热量系数' };
      gapsRemaining = goalState.remaining.calories;
      rows = this.buildCalorieRows(selectedSources, goalState);
    } else {
      if (!naturalCoef && !specialCoef) return { ...emptyResult, hint: '请先填写蛋白系数' };
      gapsRemaining = roundValue(goalState.remaining.naturalProtein + goalState.remaining.specialProtein);
      rows = [
        ...this.buildProteinRows(selectedSources.filter((source) => source.role === 'natural'), goalState.remaining.naturalProtein),
        ...this.buildProteinRows(selectedSources.filter((source) => source.role === 'special'), goalState.remaining.specialProtein)
      ];
    }

    if (gapsRemaining <= 0) {
      return { ready: true, done: true, hint: '今天的目标已经达成啦', rows: [], totalVolume: 0, calorieEstimate: this.buildCalorieEstimate(goalState, []), proteinEstimate: this.buildProteinEstimate(goalState, []) };
    }

    // 展示统一按 母乳 → 普奶 → 特奶 → 能量粉 排序（即使热量「特殊优先」先算特奶）。
    const positiveRows = sortByDisplayOrder(rows.filter((row) => toPositiveNumber(row.volume) > 0));
    if (!positiveRows.length) {
      return { ...emptyResult, hint: '请点右上角「更换奶粉」选择来源' };
    }

    const totalVolume = roundValue(positiveRows.reduce((sum, row) => sum + toPositiveNumber(row.volume), 0), 0);
    return { ready: true, done: false, hint: '', rows: positiveRows, totalVolume, calorieEstimate: this.buildCalorieEstimate(goalState, positiveRows), proteinEstimate: this.buildProteinEstimate(goalState, positiveRows) };
  },

  computePerMeal(result = this.data.result) {
    const fedMeals = toPositiveNumber(this.data.fedMeals);
    const plannedMeals = this.data.plannedMeals || DEFAULT_PLANNED_MEALS;
    const remainingMeals = Math.max(0, plannedMeals - fedMeals);

    if (!result.ready || result.done || !result.rows.length) {
      return { hasRemaining: false, remainingMeals, rows: [], note: '' };
    }

    if (remainingMeals <= 0) {
      return {
        hasRemaining: false,
        remainingMeals: 0,
        rows: [],
        note: `今日计划 ${plannedMeals} 顿已记录满，可增加计划顿数后查看每顿建议。`
      };
    }

    const rows = result.rows.map((row) => {
      const perVolume = roundValue(row.volume / remainingMeals, 0);
      const perPowder = roundValue(row.powderWeight / remainingMeals, 1);
      return {
        key: row.key,
        name: row.name,
        roleLabel: row.roleLabel,
        categoryShortLabel: row.categoryShortLabel,
        categoryBadgeClass: row.categoryBadgeClass,
        categoryBadgeStyle: row.categoryBadgeStyle,
        perVolumeText: `${perVolume} ml`,
        perPowderText: row.kind === 'formula_powder' && perPowder > 0 ? `奶粉 ${perPowder} g` : ''
      };
    });

    return {
      hasRemaining: true,
      remainingMeals,
      rows,
      note: `已喂 ${fedMeals} 顿，按计划 ${plannedMeals} 顿算，还剩 ${remainingMeals} 顿。`
    };
  },

  buildDetailCards(goalState = this.computeGoalState()) {
    const defs = this.data.calculationMode === 'calorie'
      ? [
        ['energy', '热量', 'calories', 'kcal']
      ]
      : [
        ['natural', '天然蛋白', 'naturalProtein', 'g'],
        ['special', '特殊蛋白', 'specialProtein', 'g']
      ];

    return defs.map(([key, title, field, unit]) => ({
      key,
      title,
      consumedText: formatDisplayValue(goalState.consumed[field], unit),
      consumedBreakdownText: this.buildConsumedBreakdownText(goalState.breakdown, field, unit),
      targetText: goalState.targets[field] ? formatDisplayValue(goalState.targets[field], unit) : `--${unit}`,
      remainingText: goalState.targets[field] ? formatDisplayValue(goalState.remaining[field], unit) : `--${unit}`,
      done: goalState.targets[field] > 0 && goalState.remaining[field] <= 0
    }));
  },

  // 把“已摄入”拆成 奶 / 食物 / 治疗 三个来源，仅当不止一个来源时才展示，
  // 让用户能直观看到计算依据不只看奶。
  buildConsumedBreakdownText(breakdown = {}, field = '', unit = '') {
    const sources = [
      ['奶', breakdown.milk],
      ['食物', breakdown.food],
      ['治疗', breakdown.treatment]
    ];
    const parts = sources
      .map(([label, macro]) => [label, toPositiveNumber(macro && macro[field])])
      .filter(([, value]) => value > 0)
      .map(([label, value]) => `${label} ${roundValue(value)}${unit}`);
    return parts.length > 1 ? parts.join(' · ') : '';
  },

  // 已摄入来源明细：逐个来源（奶/食物/治疗）列出热量与蛋白，方便核对计算依据。
  buildIntakeBreakdown(goalState = this.computeGoalState()) {
    const breakdown = goalState.breakdown || {};
    const defs = [
      ['奶', breakdown.milk],
      ['食物', breakdown.food],
      ['治疗', breakdown.treatment]
    ];
    return defs
      .map(([label, macro]) => {
        const item = macro || {};
        const calories = toPositiveNumber(item.calories);
        const protein = toPositiveNumber(item.protein) > 0
          ? toPositiveNumber(item.protein)
          : roundValue(toPositiveNumber(item.naturalProtein) + toPositiveNumber(item.specialProtein));
        return { label, calories, protein };
      })
      .filter((item) => item.calories > 0 || item.protein > 0)
      .map((item) => ({
        label: item.label,
        caloriesText: `${roundValue(item.calories)} kcal`,
        proteinText: `${roundValue(item.protein)} g`
      }));
  },

  buildSourceGroups() {
    const mode = this.data.calculationMode;
    const sources = this.getPlannerSources();
    const selectedSet = new Set(this.data.selectedKeys || []);
    const config = getGroupRoleConfig(mode, this.data.caloriePriority);

    return config.map((group) => {
      const options = sources
        .filter((source) => group.roles.includes(source.role) && this.sourceCanContribute(source, group.checkRole))
        .map((source) => ({
          key: source.key,
          groupKey: group.key,
          name: source.name,
          selected: selectedSet.has(source.key),
          categoryShortLabel: source.categoryShortLabel,
          categoryBadgeClass: source.categoryBadgeClass,
          categoryBadgeStyle: source.categoryBadgeStyle
        }));
      const selectedNames = options.filter((option) => option.selected).map((option) => option.name);

      return {
        key: group.key,
        label: group.label,
        hint: group.hint,
        optional: group.optional === true,
        expanded: this.data.expandedSourceGroup === group.key,
        options,
        // 可选分组（能量补充）默认不选，用“未添加（可选）”区别于必选组的“未选择”。
        selectedText: selectedNames.length
          ? selectedNames.join('、')
          : (group.optional ? '未添加（可选）' : '未选择'),
        hasOptions: options.length > 0
      };
    });
  },

  // 默认选中“最近用过的那种”奶来源：从近到远的记录里找；
  // 没有历史时，只有唯一来源才自动选，多种来源则留空让用户手动选（新用户场景）。
  setDefaultSelections() {
    const sources = this.getPlannerSources();
    const config = getGroupRoleConfig(this.data.calculationMode, this.data.caloriePriority);
    const recentKeys = this.data.recentSourceKeys || [];
    const keys = [];

    config.forEach((group) => {
      // 能量补充等可选分组默认不选，等用户手动添加。
      if (group.optional) return;
      const groupSources = sources.filter((source) => (
        group.roles.includes(source.role) && this.sourceCanContribute(source, group.checkRole)
      ));
      if (!groupSources.length) return;

      const groupKeySet = new Set(groupSources.map((source) => source.key));
      const recentKey = recentKeys.find((key) => groupKeySet.has(key));
      if (recentKey) {
        keys.push(recentKey);
      } else if (groupSources.length === 1) {
        keys.push(groupSources[0].key);
      }
      // 多种来源且无历史：不默认选，等用户手动选。
    });

    let expandedSourceGroup = this.data.expandedSourceGroup;
    if (!keys.length) {
      const firstWithOptions = config.find((group) => !group.optional && sources.some((source) => (
        group.roles.includes(source.role) && this.sourceCanContribute(source, group.checkRole)
      )));
      expandedSourceGroup = firstWithOptions ? firstWithOptions.key : '';
    }

    this.setData({ selectedKeys: keys, expandedSourceGroup }, () => {
      this.rebuild();
    });
  },

  rebuild() {
    const goalState = this.computeGoalState();
    const result = this.computeResult(goalState);
    const perMeal = this.computePerMeal(result);
    const detailCards = this.buildDetailCards(goalState);
    const intakeBreakdown = this.buildIntakeBreakdown(goalState);
    const sourceGroups = this.buildSourceGroups();
    const coefficientTargetHints = this.buildCoefficientTargetHints();
    const selectedSet = new Set(this.data.selectedKeys || []);
    const selectedSourcesText = this.getPlannerSources()
      .filter((source) => selectedSet.has(source.key))
      .map((source) => source.name)
      .join('、');

    this.setData({ result, perMeal, detailCards, intakeBreakdown, sourceGroups, coefficientTargetHints, selectedSourcesText });
  },

  buildCoefficientTargetHints() {
    const weight = toPositiveNumber(this.data.weight);
    const formatTarget = (coefficient, unit, precision = 1) => {
      const coef = toPositiveNumber(coefficient);
      if (!weight || !coef) return '--';
      return `${roundValue(weight * coef, precision)}${unit}`;
    };
    return {
      naturalProtein: formatTarget(this.data.naturalProteinCoefficientInput, 'g'),
      specialProtein: formatTarget(this.data.specialProteinCoefficientInput, 'g'),
      calorie: formatTarget(this.data.calorieCoefficientInput, 'kcal', 0)
    };
  },

  // ---- 交互 ----
  switchCalculationMode(e) {
    const mode = e.currentTarget.dataset.mode === 'calorie' ? 'calorie' : 'protein';
    if (mode === this.data.calculationMode) return;
    this.setData({
      calculationMode: mode,
      expandedSourceGroup: ''
    }, () => {
      this.saveLocalTargetCoefficients();
      this.setDefaultSelections();
    });
  },

  // 热量维度下切换“天然优先 / 特殊优先”：来源分组随之变化，重置选择并重新默认选中。
  switchCaloriePriority(e) {
    const priority = e.currentTarget.dataset.priority === 'special' ? 'special' : 'natural';
    if (priority === this.data.caloriePriority) return;
    this.setData({
      caloriePriority: priority,
      expandedSourceGroup: ''
    }, () => {
      this.setDefaultSelections();
    });
  },

  onCoefficientInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: e.detail.value }, () => {
      this.rebuild();
    });
  },

  onCoefficientBlur() {
    this.saveLocalTargetCoefficients();
  },

  // 仅本地保存目标系数，不落库、不影响记录页的真实数据汇总。
  saveLocalTargetCoefficients() {
    return writeNutritionTargetPreferences(this.data.babyUid, {
      naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
      specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
      calorieCoefficient: this.data.calorieCoefficientInput || '',
      preferredTargetMode: this.data.calculationMode === 'calorie' ? 'calorie' : 'protein'
    }, wxApi);
  },

  beginEditWeight() {
    this.setData({
      weightEditing: true,
      weightDraft: this.data.weight
    });
  },

  onWeightDraftInput(e) {
    this.setData({ weightDraft: e.detail.value });
  },

  cancelWeightEdit() {
    this.setData({ weightEditing: false, weightDraft: '' });
  },

  async confirmWeightEdit() {
    const nextWeight = toPositiveNumber(this.data.weightDraft);
    if (!nextWeight) {
      wxApi.showToast({ title: '请输入有效体重', icon: 'none' });
      return;
    }

    const res = await showModalAsync({
      title: '更新今日体重',
      content: `确定把今日体重改为 ${roundValue(nextWeight)} kg 吗？保存后会同步到体重记录。`,
      confirmText: '确定更新',
      cancelText: '再想想'
    });
    if (!res.confirm) return;

    this.setData({
      weight: `${roundValue(nextWeight)}`,
      weightEditing: false,
      weightDraft: ''
    }, () => {
      this.rebuild();
    });

    const saved = await this.persistGrowthRecord();
    wxApi.showToast({ title: saved ? '已同步到体重记录' : '本地已更新，同步失败', icon: 'none' });
  },

  // 只同步体重（真实测量值）到成长记录；系数不在此写入，避免和真实记录耦合。
  async persistGrowthRecord() {
    if (!this.data.babyUid) return false;
    const growthData = {
      weight: toPositiveNumber(this.data.weight) || '',
      openid: (getAppApi().globalData && getAppApi().globalData.openid) || ''
    };

    try {
      const result = await upsertGrowthRecordForDate(this.data.babyUid, this.data.selectedDate, growthData);
      if (result?.recordId) {
        this.setData({ growthRecordId: result.recordId });
      }
      // 体重改了要让当天汇总缓存失效，否则数据记录页会一直读旧的缓存体重。
      await markDailySummaryDirty(this.data.babyUid, this.data.selectedDate).catch(() => {});
      return true;
    } catch (error) {
      console.error('同步体重失败：', error);
      return false;
    }
  },

  changePlannedMeals(e) {
    const step = Number(e.currentTarget.dataset.step) || 0;
    const next = Math.max(MIN_PLANNED_MEALS, Math.min(MAX_PLANNED_MEALS, (this.data.plannedMeals || DEFAULT_PLANNED_MEALS) + step));
    if (next === this.data.plannedMeals) return;
    this.setData({ plannedMeals: next }, () => {
      this.setData({ perMeal: this.computePerMeal(this.data.result) });
    });
  },

  toggleSourceGroup(e) {
    const key = e.currentTarget.dataset.group;
    if (!key) return;
    this.setData({ expandedSourceGroup: this.data.expandedSourceGroup === key ? '' : key }, () => {
      this.setData({ sourceGroups: this.buildSourceGroups() });
    });
  },

  toggleMultiSelect() {
    this.setData({ multiSelect: !this.data.multiSelect });
  },

  openSourcePopup() {
    this.setData({ showSourcePopup: true });
  },

  closeSourcePopup() {
    this.setData({ showSourcePopup: false });
  },

  // 阻止弹窗内部点击穿透到遮罩层。
  noop() {},

  tapSource(e) {
    const key = e.currentTarget.dataset.key;
    const groupKey = e.currentTarget.dataset.group;
    if (!key || !groupKey) return;

    const config = getGroupRoleConfig(this.data.calculationMode, this.data.caloriePriority).find((group) => group.key === groupKey);
    if (!config) return;
    const groupSourceKeys = this.getPlannerSources()
      .filter((source) => config.roles.includes(source.role) && this.sourceCanContribute(source, config.checkRole))
      .map((source) => source.key);

    const optional = config.optional === true;
    const selectedSet = new Set(this.data.selectedKeys || []);

    if (this.data.multiSelect) {
      if (selectedSet.has(key)) {
        const selectedInGroup = groupSourceKeys.filter((item) => selectedSet.has(item));
        // 可选分组（能量补充）允许取消到一个不选；必选组每组至少保留一个。
        if (selectedInGroup.length <= 1 && !optional) return;
        selectedSet.delete(key);
      } else {
        selectedSet.add(key);
      }
    } else if (optional && selectedSet.has(key)) {
      // 可选分组单选模式下，再次点击同一项即取消选择。
      selectedSet.delete(key);
    } else {
      groupSourceKeys.forEach((item) => selectedSet.delete(item));
      selectedSet.add(key);
    }

    this.setData({ selectedKeys: Array.from(selectedSet) }, () => {
      this.rebuild();
    });
  },

  toggleDetailPanel() {
    this.setData({ showDetailPanel: !this.data.showDetailPanel });
  },

  goBack() {
    wxApi.navigateBack();
  }
});
