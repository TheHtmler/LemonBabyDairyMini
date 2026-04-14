/**
 * 喂养相关工具函数
 * 用于处理喂养记录、计算特奶量等功能
 */

// 通用工具函数
const utils = {
  // 时间格式化
  formatTime(date = new Date()) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  },

  // 创建时间对象
  createTimeObject(timeStr) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const dateTime = new Date(now);
    dateTime.setHours(hours, minutes, 0, 0);
    return dateTime;
  },

  // 验证喂奶数据
  validateFeedingData(data) {
    const naturalMilk = parseFloat(data?.naturalMilkVolume) || 0;
    const total = calculator.getTotalVolume(data);

    if (total <= 0) {
      throw new Error('请填写所有必要信息');
    }

    if (isNaN(naturalMilk) || isNaN(total) || naturalMilk < 0 || total < 0) {
      throw new Error('请输入有效的奶量');
    }
    
    if (naturalMilk > total) {
      throw new Error('天然奶量不能大于总奶量');
    }
    
    return { naturalMilk, total };
  },

  // 验证时间数据
  validateTimeData(startTime, endTime) {
    if (!startTime || !endTime) {
      throw new Error('请选择完整的时间');
    }
    
    if (startTime >= endTime) {
      throw new Error('结束时间必须晚于开始时间');
    }
    
    return true;
  },

  // 成功提示
  showSuccess(message = '操作成功') {
    wx.showToast({
      title: message,
      icon: 'success'
    });
  }
};

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

// 计算相关的工具函数
const calculator = {
  roundValue(value, precision = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return 0;
    }
    const multiplier = Math.pow(10, precision);
    return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
  },

  // 计算特奶量和特奶粉
  calculateSpecialMilk(naturalMilkVolume, totalVolume, calculation_params) {
    const specialMilkVolume = Math.max(0, totalVolume - naturalMilkVolume);
    const specialMilkPowder = this.calculateSpecialMilkPowder(specialMilkVolume, calculation_params);
    
    return {
      specialMilkVolume: specialMilkVolume.toFixed(0),
      specialMilkPowder: specialMilkPowder.toFixed(1)
    };
  },

  // 计算特奶粉克重
  calculateSpecialMilkPowder(specialMilkVolume, calculation_params) {
    if (!calculation_params || !specialMilkVolume || specialMilkVolume <= 0) {
      return 0;
    }
    
    const params = calculation_params;
    if (!params.special_milk_ratio || !params.special_milk_ratio.powder || !params.special_milk_ratio.water) {
      return 0;
    }
    
    const ratio = params.special_milk_ratio.powder / params.special_milk_ratio.water;
    return this.roundValue(specialMilkVolume * ratio, 2);
  },

  getSpecialMilkVolume(feeding = {}) {
    const explicitSpecialVolume = Number.parseFloat(feeding.specialMilkVolume);
    if (Number.isFinite(explicitSpecialVolume) && explicitSpecialVolume >= 0) {
      return this.roundValue(explicitSpecialVolume, 2);
    }

    const naturalMilkVolume = Number.parseFloat(feeding.naturalMilkVolume);
    const totalVolume = Number.parseFloat(feeding.totalVolume);
    if (!Number.isFinite(totalVolume) || totalVolume <= 0) {
      return 0;
    }

    const naturalMilkValue = Number.isFinite(naturalMilkVolume) ? naturalMilkVolume : 0;
    return this.roundValue(Math.max(0, totalVolume - naturalMilkValue), 2);
  },

  getTotalVolume(feeding = {}) {
    const hasNaturalMilkVolume = hasValue(feeding.naturalMilkVolume);
    const hasSpecialMilkVolume = hasValue(feeding.specialMilkVolume);

    if (hasNaturalMilkVolume || hasSpecialMilkVolume) {
      const naturalMilkVolume = Number.parseFloat(feeding.naturalMilkVolume);
      const naturalMilkValue = Number.isFinite(naturalMilkVolume) ? naturalMilkVolume : 0;
      const specialMilkValue = this.getSpecialMilkVolume(feeding);
      return this.roundValue(naturalMilkValue + specialMilkValue, 2);
    }

    const storedTotalVolume = Number.parseFloat(feeding.totalVolume);
    if (Number.isFinite(storedTotalVolume) && storedTotalVolume >= 0) {
      return this.roundValue(storedTotalVolume, 2);
    }

    return 0;
  },

  getSpecialMilkPowder(feeding = {}, calculation_params) {
    const explicitPowder = Number.parseFloat(feeding.specialMilkPowder);
    if (Number.isFinite(explicitPowder) && explicitPowder > 0) {
      return this.roundValue(explicitPowder, 2);
    }

    const legacyPowder = Number.parseFloat(feeding.specialPowderWeight);
    if (Number.isFinite(legacyPowder) && legacyPowder > 0) {
      return this.roundValue(legacyPowder, 2);
    }

    const specialMilkVolume = this.getSpecialMilkVolume(feeding);
    if (specialMilkVolume <= 0) {
      return 0;
    }

    return this.calculateSpecialMilkPowder(specialMilkVolume, calculation_params);
  },

  // 计算每餐建议奶量
  calculateRecommendedVolume(weight, calculation_params, mealsPerDay = 8) {
    if (!weight || !calculation_params) {
      return { naturalMilk: '0', total: '0' };
    }

    const weightNum = parseFloat(weight);
    const proteinCoeff = parseFloat(calculation_params.natural_protein_coefficient);
    const proteinPer100ml = parseFloat(calculation_params.natural_milk_protein);

    if (!Number.isFinite(weightNum) || weightNum <= 0) {
      return { naturalMilk: '0', total: '0' };
    }
    if (!Number.isFinite(proteinCoeff) || proteinCoeff <= 0) {
      return { naturalMilk: '0', total: '0' };
    }
    if (!Number.isFinite(proteinPer100ml) || proteinPer100ml <= 0) {
      return { naturalMilk: '0', total: '0' };
    }

    const dailyNaturalProtein = weightNum * proteinCoeff;
    const naturalMilkNeeded = (dailyNaturalProtein * 100) / proteinPer100ml;
    const perFeedingNaturalMilk = naturalMilkNeeded / mealsPerDay;
    
    if (!Number.isFinite(perFeedingNaturalMilk) || perFeedingNaturalMilk <= 0) {
      return { naturalMilk: '0', total: '0' };
    }
    
    const roundedValue = Math.round(perFeedingNaturalMilk);
    const estimatedTotalVolume = Math.round(roundedValue * 1.5);
    
    return {
      naturalMilk: roundedValue.toString(),
      total: estimatedTotalVolume.toString()
    };
  }
};

// 数据管理工具
const dataManager = {
  // 更新喂奶数据
  updateFeedingData(context, type, field, value) {
    const typeMap = {
      current: 'currentFeeding',
      quick: 'quickFeedingData',
      new: 'newFeeding',
      edit: 'editingFeeding'
    };
    
    const dataKey = typeMap[type];
    if (!dataKey) return;
    
    const updateData = {};
    updateData[`${dataKey}.${field}`] = value;
    
    context.setData(updateData, () => {
      // 自动计算特奶量
      if (field === 'naturalMilkVolume' || field === 'totalVolume') {
        this.updateSpecialMilkForType(context, type);
      }
    });
  },

  // 为指定类型更新特奶量
  updateSpecialMilkForType(context, type) {
    const typeMap = {
      current: 'currentFeeding',
      quick: 'quickFeedingData',
      new: 'newFeeding',
      edit: 'editingFeeding'
    };
    
    const dataKey = typeMap[type];
    const feedingData = context.data[dataKey];
    
    if (!feedingData) return;
    
    const naturalMilk = parseFloat(feedingData.naturalMilkVolume) || 0;
    const total = parseFloat(feedingData.totalVolume) || 0;
    
    const { specialMilkVolume, specialMilkPowder } = calculator.calculateSpecialMilk(
      naturalMilk, total, context.data.calculation_params
    );
    
    const updateData = {};
    updateData[`${dataKey}.specialMilkVolume`] = specialMilkVolume;
    updateData[`${dataKey}.specialMilkPowder`] = specialMilkPowder;
    context.setData(updateData);
  }
};

// 模态框管理
const modalManager = {
  show(context, modalName) {
    const updateData = {};
    updateData[`show${modalName}Modal`] = true;
    context.setData(updateData);
  },

  hide(context, modalName) {
    const updateData = {};
    updateData[`show${modalName}Modal`] = false;
    context.setData(updateData);
  }
};

module.exports = {
  utils,
  calculator,
  dataManager,
  modalManager
}; 
