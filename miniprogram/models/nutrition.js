// 营养设置模型
const db = wx.cloud.database();
const nutritionCollection = db.collection('nutrition_settings');
const babyInfoCollection = db.collection('baby_info');

class NutritionModel {
  constructor() {
    this.collection = babyInfoCollection;
  }

  /**
   * 创建默认营养设置
   * @returns {object} 默认营养设置
   */
  createDefaultSettings() {
    return {
      natural_protein_coefficient: 1.2,  // 天然蛋白系数 g/kg
      natural_milk_protein: 1.1,         // 母乳蛋白质含量 g/100ml
      special_milk_protein: 13.1,        // 特奶蛋白质含量 g/100g
      special_milk_ratio: {
        powder: 13.5,                    // 特奶粉量 g
        water: 90                        // 特奶水量 ml
      }
    };
  }

  /**
   * 获取用户的营养设置，优先通过宝宝UID获取
   * @param {string} babyUid 宝宝UID
   * @returns {Promise<object>} 营养设置信息
   */
  async getNutritionSettings(babyUid) {
    try {
      const res = await this.collection.where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        const babyInfo = res.data[0];
        // 如果没有营养设置，创建默认设置
        if (!babyInfo.nutritionSettings) {
          const defaultSettings = this.createDefaultSettings();
          await this.updateNutritionSettings(babyUid, defaultSettings);
          return defaultSettings;
        }
        return babyInfo.nutritionSettings;
      }
      return null;
    } catch (err) {
      console.error('获取营养设置失败：', err);
      return null;
    }
  }

  /**
   * 更新营养设置
   * @param {string} babyUid 宝宝UID
   * @param {object} settings 营养设置对象
   * @returns {Promise<boolean>} 是否成功
   */
  async updateNutritionSettings(babyUid, settings) {
    try {
      const res = await this.collection.where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        await this.collection.doc(res.data[0]._id).update({
          data: {
            nutritionSettings: settings,
            updatedAt: db.serverDate()
          }
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('更新营养设置失败：', err);
      return false;
    }
  }

  /**
   * 计算每日营养需求
   * @param {number} weight 体重(kg)
   * @param {Object} settings 营养设置
   * @param {string} proteinSourceType 蛋白质来源类型，可选值为'breastMilk'或'formulaMilk'
   * @returns {Object} 计算结果
   */
  calculateDailyNutrition(weight, settings, proteinSourceType = 'breastMilk') {
    // 计算每日所需天然蛋白量
    const dailyNaturalProtein = weight * settings.natural_protein_coefficient;
    
    // 计算所需天然奶量
    const naturalMilkVolume = (dailyNaturalProtein * 100) / settings.natural_milk_protein;
    
    // 计算特奶量
    let specialMilkVolume = 0;
    let specialMilkPowder = 0;
    
    if (settings.special_milk_ratio) {
      const ratio = settings.special_milk_ratio.powder / settings.special_milk_ratio.water;
      specialMilkPowder = naturalMilkVolume * ratio;
      specialMilkVolume = naturalMilkVolume;
    }
    
    // 如果是奶粉，计算奶粉用量
    let formulaMilkPowder = 0;
    if (proteinSourceType === 'formulaMilk' && settings.formula_milk_ratio) {
      const ratio = settings.formula_milk_ratio.powder / settings.formula_milk_ratio.water;
      formulaMilkPowder = naturalMilkVolume * ratio;
    }
    
    return {
      dailyNaturalProtein,      // 每日所需天然蛋白量(g)
      naturalMilkVolume,        // 每日所需天然奶量(ml)
      specialMilkVolume,        // 每日所需特奶量(ml)
      specialMilkPowder,        // 每日所需特奶粉量(g)
      formulaMilkPowder,        // 每日所需奶粉量(g)
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