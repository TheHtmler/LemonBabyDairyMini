const NutritionModel = require('../../models/nutrition');
const { calculator: feedingCalculator } = require('../../utils/feedingUtils');
const { mergeTreatmentIntoMacroSummary } = require('../../utils/treatmentUtils');
const { findOrCreateDailyRecord } = require('../../utils/feedingRecordStore');
const { getBabyUid } = require('../../utils/index');

const app = getApp();

const NATURAL_MILK_CALORIES_PER_ML = 0.67;
const SPECIAL_MILK_CALORIES_PER_ML = 0.695;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_RATIO = {
  powder: 7,
  water: 100
};
const DEFAULT_SPECIAL_PROTEIN_PER_100ML = 1.97;

function formatTime(date = new Date()) {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function buildDateTimeFromDateKey(dateKey, timeText = '00:00') {
  const [hours, minutes] = String(timeText || '00:00').split(':').map(Number);
  const date = parseDateKey(dateKey);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function roundMacro(value) {
  return feedingCalculator.roundValue(value, 2);
}

function parseRecordTimestamp(feeding) {
  const raw = feeding?.startDateTime || feeding?.createdAt;
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRecordTimestamp(record = {}) {
  const raw = record?.updatedAt || record?.createdAt || record?.date;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInputValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return '';
  }
  return `${feedingCalculator.roundValue(num, 2)}`;
}

function toVolumeInputValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return '';
  }
  return `${Math.round(num)}`;
}

function normalizeVolumeInput(value) {
  const text = `${value ?? ''}`.trim();
  if (!text) {
    return '';
  }

  const num = Number(text);
  if (!Number.isFinite(num) || num < 0) {
    return '';
  }

  return `${Math.round(num)}`;
}

function formatRecentDefaultText(feeding) {
  const explicitTime = typeof feeding?.startTime === 'string' ? feeding.startTime.trim() : '';
  if (explicitTime) {
    return `已带入上次记录 ${explicitTime}`;
  }

  const timestamp = parseRecordTimestamp(feeding);
  if (!timestamp) {
    return '已带入上次记录';
  }

  return `已带入上次记录 ${formatTime(new Date(timestamp))}`;
}

function createEmptyMacroSummary() {
  return {
    calories: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    carbs: 0,
    fat: 0
  };
}

function createEmptyGoalSuggestion(mode = 'protein') {
  return {
    ready: false,
    error: '',
    mode,
    naturalProteinGap: 0,
    specialProteinGap: 0,
    calorieGap: 0,
    naturalVolume: 0,
    naturalPowderWeight: 0,
    specialVolume: 0,
    specialPowderWeight: 0,
    predictedCalorieCoefficient: '',
    predictedNaturalCoefficient: '',
    predictedSpecialCoefficient: '',
    naturalPriorityPlan: {
      naturalVolume: 0,
      naturalPowderWeight: 0,
      specialVolume: 0,
      specialPowderWeight: 0,
      predictedCalorieCoefficient: '',
      predictedNaturalCoefficient: '',
      predictedSpecialCoefficient: '',
      remainingNaturalCoefficientGap: 0,
      remainingSpecialCoefficientGap: 0
    },
    specialPriorityPlan: {
      naturalVolume: 0,
      naturalPowderWeight: 0,
      specialVolume: 0,
      specialPowderWeight: 0,
      predictedCalorieCoefficient: '',
      predictedNaturalCoefficient: '',
      predictedSpecialCoefficient: '',
      remainingNaturalCoefficientGap: 0,
      remainingSpecialCoefficientGap: 0
    }
  };
}

function roundNumber(value, precision = 2) {
  return feedingCalculator.roundValue(value, precision);
}

function roundCalories(value) {
  return Math.round(Number(value) || 0);
}

function isSameDay(left, right = new Date()) {
  const leftDate = left instanceof Date ? left : new Date(left);
  const rightDate = right instanceof Date ? right : new Date(right);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function getFormulaPowderWeight(feeding = {}, settings = {}) {
  return feedingCalculator.getFormulaMilkPowder(feeding, settings);
}

function getSpecialPowderWeight(feeding = {}, settings = {}) {
  return feedingCalculator.getSpecialMilkPowder(feeding, settings);
}

function calculateMilkNutritionSnapshot(feeding = {}, settings = {}) {
  const naturalMilkVolume = Number.parseFloat(feeding.naturalMilkVolume) || 0;
  const specialMilkVolume = feedingCalculator.getSpecialMilkVolume(feeding);
  const specialPowderWeight = getSpecialPowderWeight(feeding, settings);
  const formulaPowderWeight = getFormulaPowderWeight(feeding, settings);
  const naturalType = feeding.naturalMilkType === 'formula' ? 'formula' : 'breast';

  let naturalProtein = 0;
  let naturalCalories = 0;
  let naturalCarbs = 0;
  let naturalFat = 0;

  if (naturalType === 'formula') {
    const ratioPowder = Number(settings.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
    const ratioWater = Number(settings.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
    const powderWeight = formulaPowderWeight > 0
      ? formulaPowderWeight
      : (naturalMilkVolume > 0 && ratioPowder > 0 && ratioWater > 0
          ? naturalMilkVolume * ratioPowder / ratioWater
          : 0);
    const formulaProteinPer100g = Number(settings.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
    const formulaCaloriesPer100g = Number(settings.formula_milk_calories) || DEFAULT_FORMULA_MILK_CALORIES;
    const formulaCarbsPer100g = Number(settings.formula_milk_carbs) || 0;
    const formulaFatPer100g = Number(settings.formula_milk_fat) || 0;

    naturalProtein = (powderWeight * formulaProteinPer100g) / 100;
    naturalCalories = formulaCaloriesPer100g > 0
      ? (powderWeight * formulaCaloriesPer100g) / 100
      : naturalMilkVolume * NATURAL_MILK_CALORIES_PER_ML;
    naturalCarbs = (powderWeight * formulaCarbsPer100g) / 100;
    naturalFat = (powderWeight * formulaFatPer100g) / 100;
  } else {
    const naturalProteinPer100ml = Number(settings.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
    const naturalCaloriesPer100ml = Number(settings.natural_milk_calories) || NATURAL_MILK_CALORIES_PER_ML * 100;
    const naturalCarbsPer100ml = Number(settings.natural_milk_carbs) || 0;
    const naturalFatPer100ml = Number(settings.natural_milk_fat) || 0;

    naturalProtein = (naturalMilkVolume * naturalProteinPer100ml) / 100;
    naturalCalories = (naturalMilkVolume * naturalCaloriesPer100ml) / 100;
    naturalCarbs = (naturalMilkVolume * naturalCarbsPer100ml) / 100;
    naturalFat = (naturalMilkVolume * naturalFatPer100ml) / 100;
  }

  const specialProteinPer100g = Number(settings.special_milk_protein) || 0;
  const specialCaloriesPer100g = Number(settings.special_milk_calories) || 0;
  const specialCarbsPer100g = Number(settings.special_milk_carbs) || 0;
  const specialFatPer100g = Number(settings.special_milk_fat) || 0;

  const specialProtein = specialPowderWeight > 0 && specialProteinPer100g > 0
    ? (specialPowderWeight * specialProteinPer100g) / 100
    : 0;
  const specialCalories = specialPowderWeight > 0 && specialCaloriesPer100g > 0
    ? (specialPowderWeight * specialCaloriesPer100g) / 100
    : specialMilkVolume * SPECIAL_MILK_CALORIES_PER_ML;
  const specialCarbs = specialPowderWeight > 0 ? (specialPowderWeight * specialCarbsPer100g) / 100 : 0;
  const specialFat = specialPowderWeight > 0 ? (specialPowderWeight * specialFatPer100g) / 100 : 0;

  return {
    calories: roundCalories(naturalCalories + specialCalories),
    protein: roundNumber(naturalProtein + specialProtein, 2),
    naturalProtein: roundNumber(naturalProtein, 2),
    specialProtein: roundNumber(specialProtein, 2),
    carbs: roundNumber(naturalCarbs + specialCarbs, 2),
    fat: roundNumber(naturalFat + specialFat, 2)
  };
}

function calculateRecordMacroSummary(record = {}, settings = {}) {
  const summary = createEmptyMacroSummary();

  (record.intakes || []).forEach((intake) => {
    const nutrition = intake.nutrition || {};
    summary.calories += Number(nutrition.calories) || 0;
    summary.protein += Number(nutrition.protein) || 0;
    summary.naturalProtein += Number(intake.naturalProtein) || 0;
    summary.specialProtein += Number(intake.specialProtein) || 0;
    summary.carbs += Number(nutrition.carbs) || 0;
    summary.fat += Number(nutrition.fat) || 0;
  });

  (record.feedings || []).forEach((feeding) => {
    const nutrition = calculateMilkNutritionSnapshot(feeding, settings);
    summary.calories += nutrition.calories || 0;
    summary.protein += nutrition.protein || 0;
    summary.naturalProtein += nutrition.naturalProtein || 0;
    summary.specialProtein += nutrition.specialProtein || 0;
    summary.carbs += nutrition.carbs || 0;
    summary.fat += nutrition.fat || 0;
  });

  summary.calories = roundCalories(summary.calories);
  summary.protein = roundNumber(summary.protein, 2);
  summary.naturalProtein = roundNumber(summary.naturalProtein, 2);
  summary.specialProtein = roundNumber(summary.specialProtein, 2);
  summary.carbs = roundNumber(summary.carbs, 2);
  summary.fat = roundNumber(summary.fat, 2);

  return mergeTreatmentIntoMacroSummary(summary, record.treatmentRecords || []);
}

function hasBasicInfoValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function mergeBasicInfo(records = []) {
  return [...records]
    .sort((left, right) => getRecordTimestamp(right) - getRecordTimestamp(left))
    .reduce((merged, record) => {
      const basicInfo = record?.basicInfo || {};
      Object.keys(basicInfo).forEach((key) => {
        if (!hasBasicInfoValue(merged[key]) && hasBasicInfoValue(basicInfo[key])) {
          merged[key] = basicInfo[key];
        }
      });
      return merged;
    }, {});
}

function sortFeedingsByTimeDesc(feedings = []) {
  return [...feedings].sort((left, right) => {
    const diff = parseRecordTimestamp(right) - parseRecordTimestamp(left);
    if (diff !== 0) return diff;
    return String(right?.startTime || '').localeCompare(String(left?.startTime || ''));
  });
}

function mergeDailyRecords(records = [], settings = {}) {
  const mergedFeedings = records.flatMap((record) => record?.feedings || []);
  const mergedIntakes = records.flatMap((record) => record?.intakes || []);
  return {
    basicInfo: mergeBasicInfo(records),
    feedings: sortFeedingsByTimeDesc(mergedFeedings),
    intakes: mergedIntakes,
    treatmentRecords: records.flatMap((record) => record?.treatmentRecords || []),
    summary: calculateRecordMacroSummary({
      feedings: mergedFeedings,
      intakes: mergedIntakes,
      treatmentRecords: records.flatMap((record) => record?.treatmentRecords || [])
    }, settings)
  };
}

Page({
  data: {
    entryDate: formatDateKey(new Date()),
    editorMode: 'create',
    sourcePage: '',
    sourceFeedingIndex: -1,
    editingRecordId: '',
    editingFeedingIndex: -1,
    recordTime: formatTime(new Date()),
    notes: '',
    weight: app.globalData.weight || '',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    quickGoalTarget: 'protein',
    showGoalDialog: false,
    calculation_params: null,
    naturalMilkType: 'breast',
    naturalVolume: '',
    breastVolumeDraft: '',
    formulaVolumeDraft: '',
    formulaPowderWeight: '',
    formulaRatioMode: 'standard',
    formulaLastEditedField: 'water',
    specialVolume: '',
    specialPowderWeight: '',
    specialRatioMode: 'standard',
    specialLastEditedField: 'water',
    recentDefaultsLoaded: false,
    recentDefaultText: '',
    macroSummary: createEmptyMacroSummary(),
    quickGoalSuggestion: createEmptyGoalSuggestion(),
    formulaRatioDisplay: '',
    specialRatioDisplay: '',
    nutritionPreview: {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      naturalProtein: 0,
      specialProtein: 0
    }
  },

  async onLoad(options = {}) {
    const entryDate = options.date || formatDateKey(new Date());
    const editorMode = options.mode === 'edit' ? 'edit' : 'create';
    const sourcePage = options.source || options.from || '';
    const sourceFeedingIndex = Number.parseInt(options.index, 10);

    this.setData({
      entryDate,
      editorMode,
      sourcePage,
      sourceFeedingIndex: Number.isInteger(sourceFeedingIndex) ? sourceFeedingIndex : -1
    });

    if (typeof wx.setNavigationBarTitle === 'function') {
      wx.setNavigationBarTitle({
        title: editorMode === 'edit' ? '编辑奶' : '添加奶'
      });
    }

    await this.loadCalculationParams();
    if (editorMode === 'edit') {
      await this.loadEditContext();
    } else {
      await this.loadRecentDefaults();
    }
    await this.loadGoalContext();
    this.updateRatioDisplays();
    this.updateNutritionPreview();
    this.updateGoalSuggestion();
  },

  async loadCalculationParams() {
    const babyUid = getBabyUid();
    const defaultSettings = NutritionModel.createDefaultSettings();
    if (!babyUid) {
      this.setData({ calculation_params: defaultSettings });
      return;
    }

    const settings = await NutritionModel.getNutritionSettings(babyUid);
    this.setData({
      calculation_params: {
        ...defaultSettings,
        ...(settings || {}),
        formula_milk_ratio: {
          ...defaultSettings.formula_milk_ratio,
          ...(settings?.formula_milk_ratio || {})
        },
        special_milk_ratio: {
          ...defaultSettings.special_milk_ratio,
          ...(settings?.special_milk_ratio || {})
        }
      }
    });
  },

  async fetchRecordsForDate(dateKey = this.data.entryDate) {
    const babyUid = getBabyUid();
    if (!babyUid || !dateKey) return [];

    const db = wx.cloud.database();
    const startOfDay = buildDateTimeFromDateKey(dateKey, '00:00');
    const nextDay = new Date(startOfDay);
    nextDay.setDate(nextDay.getDate() + 1);

    let result = await db.collection('feeding_records').where({
      babyUid,
      date: db.command.gte(startOfDay).and(db.command.lt(nextDay))
    }).get();

    if (!result.data || result.data.length === 0) {
      result = await db.collection('feeding_records').where({
        babyUid,
        date: dateKey
      }).get();
    }

    return result.data || [];
  },

  resolveEditTarget(records = [], sourceIndex = this.data.sourceFeedingIndex) {
    if (!Array.isArray(records) || records.length === 0 || sourceIndex < 0) {
      return null;
    }

    const candidates = sortFeedingsByTimeDesc(
      records.flatMap((record) => (record.feedings || []).map((feeding, feedingIndex) => ({
        ...feeding,
        _recordId: record._id,
        _feedingIndex: feedingIndex
      })))
    );
    const target = candidates[sourceIndex];
    if (!target) return null;

    return {
      recordId: target._recordId,
      feedingIndex: target._feedingIndex,
      feeding: target
    };
  },

  async loadEditContext() {
    try {
      const records = await this.fetchRecordsForDate(this.data.entryDate);
      const settings = this.data.calculation_params || {};
      const target = this.resolveEditTarget(records, this.data.sourceFeedingIndex);
      if (!target) {
        wx.showToast({
          title: '未找到要编辑的奶记录',
          icon: 'none'
        });
        return;
      }

      const mergedRecord = mergeDailyRecords(records, settings);
      const feeding = target.feeding || {};
      const naturalMilkType = feeding.naturalMilkType === 'formula' ? 'formula' : 'breast';
      const naturalVolume = Number(feeding.naturalMilkVolume) > 0
        ? toVolumeInputValue(feeding.naturalMilkVolume)
        : '';
      const formulaRatioMode = feeding?.ratioMode?.natural === 'custom' ? 'custom' : 'standard';
      const specialRatioMode = feeding?.ratioMode?.special === 'custom' ? 'custom' : 'standard';
      const specialVolume = feedingCalculator.getSpecialMilkVolume(feeding);

      this.setData({
        editingRecordId: target.recordId,
        editingFeedingIndex: target.feedingIndex,
        recordTime: feeding.startTime || formatTime(buildDateTimeFromDateKey(this.data.entryDate)),
        notes: feeding.notes || '',
        naturalMilkType,
        naturalVolume,
        breastVolumeDraft: naturalMilkType === 'breast' ? naturalVolume : '',
        formulaVolumeDraft: naturalMilkType === 'formula' ? naturalVolume : '',
        formulaPowderWeight: naturalMilkType === 'formula'
          ? toInputValue(getFormulaPowderWeight(feeding, settings))
          : '',
        formulaRatioMode,
        formulaLastEditedField: formulaRatioMode === 'custom' ? 'powder' : 'water',
        specialVolume: specialVolume > 0 ? toVolumeInputValue(specialVolume) : '',
        specialPowderWeight: specialVolume > 0
          ? toInputValue(getSpecialPowderWeight(feeding, settings))
          : '',
        specialRatioMode,
        specialLastEditedField: specialRatioMode === 'custom' ? 'powder' : 'water',
        recentDefaultsLoaded: false,
        recentDefaultText: '',
        weight: mergedRecord.basicInfo?.weight || this.data.weight,
        naturalProteinCoefficientInput: mergedRecord.basicInfo?.naturalProteinCoefficient || '',
        specialProteinCoefficientInput: mergedRecord.basicInfo?.specialProteinCoefficient || '',
        calorieCoefficientInput: mergedRecord.basicInfo?.calorieCoefficient || ''
      });
    } catch (error) {
      console.error('加载编辑奶记录失败:', error);
      wx.showToast({
        title: '加载编辑数据失败',
        icon: 'none'
      });
    }
  },

  async loadRecentDefaults() {
    const babyUid = getBabyUid();
    if (!babyUid) return;

    try {
      const db = wx.cloud.database();
      const targetDate = buildDateTimeFromDateKey(this.data.entryDate, '00:00');
      const sevenDaysAgo = new Date(targetDate);
      sevenDaysAgo.setDate(targetDate.getDate() - 7);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const result = await db.collection('feeding_records')
        .where({
          babyUid,
          date: db.command.gte(sevenDaysAgo).and(db.command.lt(nextDay))
        })
        .orderBy('date', 'desc')
        .limit(8)
        .get();

      const recentFeedings = (result.data || [])
        .flatMap((record) => record.feedings || [])
        .sort((a, b) => parseRecordTimestamp(b) - parseRecordTimestamp(a));
      const latestFeeding = recentFeedings[0];

      if (!latestFeeding) return;

      const hasNaturalMilk = Number(latestFeeding.naturalMilkVolume) > 0;
      const hasSpecialMilk = Number(latestFeeding.specialMilkVolume) > 0;
      const naturalMilkType = latestFeeding.naturalMilkType === 'formula' ? 'formula' : 'breast';
      const naturalVolume = hasNaturalMilk ? toVolumeInputValue(latestFeeding.naturalMilkVolume) : '';
      const formulaRatioMode = latestFeeding?.ratioMode?.natural === 'custom' ? 'custom' : 'standard';
      const specialRatioMode = latestFeeding?.ratioMode?.special === 'custom' ? 'custom' : 'standard';
      const formulaPowderWeight = naturalMilkType === 'formula'
        ? toInputValue(
            latestFeeding.formulaPowderWeight || (
              formulaRatioMode === 'standard'
                ? this.calculatePowderFromWater(naturalVolume, 'formula')
                : 0
            )
          )
        : '';
      const specialVolume = hasSpecialMilk ? toVolumeInputValue(latestFeeding.specialMilkVolume) : '';
      const specialPowderWeight = hasSpecialMilk
        ? toInputValue(
            latestFeeding.specialMilkPowder || (
              specialRatioMode === 'standard'
                ? this.calculatePowderFromWater(specialVolume, 'special')
                : 0
            )
          )
        : '';

      this.setData({
        naturalMilkType,
        naturalVolume,
        breastVolumeDraft: naturalMilkType === 'breast' ? naturalVolume : '',
        formulaVolumeDraft: naturalMilkType === 'formula' ? naturalVolume : '',
        formulaPowderWeight,
        formulaRatioMode,
        formulaLastEditedField: formulaRatioMode === 'custom' ? 'powder' : 'water',
        specialVolume,
        specialPowderWeight,
        specialRatioMode,
        specialLastEditedField: specialRatioMode === 'custom' ? 'powder' : 'water',
        recentDefaultsLoaded: true,
        recentDefaultText: formatRecentDefaultText(latestFeeding)
      });
    } catch (error) {
      console.error('加载最近奶量默认值失败:', error);
    }
  },

  async loadGoalContext() {
    const babyUid = getBabyUid();
    const fallbackWeight = app.globalData.weight || '';

    if (!babyUid) {
      this.setData({
        weight: fallbackWeight,
        macroSummary: createEmptyMacroSummary()
      });
      return;
    }

    try {
      const db = wx.cloud.database();
      const targetDate = buildDateTimeFromDateKey(this.data.entryDate, '00:00');
      const sevenDaysAgo = new Date(targetDate);
      sevenDaysAgo.setDate(targetDate.getDate() - 7);
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const result = await db.collection('feeding_records')
        .where({
          babyUid,
          date: db.command.gte(sevenDaysAgo).and(db.command.lt(nextDay))
        })
        .orderBy('date', 'desc')
        .limit(7)
        .get();

      const records = result.data || [];
      const latestBasicInfo = records.find((record) => {
        const basicInfo = record?.basicInfo || {};
        return basicInfo.weight || basicInfo.naturalProteinCoefficient || basicInfo.specialProteinCoefficient || basicInfo.calorieCoefficient;
      });
      const sameDayRecords = records.filter((record) => formatDateKey(new Date(record?.date)) === this.data.entryDate);
      const mergedRecord = sameDayRecords.length > 0
        ? mergeDailyRecords(sameDayRecords, this.data.calculation_params || {})
        : null;
      const basicInfo = mergedRecord?.basicInfo || latestBasicInfo?.basicInfo || {};

      this.setData({
        weight: basicInfo.weight || fallbackWeight || '',
        naturalProteinCoefficientInput: basicInfo.naturalProteinCoefficient || '',
        specialProteinCoefficientInput: basicInfo.specialProteinCoefficient || '',
        calorieCoefficientInput: basicInfo.calorieCoefficient || '',
        macroSummary: mergedRecord
          ? calculateRecordMacroSummary(mergedRecord, this.data.calculation_params || {})
          : createEmptyMacroSummary()
      }, () => {
        this.updateGoalSuggestion();
      });
    } catch (error) {
      console.error('加载目标提示上下文失败:', error);
      this.setData({
        weight: fallbackWeight,
        macroSummary: createEmptyMacroSummary()
      }, () => {
        this.updateGoalSuggestion();
      });
    }
  },

  clearRecentDefaults() {
    this.setData({
      notes: '',
      naturalMilkType: 'breast',
      naturalVolume: '',
      breastVolumeDraft: '',
      formulaVolumeDraft: '',
      formulaPowderWeight: '',
      formulaRatioMode: 'standard',
      formulaLastEditedField: 'water',
      specialVolume: '',
      specialPowderWeight: '',
      specialRatioMode: 'standard',
      specialLastEditedField: 'water',
      recentDefaultsLoaded: false,
      recentDefaultText: ''
    }, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });
  },

  getCurrentRatio(kind) {
    const params = this.data.calculation_params || {};
    return kind === 'formula'
      ? params.formula_milk_ratio || {}
      : params.special_milk_ratio || {};
  },

  hasValidRatio(kind) {
    const ratio = this.getCurrentRatio(kind);
    return (Number(ratio.powder) || 0) > 0 && (Number(ratio.water) || 0) > 0;
  },

  promptMissingRatio(kind) {
    const milkLabel = kind === 'formula' ? '普奶' : '特奶';
    wx.showModal({
      title: '请先完善配比',
      content: `请先在配奶管理中填写完整的${milkLabel}标准配比。`,
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/nutrition-settings/index' });
        }
      }
    });
  },

  calculatePowderFromWater(volume, kind) {
    return feedingCalculator.calculatePowderFromWater(volume, this.getCurrentRatio(kind));
  },

  calculateWaterFromPowder(powderWeight, kind) {
    return feedingCalculator.calculateWaterFromPowder(powderWeight, this.getCurrentRatio(kind));
  },

  getEntryState() {
    const naturalVolumeNum = Number(this.data.naturalVolume) || 0;
    const formulaPowderWeightNum = Number(this.data.formulaPowderWeight) || 0;
    const specialVolumeNum = Number(this.data.specialVolume) || 0;
    const specialPowderWeightNum = Number(this.data.specialPowderWeight) || 0;
    const hasBreastMilk = this.data.naturalMilkType === 'breast' && naturalVolumeNum > 0;
    const hasFormulaMilk = this.data.naturalMilkType === 'formula' && (naturalVolumeNum > 0 || formulaPowderWeightNum > 0);
    const hasSpecialMilk = specialVolumeNum > 0 || specialPowderWeightNum > 0;
    const hasAnyMilk = hasBreastMilk || hasFormulaMilk || hasSpecialMilk;

    return {
      naturalVolumeNum,
      formulaPowderWeightNum,
      specialVolumeNum,
      specialPowderWeightNum,
      hasBreastMilk,
      hasFormulaMilk,
      hasSpecialMilk,
      hasAnyMilk
    };
  },

  getStandardFormulaFields(sourceField = 'powder') {
    if (sourceField === 'powder') {
      return {
        naturalVolume: this.data.formulaPowderWeight === ''
          ? ''
          : toVolumeInputValue(this.calculateWaterFromPowder(this.data.formulaPowderWeight, 'formula')),
        formulaPowderWeight: this.data.formulaPowderWeight,
        formulaLastEditedField: 'powder'
      };
    }

    return {
      naturalVolume: this.data.naturalVolume,
      formulaPowderWeight: this.data.naturalVolume === ''
        ? ''
        : `${this.calculatePowderFromWater(this.data.naturalVolume, 'formula')}`,
      formulaLastEditedField: 'water'
    };
  },

  getStandardSpecialFields(sourceField = 'powder') {
    if (sourceField === 'powder') {
      return {
        specialVolume: this.data.specialPowderWeight === ''
          ? ''
          : toVolumeInputValue(this.calculateWaterFromPowder(this.data.specialPowderWeight, 'special')),
        specialPowderWeight: this.data.specialPowderWeight,
        specialLastEditedField: 'powder'
      };
    }

    return {
      specialVolume: this.data.specialVolume,
      specialPowderWeight: this.data.specialVolume === ''
        ? ''
        : `${this.calculatePowderFromWater(this.data.specialVolume, 'special')}`,
      specialLastEditedField: 'water'
    };
  },

  updateRatioDisplays() {
    const formulaRatio = this.getCurrentRatio('formula');
    const specialRatio = this.getCurrentRatio('special');
    const formulaPowder = Number(formulaRatio.powder) || 0;
    const formulaWater = Number(formulaRatio.water) || 0;
    const specialPowder = Number(specialRatio.powder) || 0;
    const specialWater = Number(specialRatio.water) || 0;

    this.setData({
      formulaRatioDisplay: formulaPowder > 0 && formulaWater > 0
        ? `标准配比 ${formulaPowder}g : ${formulaWater}ml`
        : '请先在配奶管理中完善普奶标准配比',
      specialRatioDisplay: specialPowder > 0 && specialWater > 0
        ? `标准配比 ${specialPowder}g : ${specialWater}ml`
        : '请先在配奶管理中完善特奶标准配比'
    });
  },

  updateNutritionPreview() {
    const params = this.data.calculation_params || {};
    const {
      naturalVolumeNum,
      formulaPowderWeightNum,
      specialPowderWeightNum,
      hasBreastMilk,
      hasFormulaMilk,
      hasSpecialMilk
    } = this.getEntryState();
    let naturalProtein = 0;
    let specialProtein = 0;
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;

    if (hasBreastMilk) {
      naturalProtein = (naturalVolumeNum * (Number(params.natural_milk_protein) || 0)) / 100;
      calories += (naturalVolumeNum * (Number(params.natural_milk_calories) || 0)) / 100;
      carbs += (naturalVolumeNum * (Number(params.natural_milk_carbs) || 0)) / 100;
      fat += (naturalVolumeNum * (Number(params.natural_milk_fat) || 0)) / 100;
    } else if (hasFormulaMilk) {
      naturalProtein = (formulaPowderWeightNum * (Number(params.formula_milk_protein) || 0)) / 100;
      calories += (formulaPowderWeightNum * (Number(params.formula_milk_calories) || 0)) / 100;
      carbs += (formulaPowderWeightNum * (Number(params.formula_milk_carbs) || 0)) / 100;
      fat += (formulaPowderWeightNum * (Number(params.formula_milk_fat) || 0)) / 100;
    }

    if (hasSpecialMilk) {
      specialProtein = (specialPowderWeightNum * (Number(params.special_milk_protein) || 0)) / 100;
      calories += (specialPowderWeightNum * (Number(params.special_milk_calories) || 0)) / 100;
      carbs += (specialPowderWeightNum * (Number(params.special_milk_carbs) || 0)) / 100;
      fat += (specialPowderWeightNum * (Number(params.special_milk_fat) || 0)) / 100;
    }

    protein = naturalProtein + specialProtein;

    this.setData({
      nutritionPreview: {
        calories: Math.round(calories),
        protein: roundMacro(protein),
        carbs: roundMacro(carbs),
        fat: roundMacro(fat),
        naturalProtein: roundMacro(naturalProtein),
        specialProtein: roundMacro(specialProtein)
      }
    });
  },

  _getNaturalCaloriesPerMl() {
    const params = this.data.calculation_params || {};
    if (this.data.naturalMilkType === 'formula') {
      const ratioPowder = Number(params.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
      const ratioWater = Number(params.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
      const formulaCaloriesPer100g = Number(params.formula_milk_calories) || DEFAULT_FORMULA_MILK_CALORIES;
      if (ratioPowder > 0 && ratioWater > 0 && formulaCaloriesPer100g > 0) {
        return (ratioPowder * formulaCaloriesPer100g) / (ratioWater * 100);
      }
    }

    const naturalCaloriesPer100ml = Number(params.natural_milk_calories) || NATURAL_MILK_CALORIES_PER_ML * 100;
    return naturalCaloriesPer100ml > 0 ? naturalCaloriesPer100ml / 100 : NATURAL_MILK_CALORIES_PER_ML;
  },

  _getSpecialCaloriesPerMl() {
    const params = this.data.calculation_params || {};
    const ratioPowder = Number(params.special_milk_ratio?.powder) || 0;
    const ratioWater = Number(params.special_milk_ratio?.water) || 0;
    const specialCaloriesPer100g = Number(params.special_milk_calories) || 0;

    if (ratioPowder > 0 && ratioWater > 0 && specialCaloriesPer100g > 0) {
      return (ratioPowder * specialCaloriesPer100g) / (ratioWater * 100);
    }

    return SPECIAL_MILK_CALORIES_PER_ML;
  },

  _calculateSuggestedImpact(naturalVolume, specialVolume) {
    const naturalNutrition = calculateMilkNutritionSnapshot({
      naturalMilkVolume: naturalVolume,
      naturalMilkType: this.data.naturalMilkType,
      specialMilkVolume: 0,
      formulaPowderWeight: 0,
      specialMilkPowder: 0
    }, this.data.calculation_params || {});
    const specialNutrition = calculateMilkNutritionSnapshot({
      naturalMilkVolume: 0,
      naturalMilkType: this.data.naturalMilkType,
      specialMilkVolume: specialVolume,
      formulaPowderWeight: 0,
      specialMilkPowder: 0
    }, this.data.calculation_params || {});

    return {
      calories: roundCalories((naturalNutrition.calories || 0) + (specialNutrition.calories || 0)),
      naturalProtein: roundNumber(naturalNutrition.naturalProtein || 0, 2),
      specialProtein: roundNumber(specialNutrition.specialProtein || 0, 2)
    };
  },

  _calculateNaturalVolumeFromProtein(protein) {
    if (!protein || protein <= 0) return 0;
    const params = this.data.calculation_params || {};

    if (this.data.naturalMilkType === 'formula') {
      const ratioPowder = Number(params.formula_milk_ratio?.powder) || DEFAULT_FORMULA_RATIO.powder;
      const ratioWater = Number(params.formula_milk_ratio?.water) || DEFAULT_FORMULA_RATIO.water;
      const formulaProteinPer100g = Number(params.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
      if (ratioPowder > 0 && ratioWater > 0 && formulaProteinPer100g > 0) {
        return (protein * 100 * ratioWater) / (ratioPowder * formulaProteinPer100g);
      }
    }

    const naturalProteinPer100ml = Number(params.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
    return naturalProteinPer100ml > 0 ? (protein * 100) / naturalProteinPer100ml : 0;
  },

  _calculateSpecialVolumeFromProtein(protein) {
    if (!protein || protein <= 0) return 0;
    const params = this.data.calculation_params || {};
    const ratioPowder = Number(params.special_milk_ratio?.powder) || 0;
    const ratioWater = Number(params.special_milk_ratio?.water) || 0;
    const specialProteinPer100g = Number(params.special_milk_protein) || 0;

    if (specialProteinPer100g > 0 && ratioPowder > 0 && ratioWater > 0) {
      const powderWeight = (protein * 100) / specialProteinPer100g;
      return (powderWeight * ratioWater) / ratioPowder;
    }

    return (protein * 100) / DEFAULT_SPECIAL_PROTEIN_PER_100ML;
  },

  _calculateNaturalPowderFromVolume(volume) {
    if (!(volume > 0) || this.data.naturalMilkType !== 'formula' || !this.hasValidRatio('formula')) {
      return 0;
    }

    return roundNumber(this.calculatePowderFromWater(volume, 'formula'), 2);
  },

  _calculateSpecialPowderFromVolume(volume) {
    if (!(volume > 0) || !this.hasValidRatio('special')) {
      return 0;
    }

    return roundNumber(this.calculatePowderFromWater(volume, 'special'), 2);
  },

  updateGoalSuggestion() {
    const weight = Number.parseFloat(this.data.weight) || 0;
    const naturalCoef = Number.parseFloat(this.data.naturalProteinCoefficientInput) || 0;
    const specialCoef = Number.parseFloat(this.data.specialProteinCoefficientInput) || 0;
    const calorieCoef = Number.parseFloat(this.data.calorieCoefficientInput) || 0;
    const summary = this.data.macroSummary || createEmptyMacroSummary();
    const naturalConsumed = Number(summary.naturalProtein) || 0;
    const specialConsumed = Number(summary.specialProtein) || 0;
    const caloriesConsumed = Number(summary.calories) || 0;
    const mode = this.data.quickGoalTarget || 'protein';
    const suggestion = createEmptyGoalSuggestion(mode);

    if (weight <= 0) {
      suggestion.error = '请先完善体重';
      this.setData({
        quickGoalSuggestion: suggestion
      });
      return;
    }

    const hasProteinTarget = naturalCoef > 0 || specialCoef > 0;

    if (naturalCoef > 0) {
      suggestion.naturalProteinGap = Math.max(0, roundNumber(weight * naturalCoef - naturalConsumed, 2));
    }

    if (specialCoef > 0) {
      suggestion.specialProteinGap = Math.max(0, roundNumber(weight * specialCoef - specialConsumed, 2));
    }

    const naturalVolumeForProtein = suggestion.naturalProteinGap > 0
      ? this._calculateNaturalVolumeFromProtein(suggestion.naturalProteinGap)
      : 0;
    const specialVolumeForProtein = suggestion.specialProteinGap > 0
      ? this._calculateSpecialVolumeFromProtein(suggestion.specialProteinGap)
      : 0;

    if (mode === 'protein') {
      if (!hasProteinTarget) {
        suggestion.error = '请先填写蛋白系数';
      } else {
        suggestion.ready = true;
        suggestion.naturalVolume = Math.max(0, roundNumber(naturalVolumeForProtein, 0));
        suggestion.naturalPowderWeight = this._calculateNaturalPowderFromVolume(suggestion.naturalVolume);
        suggestion.specialVolume = Math.max(0, roundNumber(specialVolumeForProtein, 0));
        suggestion.specialPowderWeight = this._calculateSpecialPowderFromVolume(suggestion.specialVolume);
        const impact = this._calculateSuggestedImpact(suggestion.naturalVolume, suggestion.specialVolume);
        suggestion.predictedCalorieCoefficient = roundNumber((caloriesConsumed + (impact.calories || 0)) / weight, 1);
        suggestion.predictedNaturalCoefficient = roundNumber((naturalConsumed + (impact.naturalProtein || 0)) / weight, 2);
        suggestion.predictedSpecialCoefficient = roundNumber((specialConsumed + (impact.specialProtein || 0)) / weight, 2);
      }

      this.setData({
        quickGoalSuggestion: suggestion
      });
      return;
    }

    if (calorieCoef <= 0) {
      suggestion.error = '请先填写热量系数';
      this.setData({
        quickGoalSuggestion: suggestion
      });
      return;
    }

    suggestion.ready = true;
    suggestion.calorieGap = Math.max(0, roundCalories(weight * calorieCoef - caloriesConsumed));

    const naturalCaloriesPerMl = this._getNaturalCaloriesPerMl();
    const specialCaloriesPerMl = this._getSpecialCaloriesPerMl();
    const buildPlan = (naturalVolumeRaw, specialVolumeRaw) => {
      const safeNatural = Math.max(naturalVolumeRaw, 0);
      const safeSpecial = Math.max(specialVolumeRaw, 0);
      const impact = this._calculateSuggestedImpact(safeNatural, safeSpecial);
      const predictedNaturalCoefficient = roundNumber((naturalConsumed + (impact.naturalProtein || 0)) / weight, 2);
      const predictedSpecialCoefficient = roundNumber((specialConsumed + (impact.specialProtein || 0)) / weight, 2);
      return {
        naturalVolume: roundNumber(safeNatural, 0),
        naturalPowderWeight: this._calculateNaturalPowderFromVolume(safeNatural),
        specialVolume: roundNumber(safeSpecial, 0),
        specialPowderWeight: this._calculateSpecialPowderFromVolume(safeSpecial),
        predictedCalorieCoefficient: roundNumber((caloriesConsumed + (impact.calories || 0)) / weight, 1),
        predictedNaturalCoefficient,
        predictedSpecialCoefficient,
        remainingNaturalCoefficientGap: Math.max(0, roundNumber(naturalCoef - predictedNaturalCoefficient, 2)),
        remainingSpecialCoefficientGap: Math.max(0, roundNumber(specialCoef - predictedSpecialCoefficient, 2))
      };
    };

    const naturalBaseVolume = naturalVolumeForProtein;
    const naturalImpact = this._calculateSuggestedImpact(naturalBaseVolume, 0);
    const remainingCaloriesAfterNatural = weight * calorieCoef - caloriesConsumed - (naturalImpact.calories || 0);
    suggestion.naturalPriorityPlan = buildPlan(
      naturalBaseVolume,
      remainingCaloriesAfterNatural > 0 && specialCaloriesPerMl > 0
        ? remainingCaloriesAfterNatural / specialCaloriesPerMl
        : 0
    );

    const specialBaseVolume = specialVolumeForProtein;
    const specialImpact = this._calculateSuggestedImpact(0, specialBaseVolume);
    const remainingCaloriesAfterSpecial = weight * calorieCoef - caloriesConsumed - (specialImpact.calories || 0);
    suggestion.specialPriorityPlan = buildPlan(
      remainingCaloriesAfterSpecial > 0 && naturalCaloriesPerMl > 0
        ? remainingCaloriesAfterSpecial / naturalCaloriesPerMl
        : 0,
      specialBaseVolume
    );

    suggestion.naturalVolume = suggestion.naturalPriorityPlan.naturalVolume;
    suggestion.naturalPowderWeight = suggestion.naturalPriorityPlan.naturalPowderWeight;
    suggestion.specialVolume = suggestion.naturalPriorityPlan.specialVolume;
    suggestion.specialPowderWeight = suggestion.naturalPriorityPlan.specialPowderWeight;

    this.setData({
      quickGoalSuggestion: suggestion
    });
  },

  openGoalDialog() {
    this.setData({
      showGoalDialog: true
    }, () => {
      this.updateGoalSuggestion();
    });
  },

  closeGoalDialog() {
    this.setData({
      showGoalDialog: false
    });
  },

  noop() {
  },

  onGoalTargetChange(e) {
    const mode = e.currentTarget.dataset.mode || 'protein';
    if (mode === this.data.quickGoalTarget) return;
    this.setData({
      quickGoalTarget: mode
    }, () => {
      this.updateGoalSuggestion();
    });
  },

  onGoalCoefficientInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [field]: e.detail.value
    }, () => {
      this.updateGoalSuggestion();
    });
  },

  onTimeChange(e) {
    this.setData({ recordTime: e.detail.value });
  },

  onNaturalMilkTypeChange(e) {
    const naturalMilkType = e.currentTarget.dataset.kind;
    if (!naturalMilkType || naturalMilkType === this.data.naturalMilkType) return;

    const nextState = {
      naturalMilkType
    };

    if (this.data.naturalMilkType === 'breast') {
      nextState.breastVolumeDraft = this.data.naturalVolume;
    } else {
      nextState.formulaVolumeDraft = this.data.naturalVolume;
    }

    if (naturalMilkType === 'breast') {
      nextState.naturalVolume = this.data.breastVolumeDraft;
    } else {
      nextState.naturalVolume = this.data.formulaVolumeDraft;
    }

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });
  },

  onFormulaRatioModeChange(e) {
    const formulaRatioMode = e?.currentTarget?.dataset?.mode || e?.detail?.value;
    if (!formulaRatioMode || formulaRatioMode === this.data.formulaRatioMode) return;

    if (formulaRatioMode === 'standard' && !this.hasValidRatio('formula')) {
      this.promptMissingRatio('formula');
      return;
    }

    const nextState = {
      formulaRatioMode
    };

    if (formulaRatioMode === 'standard') {
      Object.assign(nextState, this.getStandardFormulaFields('powder'));
    }

    nextState.formulaVolumeDraft = nextState.naturalVolume ?? this.data.naturalVolume;

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });
  },

  onSpecialRatioModeChange(e) {
    const specialRatioMode = e?.currentTarget?.dataset?.mode || e?.detail?.value;
    if (!specialRatioMode || specialRatioMode === this.data.specialRatioMode) return;

    if (specialRatioMode === 'standard' && !this.hasValidRatio('special')) {
      this.promptMissingRatio('special');
      return;
    }

    const nextState = {
      specialRatioMode
    };

    if (specialRatioMode === 'standard') {
      Object.assign(nextState, this.getStandardSpecialFields('powder'));
    }

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });
  },

  handleNaturalVolumeInput(e) {
    const naturalVolume = normalizeVolumeInput(e.detail.value);
    const nextState = {
      naturalVolume
    };

    if (this.data.naturalMilkType === 'formula') {
      nextState.formulaVolumeDraft = naturalVolume;

      if (this.data.formulaRatioMode === 'standard') {
        nextState.formulaPowderWeight = naturalVolume === ''
          ? ''
          : `${this.calculatePowderFromWater(naturalVolume, 'formula')}`;
        nextState.formulaLastEditedField = 'water';
      }
    } else {
      nextState.breastVolumeDraft = naturalVolume;
    }

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });

    return naturalVolume;
  },

  handleSpecialVolumeInput(e) {
    const specialVolume = normalizeVolumeInput(e.detail.value);
    const nextState = {
      specialVolume
    };

    if (this.data.specialRatioMode === 'standard') {
      nextState.specialPowderWeight = specialVolume === ''
        ? ''
        : `${this.calculatePowderFromWater(specialVolume, 'special')}`;
      nextState.specialLastEditedField = 'water';
    }

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });

    return specialVolume;
  },

  handleFormulaPowderInput(e) {
    const formulaPowderWeight = e.detail.value;
    const nextState = {
      formulaPowderWeight
    };

    if (this.data.formulaRatioMode === 'standard') {
      nextState.naturalVolume = formulaPowderWeight === ''
        ? ''
        : toVolumeInputValue(this.calculateWaterFromPowder(formulaPowderWeight, 'formula'));
      nextState.formulaLastEditedField = 'powder';
    }

    nextState.formulaVolumeDraft = nextState.naturalVolume ?? this.data.naturalVolume;

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });
  },

  handleSpecialPowderInput(e) {
    const specialPowderWeight = e.detail.value;
    const nextState = {
      specialPowderWeight
    };

    if (this.data.specialRatioMode === 'standard') {
      nextState.specialVolume = specialPowderWeight === ''
        ? ''
        : toVolumeInputValue(this.calculateWaterFromPowder(specialPowderWeight, 'special'));
      nextState.specialLastEditedField = 'powder';
    }

    this.setData(nextState, () => {
      this.updateNutritionPreview();
      this.updateGoalSuggestion();
    });
  },

  onNotesInput(e) {
    this.setData({ notes: e.detail.value });
  },

  ensureSettingsReady() {
    const params = this.data.calculation_params || {};
    const {
      hasAnyMilk,
      hasBreastMilk,
      hasFormulaMilk,
      hasSpecialMilk
    } = this.getEntryState();

    if (!hasAnyMilk) {
      wx.showToast({
        title: '请至少填写一种奶',
        icon: 'none'
      });
      return false;
    }

    if (hasBreastMilk && !(Number(params.natural_milk_protein) > 0)) {
      wx.showToast({
        title: '请先完善母乳营养参数',
        icon: 'none'
      });
      return false;
    }

    if (hasFormulaMilk) {
      if (this.data.formulaRatioMode === 'standard' && !this.hasValidRatio('formula')) {
        this.promptMissingRatio('formula');
        return false;
      }
      if (!(Number(params.formula_milk_protein) > 0)) {
        wx.showToast({
          title: '请先完善普奶营养参数',
          icon: 'none'
        });
        return false;
      }
    }

    if (hasSpecialMilk) {
      if (this.data.specialRatioMode === 'standard' && !this.hasValidRatio('special')) {
        this.promptMissingRatio('special');
        return false;
      }
      if (!(Number(params.special_milk_protein) > 0)) {
        wx.showToast({
          title: '请先完善特奶营养参数',
          icon: 'none'
        });
        return false;
      }
    }

    return true;
  },

  async saveFeeding() {
    if (!this.ensureSettingsReady()) {
      return;
    }

    const {
      naturalVolumeNum,
      formulaPowderWeightNum,
      specialVolumeNum,
      specialPowderWeightNum,
      hasBreastMilk,
      hasFormulaMilk,
      hasSpecialMilk
    } = this.getEntryState();

    if (!this.data.recordTime) {
      wx.showToast({
        title: '请填写时间',
        icon: 'none'
      });
      return;
    }

    if (hasFormulaMilk && naturalVolumeNum <= 0) {
      wx.showToast({
        title: '请填写普奶水量',
        icon: 'none'
      });
      return;
    }

    if (hasFormulaMilk && formulaPowderWeightNum <= 0) {
      wx.showToast({
        title: '请填写普奶粉重',
        icon: 'none'
      });
      return;
    }

    if (hasSpecialMilk && specialVolumeNum <= 0) {
      wx.showToast({
        title: '请填写特奶水量',
        icon: 'none'
      });
      return;
    }

    if (hasSpecialMilk && specialPowderWeightNum <= 0) {
      wx.showToast({
        title: '请填写特奶粉重',
        icon: 'none'
      });
      return;
    }

    if (this.data.naturalMilkType === 'breast' && !hasBreastMilk && !hasFormulaMilk && !hasSpecialMilk) {
      wx.showToast({
        title: '请填写天然奶体积',
        icon: 'none'
      });
      return;
    }

    const babyUid = getBabyUid();
    if (!babyUid) {
      wx.showToast({
        title: '未找到宝宝信息',
        icon: 'none'
      });
      return;
    }

    const dateKey = this.data.entryDate || formatDateKey(new Date());
    const basicInfo = {
      weight: this.data.weight || app.globalData.weight || '',
      naturalProteinCoefficient: this.data.naturalProteinCoefficientInput || '',
      specialProteinCoefficient: this.data.specialProteinCoefficientInput || '',
      calorieCoefficient: this.data.calorieCoefficientInput || ''
    };
    const startDateTime = buildDateTimeFromDateKey(dateKey, this.data.recordTime);

    const feeding = {
      startTime: this.data.recordTime,
      endTime: '',
      startDateTime,
      endDateTime: null,
      ratioMode: {
        natural: hasFormulaMilk
          ? this.data.formulaRatioMode
          : (hasBreastMilk ? 'breast' : 'none'),
        special: hasSpecialMilk
          ? this.data.specialRatioMode
          : 'none'
      },
      naturalMilkType: this.data.naturalMilkType,
      naturalMilkVolume: (hasBreastMilk || hasFormulaMilk) ? Math.round(naturalVolumeNum) : 0,
      formulaPowderWeight: hasFormulaMilk
        ? feedingCalculator.roundValue(formulaPowderWeightNum, 2)
        : 0,
      specialMilkVolume: hasSpecialMilk ? Math.round(specialVolumeNum) : 0,
      specialMilkPowder: hasSpecialMilk
        ? feedingCalculator.roundValue(specialPowderWeightNum, 2)
        : 0,
      totalVolume: Math.round(naturalVolumeNum + specialVolumeNum),
      notes: (this.data.notes || '').trim()
    };

    try {
      wx.showLoading({ title: '保存中...' });
      const db = wx.cloud.database();
      if (this.data.editorMode === 'edit') {
        const records = await this.fetchRecordsForDate(dateKey);
        let targetRecord = records.find((record) => record._id === this.data.editingRecordId) || null;
        let targetFeedingIndex = this.data.editingFeedingIndex;

        if (!targetRecord || targetFeedingIndex < 0) {
          const resolvedTarget = this.resolveEditTarget(records, this.data.sourceFeedingIndex);
          if (resolvedTarget) {
            targetRecord = records.find((record) => record._id === resolvedTarget.recordId) || null;
            targetFeedingIndex = resolvedTarget.feedingIndex;
          }
        }

        if (!targetRecord || targetFeedingIndex < 0) {
          throw new Error('未找到要更新的奶记录');
        }

        const updatedFeedings = [...(targetRecord.feedings || [])];
        const previousFeeding = updatedFeedings[targetFeedingIndex] || {};
        updatedFeedings[targetFeedingIndex] = {
          ...previousFeeding,
          ...feeding,
          babyUid: previousFeeding.babyUid || babyUid,
          createdAt: previousFeeding.createdAt || new Date()
        };

        await db.collection('feeding_records').doc(targetRecord._id).update({
          data: {
            'basicInfo.weight': basicInfo.weight,
            'basicInfo.naturalProteinCoefficient': basicInfo.naturalProteinCoefficient,
            'basicInfo.specialProteinCoefficient': basicInfo.specialProteinCoefficient,
            'basicInfo.calorieCoefficient': basicInfo.calorieCoefficient,
            feedings: updatedFeedings,
            updatedAt: db.serverDate()
          }
        });
      } else {
        const { recordId } = await findOrCreateDailyRecord(dateKey, babyUid, basicInfo);
        await db.collection('feeding_records').doc(recordId).update({
          data: {
            'basicInfo.weight': basicInfo.weight,
            'basicInfo.naturalProteinCoefficient': basicInfo.naturalProteinCoefficient,
            'basicInfo.specialProteinCoefficient': basicInfo.specialProteinCoefficient,
            'basicInfo.calorieCoefficient': basicInfo.calorieCoefficient,
            feedings: db.command.push({
              ...feeding,
              babyUid,
              createdAt: new Date()
            }),
            updatedAt: db.serverDate()
          }
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
      wx.navigateBack();
    } catch (error) {
      console.error('保存奶量记录失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  onCancel() {
    wx.navigateBack();
  }
});
