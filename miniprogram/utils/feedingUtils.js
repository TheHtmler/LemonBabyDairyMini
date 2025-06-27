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
    const { naturalMilkVolume, totalVolume } = data;
    
    if (!naturalMilkVolume || !totalVolume) {
      throw new Error('请填写所有必要信息');
    }
    
    const naturalMilk = parseFloat(naturalMilkVolume);
    const total = parseFloat(totalVolume);
    
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

// 计算相关的工具函数
const calculator = {
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
    return Math.round(specialMilkVolume * ratio * 10) / 10;
  },

  // 计算奶粉克重（普通奶粉）
  calculateFormulaPowderWeight(naturalMilkVolume, calculation_params, proteinSourceType) {
    if (proteinSourceType !== 'formulaMilk') {
      return 0;
    }
    
    if (!calculation_params?.formula_milk_ratio?.powder || !calculation_params?.formula_milk_ratio?.water) {
      return 0;
    }
    
    const ratio = calculation_params.formula_milk_ratio;
    const powderWeight = (naturalMilkVolume * ratio.powder) / ratio.water;
    return Math.round(powderWeight * 10) / 10;
  },

  // 计算每餐建议奶量
  calculateRecommendedVolume(weight, calculation_params, mealsPerDay = 8) {
    if (!weight || !calculation_params) {
      return { naturalMilk: '', total: '' };
    }
    
    const dailyNaturalProtein = weight * calculation_params.natural_protein_coefficient;
    const naturalMilkNeeded = (dailyNaturalProtein * 100) / calculation_params.natural_milk_protein;
    const perFeedingNaturalMilk = naturalMilkNeeded / mealsPerDay;
    
    if (perFeedingNaturalMilk <= 0) {
      return { naturalMilk: '', total: '' };
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
    
    // 如果是普通奶粉，还需要计算奶粉克重
    if (context.data.proteinSourceType === 'formulaMilk' && feedingData.naturalMilkVolume) {
      const formulaPowderWeight = calculator.calculateFormulaPowderWeight(
        naturalMilk, context.data.calculation_params, context.data.proteinSourceType
      );
      updateData[`${dataKey}.formulaPowderWeight`] = formulaPowderWeight;
    }
    
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