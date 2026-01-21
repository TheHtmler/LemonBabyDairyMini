// 配奶设置模型
const db = wx.cloud.database();
const nutritionCollection = db.collection('nutrition_settings');
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
      special_milk_ratio: ratioFallback(settings.special_milk_ratio || settings, 'special_milk_ratio_powder', 'special_milk_ratio_water')
    };
    return normalized;
  }

  hasSettingsData(settings) {
    if (!settings) return false;
    const normalized = this.normalizeSettings(settings);
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
  
  mergeFormulaSettings(primary, fallback) {
    if (!fallback) return primary;
    const pick = (first, second) => {
      // 优先非空的 second，否则用 first，再兜底空字符串
      return (second !== undefined && second !== null && second !== '') ? second : (first ?? '');
    };

    const merged = { ...primary };
    merged.formula_milk_protein = pick(merged.formula_milk_protein, fallback.formula_milk_protein);
    merged.formula_milk_calories = pick(merged.formula_milk_calories, fallback.formula_milk_calories);
    merged.formula_milk_fat = pick(merged.formula_milk_fat, fallback.formula_milk_fat);
    merged.formula_milk_carbs = pick(merged.formula_milk_carbs, fallback.formula_milk_carbs);
    merged.formula_milk_fiber = pick(merged.formula_milk_fiber, fallback.formula_milk_fiber);
    const fallbackRatio = fallback.formula_milk_ratio || {};
    const currentRatio = merged.formula_milk_ratio || {};
    merged.formula_milk_ratio = {
      powder: pick(currentRatio.powder, fallbackRatio.powder),
      water: pick(currentRatio.water, fallbackRatio.water)
    };
    return merged;
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
      }
    };
  }

  /**
   * 获取用户的配奶设置，优先通过宝宝UID获取
   * @param {string} babyUid 宝宝UID
   * @returns {Promise<object>} 配奶设置信息
   */
  async getNutritionSettings(babyUid) {
    try {
      // 1) 读取两个集合
      const [babyRes, compatRes] = await Promise.all([
        this.collection.where({ babyUid }).get(),
        nutritionCollection.where({ babyUid }).get()
      ]);

      const babyDoc = babyRes.data && babyRes.data[0];
      const compatDoc = compatRes.data && compatRes.data[0];

      const babySettings = this.hasSettingsData(babyDoc?.nutritionSettings)
        ? this.normalizeSettings(babyDoc.nutritionSettings)
        : null;
      const compatSettings = compatDoc ? this.normalizeSettings(compatDoc) : null;

      // 2) 选择主配置（优先新集合），并用另一个补全缺失的配方字段
      let merged = null;
      if (compatSettings && babySettings) {
        merged = this.mergeFormulaSettings(compatSettings, babySettings);
      } else if (compatSettings) {
        merged = compatSettings;
      } else if (babySettings) {
        merged = babySettings;
      }

      // 3) 如果都没有，返回默认值
      if (!merged) {
        const defaultSettings = this.createDefaultSettings();
        if (babyDoc?._id) {
          await this.collection.doc(babyDoc._id).update({
            data: { nutritionSettings: defaultSettings, updatedAt: db.serverDate() }
          });
        }
        return defaultSettings;
      }

      // 4) 写回 baby_info 以保持最新结构
      if (babyDoc?._id) {
        await this.collection.doc(babyDoc._id).update({
          data: {
            nutritionSettings: merged,
            updatedAt: db.serverDate()
          }
        });
      }

      return merged;
    } catch (err) {
      console.error('获取配奶设置失败：', err);
      return null;
    }
  }

  /**
   * 更新配奶设置
   * @param {string} babyUid 宝宝UID
   * @param {object} settings 配奶设置对象
   * @returns {Promise<boolean>} 是否成功
   */
  async updateNutritionSettings(babyUid, settings) {
    try {
      const normalizedSettings = this.normalizeSettings(settings);
      console.log(normalizedSettings, '---normalizedSettings---')
      const res = await this.collection.where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        await this.collection.doc(res.data[0]._id).update({
          data: {
            nutritionSettings: normalizedSettings,
            updatedAt: db.serverDate()
          }
        });
      }

      // 同步兼容表，方便旧版本及后台查看（即使 baby_info 中没有记录也保存）
      const compatRes = await nutritionCollection.where({
        babyUid: babyUid
      }).get();

      if (compatRes.data && compatRes.data.length > 0) {
        await nutritionCollection.doc(compatRes.data[0]._id).update({
          data: {
            ...normalizedSettings,
            babyUid: babyUid,
            updatedAt: db.serverDate()
          }
        });
      } else {
        await nutritionCollection.add({
          data: {
            ...normalizedSettings,
            babyUid: babyUid,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      }

      return true;
    } catch (err) {
      console.error('更新配奶设置失败：', err);
      return false;
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
