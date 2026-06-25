// 配奶设置模型
const {
  normalizeFormulaPowders,
  createLegacyFormulaPowders,
  normalizeMixingPlans
} = require('../utils/formulaPowderUtils');
const MilkNutritionProfileModel = require('./nutritionProfile');

const db = wx.cloud.database();
const babyInfoCollection = db.collection('baby_info');

class NutritionModel {
  constructor() {
    this.collection = babyInfoCollection;
  }

  normalizeSettings(settings = {}) {
    const ratioFallback = (ratio = {}, powderKey = 'powder', waterKey = 'water') => {
      return {
        powder: ratio.powder ?? ratio[powderKey] ?? '',
        water: ratio.water ?? ratio[waterKey] ?? ''
      };
    };
    const explicitPowders = normalizeFormulaPowders(settings.formulaPowders || []);
    const legacyPowders = createLegacyFormulaPowders(settings);
    const formulaPowders = explicitPowders.length > 0 ? explicitPowders : legacyPowders;
    const mixingPlans = normalizeMixingPlans(settings.mixingPlans || [], formulaPowders);
    const normalized = {
      natural_milk_protein: settings.natural_milk_protein ?? '',
      natural_milk_calories: settings.natural_milk_calories ?? '',
      natural_milk_fat: settings.natural_milk_fat ?? '',
      natural_milk_carbs: settings.natural_milk_carbs ?? '',
      natural_milk_fiber: settings.natural_milk_fiber ?? '',
      formula_milk_protein: settings.formula_milk_protein ?? '',
      formula_milk_calories: settings.formula_milk_calories ?? '',
      formula_milk_fat: settings.formula_milk_fat ?? '',
      formula_milk_carbs: settings.formula_milk_carbs ?? '',
      formula_milk_fiber: settings.formula_milk_fiber ?? '',
      formula_milk_ratio: ratioFallback(settings.formula_milk_ratio || settings, 'formula_milk_ratio_powder', 'formula_milk_ratio_water'),
      special_milk_protein: settings.special_milk_protein ?? '',
      special_milk_calories: settings.special_milk_calories ?? '',
      special_milk_fat: settings.special_milk_fat ?? '',
      special_milk_carbs: settings.special_milk_carbs ?? '',
      special_milk_fiber: settings.special_milk_fiber ?? '',
      special_milk_ratio: ratioFallback(settings.special_milk_ratio || settings, 'special_milk_ratio_powder', 'special_milk_ratio_water'),
      formulaPowders,
      mixingPlans,
      activeMixingPlanId: settings.activeMixingPlanId ?? ''
    };
    return normalized;
  }

  hasSettingsData(settings) {
    if (!settings) return false;
    const normalized = this.normalizeSettings(settings);
    if ((normalized.formulaPowders && normalized.formulaPowders.length > 0) ||
        (normalized.mixingPlans && normalized.mixingPlans.length > 0) ||
        normalized.activeMixingPlanId) {
      return true;
    }
    const scalarKeys = [
      'natural_milk_protein',
      'natural_milk_calories',
      'natural_milk_fat',
      'natural_milk_carbs',
      'natural_milk_fiber',
      'special_milk_protein',
      'special_milk_calories',
      'special_milk_fat',
      'special_milk_carbs',
      'special_milk_fiber',
      'formula_milk_protein',
      'formula_milk_calories',
      'formula_milk_fat',
      'formula_milk_carbs',
      'formula_milk_fiber'
    ];
    const hasScalar = scalarKeys.some(key => normalized[key] !== '' && normalized[key] !== undefined && normalized[key] !== null);
    const hasRatios = !!(
      normalized.formula_milk_ratio &&
      (normalized.formula_milk_ratio.powder || normalized.formula_milk_ratio.water) !== ''
    ) || !!(
      normalized.special_milk_ratio &&
      (normalized.special_milk_ratio.powder || normalized.special_milk_ratio.water) !== ''
    );
    return hasScalar || hasRatios;
  }
  
  isFormulaSettingsComplete(settings) {
    if (!settings) return false;
    const ratio = settings.formula_milk_ratio || {};
    return settings.formula_milk_protein !== '' && settings.formula_milk_calories !== '' && ratio.powder !== '' && ratio.water !== '';
  }
  
  /**
   * 创建默认配奶设置
   * @returns {object} 默认配奶设置
   */
  createDefaultSettings() {
    return {
      natural_milk_protein: 1.1,         // 母乳蛋白质含量 g/100ml
      natural_milk_calories: 67,         // 母乳能量 kcal/100ml
      natural_milk_fat: 4.0,             // 母乳脂肪 g/100ml
      natural_milk_carbs: 6.8,           // 母乳碳水 g/100ml
      natural_milk_fiber: 0,             // 母乳膳食纤维 g/100ml
      formula_milk_protein: '',
      formula_milk_calories: '',
      formula_milk_fat: '',
      formula_milk_carbs: '',
      formula_milk_fiber: '',
      formula_milk_ratio: {
        powder: '',
        water: ''
      },
      special_milk_protein: '',        // 特奶蛋白质含量 g/100g
      special_milk_calories: '',       // 特奶能量 kcal/100g
      special_milk_fat: '',
      special_milk_carbs: '',
      special_milk_fiber: '',
      special_milk_ratio: {
        powder: '',                    // 特奶粉量 g
        water: ''                        // 特奶水量 ml
      },
      formulaPowders: [],
      mixingPlans: [],
      activeMixingPlanId: ''
    };
  }

  /**
   * 获取用户的配奶设置，优先通过宝宝UID获取
   * @param {string} babyUid 宝宝UID
   * @returns {Promise<object>} 配奶设置信息
   */
  async getNutritionSettings(babyUid) {
    try {
      const profileSettings = await MilkNutritionProfileModel.getNutritionProfileSettings(babyUid, {
        includeLegacyFallback: true
      });
      if (profileSettings) {
        return this.normalizeSettings(profileSettings);
      }

      // 兜底：milk_nutrition_profiles 无档案时，从 baby_info.nutritionSettings 读取
      const babyRes = await this.collection.where({ babyUid }).get();
      const babyDoc = babyRes.data && babyRes.data[0];
      const babySettings = this.hasSettingsData(babyDoc?.nutritionSettings)
        ? this.normalizeSettings(babyDoc.nutritionSettings)
        : null;

      // 都没有则返回默认值
      if (!babySettings) {
        const defaultSettings = this.createDefaultSettings();
        if (babyDoc?._id) {
          await this.collection.doc(babyDoc._id).update({
            data: { nutritionSettings: defaultSettings, updatedAt: db.serverDate() }
          });
        }
        return defaultSettings;
      }

      return babySettings;
    } catch (err) {
      console.error('获取配奶设置失败：', err);
      return null;
    }
  }

  /**
   * 计算每日营养需求
   * @param {number} weight 体重(kg)
   * @param {Object} settings 配奶设置
   * @returns {Object} 计算结果
   */
  calculateDailyNutrition(weight, settings) {
    const coefficient = Number(settings?.natural_protein_coefficient);
    const naturalProtein = Number(settings?.natural_milk_protein);
    
    if (!weight || !coefficient || !naturalProtein) {
      return {
        dailyNaturalProtein: 0,
        naturalMilkVolume: 0,
        specialMilkVolume: 0,
        specialMilkPowder: 0,
        weight
      };
    }
    
    const dailyNaturalProtein = weight * coefficient;
    const naturalMilkVolume = (dailyNaturalProtein * 100) / naturalProtein;
    
    // 计算特奶量
    let specialMilkVolume = 0;
    let specialMilkPowder = 0;
    
    if (settings?.special_milk_ratio?.powder && settings?.special_milk_ratio?.water) {
      const ratio = settings.special_milk_ratio.powder / settings.special_milk_ratio.water;
      specialMilkPowder = naturalMilkVolume * ratio;
      specialMilkVolume = naturalMilkVolume;
    }
    
    return {
      dailyNaturalProtein,      // 每日所需天然蛋白量(g)
      naturalMilkVolume,        // 每日所需天然奶量(ml)
      specialMilkVolume,        // 每日所需特奶量(ml)
      specialMilkPowder,        // 每日所需特奶粉量(g)
      weight                    // 体重(kg)
    };
  }

  /**
   * 计算每顿特奶量
   * @param {number} totalMealVolume 每顿总奶量
   * @param {number} naturalMilkVolume 每顿母乳量
   * @returns {object} 特奶配置
   */
  calculateSpecialMilk(totalMealVolume, naturalMilkVolume) {
    const specialMilkVolume = totalMealVolume - naturalMilkVolume;
    if (specialMilkVolume <= 0) return null;

    // 根据特奶冲配比例计算特奶粉量
    const powderAmount = (specialMilkVolume / 90) * 13.5;
    
    return {
      specialMilkVolume, // 特奶液量（ml）
      powderAmount, // 特奶粉量（克）
      waterAmount: specialMilkVolume // 水量（ml）
    };
  }
}

// 修改导出方式，使用CommonJS模块导出
module.exports = new NutritionModel(); 
