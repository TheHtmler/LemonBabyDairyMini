// pages/data-analysis/index.js
const NutritionModel = require('../../models/nutrition');

// 母乳热量 67kcal/100ml
// 特奶热量 69.5kcal/100ml
const BREAST_MILK_KCAL = 0.67;
const SPECIAL_MILK_KCAL = 0.70;
const DEFAULT_BREAST_MILK_PROTEIN = 1.1;
const DEFAULT_FORMULA_MILK_PROTEIN = 2.1;
const DEFAULT_FORMULA_MILK_CALORIES = 0;
const DEFAULT_SPECIAL_MILK_PROTEIN = 13.1;
const DEFAULT_SPECIAL_MILK_PROTEIN_ML = 1.97;

function roundNumber(value, precision = 2) {
  if (isNaN(value)) return 0;
  const multiplier = Math.pow(10, precision);
  return Math.round(value * multiplier) / multiplier;
}

function roundCalories(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round(num);
}

function calculateFormulaPowder(naturalMilkVolume, nutritionSettings = {}) {
  if (!naturalMilkVolume || naturalMilkVolume <= 0) {
    return 0;
  }
  const ratioPowder = Number(nutritionSettings.formula_milk_ratio?.powder);
  const ratioWater = Number(nutritionSettings.formula_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) {
    return 0;
  }
  return Math.round((naturalMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function calculateSpecialMilkPowder(specialMilkVolume, nutritionSettings = {}) {
  if (!specialMilkVolume || specialMilkVolume <= 0) {
    return 0;
  }
  const ratioPowder = Number(nutritionSettings.special_milk_ratio?.powder);
  const ratioWater = Number(nutritionSettings.special_milk_ratio?.water);
  if (!ratioPowder || !ratioWater) {
    return 0;
  }
  return Math.round((specialMilkVolume * ratioPowder / ratioWater) * 10) / 10;
}

function calculateMilkNutrition(feeding, nutritionSettings = {}) {
  const naturalMilkVolume = parseFloat(feeding.naturalMilkVolume) || 0;
  const specialMilkVolume = parseFloat(feeding.specialMilkVolume) || 0;
  const specialPowderWeight = parseFloat(feeding.specialMilkPowder) || 0;
  const naturalMilkType = feeding.naturalMilkType || 'breast';

  let naturalProtein = 0;
  let naturalCalories = naturalMilkVolume * BREAST_MILK_KCAL;
  if (naturalMilkType === 'formula') {
    const powderWeight = calculateFormulaPowder(naturalMilkVolume, nutritionSettings);
    const formulaProteinPer100g = Number(nutritionSettings.formula_milk_protein) || DEFAULT_FORMULA_MILK_PROTEIN;
    if (powderWeight > 0 && formulaProteinPer100g > 0) {
      naturalProtein = (powderWeight * formulaProteinPer100g) / 100;
      const formulaCaloriesPer100g = Number(nutritionSettings.formula_milk_calories) || DEFAULT_FORMULA_MILK_CALORIES;
      if (formulaCaloriesPer100g) {
        naturalCalories = (powderWeight * formulaCaloriesPer100g) / 100;
      }
    } else {
      const naturalProteinPer100ml = Number(nutritionSettings.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
      naturalProtein = (naturalMilkVolume * naturalProteinPer100ml) / 100;
    }
  } else {
    const naturalProteinPer100ml = Number(nutritionSettings.natural_milk_protein) || DEFAULT_BREAST_MILK_PROTEIN;
    naturalProtein = (naturalMilkVolume * naturalProteinPer100ml) / 100;
    const naturalCaloriesPer100ml = Number(nutritionSettings.natural_milk_calories);
    if (naturalCaloriesPer100ml > 0) {
      naturalCalories = (naturalMilkVolume * naturalCaloriesPer100ml) / 100;
    }
  }

  let specialProtein = 0;
  let specialCalories = 0;
  if (specialPowderWeight > 0) {
    const specialProteinPer100g = Number(nutritionSettings.special_milk_protein) || DEFAULT_SPECIAL_MILK_PROTEIN;
    const specialCaloriesPer100g = Number(nutritionSettings.special_milk_calories);
    specialProtein = (specialPowderWeight * specialProteinPer100g) / 100;
    if (specialCaloriesPer100g > 0) {
      specialCalories = (specialPowderWeight * specialCaloriesPer100g) / 100;
    } else {
      specialCalories = specialMilkVolume * SPECIAL_MILK_KCAL;
    }
  } else if (specialMilkVolume > 0) {
    const ratioPowder = Number(nutritionSettings.special_milk_ratio?.powder);
    const ratioWater = Number(nutritionSettings.special_milk_ratio?.water);
    const specialProteinPer100g = Number(nutritionSettings.special_milk_protein);
    const powderWeight = ratioPowder > 0 && ratioWater > 0
      ? specialMilkVolume * ratioPowder / ratioWater
      : 0;
    if (powderWeight > 0 && specialProteinPer100g > 0) {
      specialProtein = (powderWeight * specialProteinPer100g) / 100;
    } else {
      const specialProteinPer100ml = Number(nutritionSettings.special_milk_protein_ml) || DEFAULT_SPECIAL_MILK_PROTEIN_ML;
      specialProtein = (specialMilkVolume * specialProteinPer100ml) / 100;
    }

    const specialCaloriesPer100g = Number(nutritionSettings.special_milk_calories);
    if (specialCaloriesPer100g > 0 && powderWeight > 0) {
      specialCalories = (powderWeight * specialCaloriesPer100g) / 100;
    } else {
      specialCalories = specialMilkVolume * SPECIAL_MILK_KCAL;
    }
  }

  return {
    calories: roundCalories(naturalCalories + specialCalories),
    naturalProtein: roundNumber(naturalProtein, 2),
    specialProtein: roundNumber(specialProtein, 2),
    naturalCalories: roundCalories(naturalCalories),
    specialCalories: roundCalories(specialCalories)
  };
}

Page({
  data: {
    // 时间维度选择
    timeDimension: 'week', // 'week' 或 'month'
    selectedWeek: 0, // 0表示本周，-1表示上周
    selectedMonth: 0, // 0表示本月，-1表示上月
    
    // 日期范围显示
    dateRangeText: '',
    
    // 日期选择器
    showDatePicker: false,
    pickerYear: new Date().getFullYear(),
    pickerMonth: new Date().getMonth() + 1,
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    
    // 图表数据
    chartData: {
      dates: [], // X轴日期数据
      milkVolumes: [], // 奶量数据
      naturalMilk: [], // 天然奶量
      specialMilk: [], // 特殊奶量
      naturalProteinCoefficient: [], // 天然蛋白系数 (g/kg)
      specialProteinCoefficient: [], // 特殊蛋白系数 (g/kg)
      totalProteinCoefficient: [], // 总蛋白系数 (g/kg)
      totalCalories: [], // 总热量
      calorieCoefficient: [] // 热量系数 (kcal/kg)
    },
    
    // 统计数据
    statistics: {
      avgMilkVolume: 0, // 平均奶量
      avgNaturalMilk: 0, // 平均天然奶
      avgSpecialMilk: 0, // 平均特奶
      avgProteinRatio: '0:0', // 平均蛋白质比例
      avgCalories: 0, // 平均热量
      avgCalorieCoefficient: 0, // 平均热量系数
      avgTotalProteinCoefficient: 0, // 平均总蛋白系数
      recordCoverage: 0, // 记录覆盖率
      totalDays: 0 // 记录天数
    },
    
    // 加载状态
    loading: true,
    hasData: false,
    
    // 宝宝信息
    babyInfo: null,
    nutritionSettings: null,
    
    // 图表配置
    ec: {
      lazyLoad: true
    }
  },

  onLoad() {
    this.initPage();
  },

  onShow() {
    // 刷新数据
    if (this.data.babyInfo) {
      this.loadAnalysisData();
    }
  },

  // 初始化页面
  async initPage() {
    try {
      wx.showLoading({ title: '加载中...' });
      
      // 获取宝宝信息
      await this.loadBabyInfo();
      
      // 加载配奶设置
      await this.loadNutritionSettings();
      
      // 加载分析数据
      await this.loadAnalysisData();
      
      wx.hideLoading();
    } catch (error) {
      console.error('初始化页面失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
    }
  },

  // 加载宝宝信息
  async loadBabyInfo() {
    try {
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        throw new Error('未找到宝宝信息');
      }
      
      const db = wx.cloud.database();
      const res = await db.collection('baby_info').where({
        babyUid: babyUid
      }).get();
      
      if (res.data && res.data.length > 0) {
        this.setData({
          babyInfo: res.data[0]
        });
      }
    } catch (error) {
      console.error('加载宝宝信息失败:', error);
      throw error;
    }
  },

  // 加载配奶设置
  async loadNutritionSettings() {
    try {
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ nutritionSettings: defaultSettings });
        return;
      }
      
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      
      if (settings) {
        this.setData({ nutritionSettings: settings });
      } else {
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ nutritionSettings: defaultSettings });
      }
    } catch (error) {
      console.error('加载配奶设置失败:', error);
      const defaultSettings = NutritionModel.createDefaultSettings();
      this.setData({ nutritionSettings: defaultSettings });
    }
  },

  // 加载分析数据
  async loadAnalysisData() {
    try {
      this.setData({ loading: true });
      
      const { timeDimension, selectedWeek, selectedMonth } = this.data;
      const { startDate, endDate } = this.calculateDateRange(timeDimension, selectedWeek, selectedMonth);
      
      // 更新日期范围文本
      this.updateDateRangeText(startDate, endDate);
      
      // 从数据库查询数据
      const records = await this.fetchFeedingRecords(startDate, endDate);
      
      // 处理数据
      this.processAnalysisData(records, startDate, endDate);
      
      // 初始化图表
      this.initCharts();
      
      this.setData({ 
        loading: false,
        hasData: records.length > 0
      });
      
    } catch (error) {
      console.error('加载分析数据失败:', error);
      this.setData({ loading: false });
      wx.showToast({
        title: '加载数据失败',
        icon: 'none'
      });
    }
  },

  // 计算日期范围
  calculateDateRange(timeDimension, weekOffset, monthOffset) {
    const today = new Date();
    let startDate, endDate;
    
    if (timeDimension === 'week') {
      // 计算周范围
      const dayOfWeek = today.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周一为第一天
      
      startDate = new Date(today);
      startDate.setDate(today.getDate() + mondayOffset + (weekOffset * 7));
      startDate.setHours(0, 0, 0, 0);
      
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // 计算月范围 - 总是查询整个月的数据
      const year = today.getFullYear();
      const month = today.getMonth() + monthOffset;
      
      startDate = new Date(year, month, 1);
      startDate.setHours(0, 0, 0, 0);
      
      // 结束日期为该月最后一天（无论是否当前月）
      endDate = new Date(year, month + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      
      console.log('======== 月视图日期计算 ========');
      console.log('今天:', today);
      console.log('monthOffset:', monthOffset);
      console.log('计算的年月:', year, '年', month + 1, '月');
      console.log('startDate:', startDate);
      console.log('endDate:', endDate);
      console.log('月视图日期范围:', this.formatDateKey(startDate), '到', this.formatDateKey(endDate));
    }
    
    return { startDate, endDate };
  },

  // 更新日期范围文本
  updateDateRangeText(startDate, endDate) {
    const { timeDimension } = this.data;
    let dateRangeText = '';
    
    if (timeDimension === 'month') {
      // 月维度：只显示年月，如"2025年10月"
      dateRangeText = `${startDate.getFullYear()}年${startDate.getMonth() + 1}月`;
    } else {
      // 周维度：显示完整日期范围
      const formatDate = (date) => {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
      };
      dateRangeText = `${formatDate(startDate)} - ${formatDate(endDate)}`;
    }
    
    this.setData({ dateRangeText });
  },

  // 从数据库获取喂养记录
  async fetchFeedingRecords(startDate, endDate) {
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      
      const app = getApp();
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      
      if (!babyUid) {
        console.warn('未找到宝宝UID');
        return [];
      }
      
      // 设置时间为当天的开始和结束（和 data-records 页面一致）
      const queryStartDate = new Date(startDate);
      queryStartDate.setHours(0, 0, 0, 0);
      
      const queryEndDate = new Date(endDate);
      queryEndDate.setHours(23, 59, 59, 999);
      
      console.log('查询日期范围:', this.formatDateKey(queryStartDate), '到', this.formatDateKey(queryEndDate));
      console.log('查询时间戳:', queryStartDate.getTime(), '到', queryEndDate.getTime());
      
      // 使用分页查询获取所有数据（避免云数据库的20条默认限制）
      console.log('======== 开始分页查询 ========');
      let allData = [];
      const MAX_LIMIT = 20; // 云数据库单次查询最大20条
      let hasMore = true;
      let skip = 0;
      
      while (hasMore) {
        const res = await db.collection('feeding_records')
          .where({
            babyUid: babyUid,
            date: _.gte(queryStartDate).and(_.lte(queryEndDate))
          })
          .skip(skip)
          .limit(MAX_LIMIT)
          .get();
        
        console.log(`分页查询 skip=${skip}, 返回${res.data.length}条`);
        
        if (res.data.length > 0) {
          allData = allData.concat(res.data);
          skip += res.data.length;
        }
        
        // 如果返回数量小于limit，说明已经查完了
        if (res.data.length < MAX_LIMIT) {
          hasMore = false;
        }
        
        // 安全限制：最多查询5页，避免死循环
        if (skip >= 100) {
          console.warn('已查询100条，停止分页');
          hasMore = false;
        }
      }
      
      console.log('分页查询完成，总共:', allData.length, '条');
      
      // 在前端排序
      if (allData.length > 0) {
        allData.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateA - dateB;
        });
      }
      
      // 构造返回格式与原来一致
      const res = { data: allData };
      
      console.log('======== 查询结果检查 ========');
      console.log('查询到的记录数:', res.data.length);
      if (res.data.length > 0) {
        console.log('第一条记录:', {
          date: res.data[0].date,
          babyUid: res.data[0].babyUid,
          type: typeof res.data[0].date,
          isDate: res.data[0].date instanceof Date,
          feedings: res.data[0].feedings?.length
        });
        console.log('最后一条记录:', {
          date: res.data[res.data.length - 1].date,
          babyUid: res.data[res.data.length - 1].babyUid,
          type: typeof res.data[res.data.length - 1].date,
          feedings: res.data[res.data.length - 1].feedings?.length
        });
        
        // 检查是否有21号之后的数据
        const after20 = res.data.filter(r => {
          const d = new Date(r.date);
          return d.getDate() > 20;
        });
        console.log('21号之后的记录数:', after20.length);
        if (after20.length > 0) {
          console.log('21号之后的日期:', after20.map(r => new Date(r.date).getDate()));
        }
      }
      
      // 额外查询：专门查询21-27号的数据看看存不存在
      console.log('======== 额外验证：查询21-27号 ========');
      const oct21 = new Date(queryStartDate);
      oct21.setDate(21);
      oct21.setHours(0, 0, 0, 0);
      
      const oct27 = new Date(queryStartDate);
      oct27.setDate(27);
      oct27.setHours(23, 59, 59, 999);
      
      const testRes = await db.collection('feeding_records')
        .where({
          babyUid: babyUid,
          date: _.gte(oct21).and(_.lte(oct27))
        })
        .get();
      
      console.log('21-27号单独查询结果:', testRes.data.length, '条');
      if (testRes.data.length > 0) {
        testRes.data.forEach((r, i) => {
          console.log(`  ${i+1}. 日期=${new Date(r.date).toLocaleDateString()}, babyUid=${r.babyUid}, feedings=${r.feedings?.length}`);
        });
      }
      
      return res.data || [];
    } catch (error) {
      console.error('获取喂养记录失败:', error);
      console.error('错误详情:', JSON.stringify(error));
      wx.showToast({
        title: '数据加载失败',
        icon: 'none'
      });
      return [];
    }
  },

  // 处理分析数据
  processAnalysisData(records, startDate, endDate) {
    console.log('========== 开始处理分析数据 ==========');
    console.log('收到记录数:', records.length);
    
    const dates = [];
    const milkVolumes = [];
    const naturalMilk = [];
    const specialMilk = [];
    const naturalProteinCoefficient = [];
    const specialProteinCoefficient = [];
    const totalProteinCoefficient = [];
    const totalCalories = [];
    const calorieCoefficient = [];
    
    // 生成日期列表
    const dateList = this.generateDateList(startDate, endDate);
    console.log('======== 生成的日期列表 ========');
    console.log('需要展示的日期数:', dateList.length);
    console.log('第一天:', dateList[0]);
    console.log('最后一天:', dateList[dateList.length - 1]);
    console.log('日期范围:', this.formatDateKey(dateList[0]), '到', this.formatDateKey(dateList[dateList.length - 1]));
    // 打印最后几天的日期
    if (dateList.length > 5) {
      console.log('最后5天:');
      for (let i = dateList.length - 5; i < dateList.length; i++) {
        const d = dateList[i];
        console.log(`  ${i}: ${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`);
      }
    }
    
    // 创建日期到数据的映射
    const dateMap = new Map();
    records.forEach((record, index) => {
      // 处理Date对象，确保时区正确
      let recordDate;
      if (record.date instanceof Date) {
        recordDate = record.date;
      } else if (typeof record.date === 'object' && record.date.$date) {
        // 处理云数据库返回的特殊日期格式
        recordDate = new Date(record.date.$date);
      } else {
        recordDate = new Date(record.date);
      }
      
      // 统一为本地时间的日期字符串（去掉时间部分）
      const year = recordDate.getFullYear();
      const month = (recordDate.getMonth() + 1).toString().padStart(2, '0');
      const day = recordDate.getDate().toString().padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      
      dateMap.set(dateKey, record);
      // 只打印前3条和后3条
      if (index < 3 || index >= records.length - 3) {
        console.log(`记录${index + 1}: 原始日期=${record.date}, 解析后=${dateKey}, 喂养次数=${record.feedings ? record.feedings.length : 0}`);
      } else if (index === 3) {
        console.log(`  ... (省略中间 ${records.length - 6} 条记录) ...`);
      }
    });
    
    console.log('日期映射Map大小:', dateMap.size);
    console.log('日期映射Keys:', Array.from(dateMap.keys()));
    
    // 统计变量
    let totalMilk = 0;
    let totalNatural = 0;
    let totalSpecial = 0;
    let totalCal = 0;
    let totalNaturalProtein = 0;
    let totalSpecialProtein = 0;
    let totalCalorieCoefficient = 0;
    let recordDays = 0;
    
    // 按日期顺序处理数据
    dateList.forEach((date, idx) => {
      // 使用相同的格式化方法
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      
      const record = dateMap.get(dateKey);
      
      dates.push(this.formatDateDisplay(date));
      
      // 打印所有20号之后的日期匹配情况
      if (idx < 5 || !record || day >= 20) {
        console.log(`[${idx}] 处理日期 ${dateKey}: ${record ? '✅有数据' : '❌无数据'}, feedings=${record?.feedings?.length || 0}`);
      }
      
      const hasFeedings = record && record.feedings && record.feedings.length > 0;
      const hasIntakes = record && Array.isArray(record.intakes) && record.intakes.length > 0;

      if (record && (hasFeedings || hasIntakes)) {
        // 计算当天的总量
        let dayNaturalMilk = 0;
        let daySpecialMilk = 0;
        
        if (hasFeedings) {
          record.feedings.forEach(feeding => {
            dayNaturalMilk += parseFloat(feeding.naturalMilkVolume || 0);
            daySpecialMilk += parseFloat(feeding.specialMilkVolume || 0);
          });
        }
        
        const dayTotalMilk = dayNaturalMilk + daySpecialMilk;
        const summary = this.calculateDailySummary(record);
        const dayCalories = summary.calories || 0;
        
        // 获取当天体重
        let weight = 0;
        if (record.basicInfo && record.basicInfo.weight) {
          weight = parseFloat(record.basicInfo.weight);
        } else if (record.weight) {
          weight = parseFloat(record.weight);
        }
        
        // 计算蛋白质系数 (g/kg)
        let dayNaturalProteinCoef = 0;
        let daySpecialProteinCoef = 0;
        let dayCalorieCoef = 0;
        
        if (weight > 0) {
          dayNaturalProteinCoef = (summary.naturalProtein / weight).toFixed(2);
          daySpecialProteinCoef = (summary.specialProtein / weight).toFixed(2);
          dayCalorieCoef = roundNumber(dayCalories / weight, 1);

          totalNaturalProtein += parseFloat(dayNaturalProteinCoef);
          totalSpecialProtein += parseFloat(daySpecialProteinCoef);
          totalCalorieCoefficient += dayCalorieCoef;
        }
        
        const dayTotalProteinCoef = parseFloat(dayNaturalProteinCoef) + parseFloat(daySpecialProteinCoef);
        
        milkVolumes.push(Math.round(dayTotalMilk));
        naturalMilk.push(Math.round(dayNaturalMilk));
        specialMilk.push(Math.round(daySpecialMilk));
        naturalProteinCoefficient.push(parseFloat(dayNaturalProteinCoef));
        specialProteinCoefficient.push(parseFloat(daySpecialProteinCoef));
        totalProteinCoefficient.push(parseFloat(dayTotalProteinCoef.toFixed(2)));
        totalCalories.push(dayCalories);
        calorieCoefficient.push(dayCalorieCoef);
        
        // 累计统计
        totalMilk += dayTotalMilk;
        totalNatural += dayNaturalMilk;
        totalSpecial += daySpecialMilk;
        totalCal += dayCalories;
        recordDays++;
      } else {
        // 没有数据的日期
        milkVolumes.push(0);
        naturalMilk.push(0);
        specialMilk.push(0);
        naturalProteinCoefficient.push(0);
        specialProteinCoefficient.push(0);
        totalProteinCoefficient.push(0);
        totalCalories.push(0);
        calorieCoefficient.push(0);
      }
    });
    
    // 计算平均值
    const avgMilkVolume = recordDays > 0 ? Math.round(totalMilk / recordDays) : 0;
    const avgNaturalMilk = recordDays > 0 ? Math.round(totalNatural / recordDays) : 0;
    const avgSpecialMilk = recordDays > 0 ? Math.round(totalSpecial / recordDays) : 0;
    const avgCalories = recordDays > 0 ? Math.round(totalCal / recordDays) : 0;
    const avgNaturalProteinCoef = recordDays > 0 ? (totalNaturalProtein / recordDays).toFixed(2) : '0.00';
    const avgSpecialProteinCoef = recordDays > 0 ? (totalSpecialProtein / recordDays).toFixed(2) : '0.00';
    const avgTotalProteinCoefficient = recordDays > 0
      ? roundNumber((Number(avgNaturalProteinCoef) || 0) + (Number(avgSpecialProteinCoef) || 0), 2)
      : 0;
    const avgCalorieCoefficient = recordDays > 0
      ? roundNumber(totalCalorieCoefficient / recordDays, 1)
      : 0;
    const totalDaysInRange = dateList.length || 0;
    const recordCoverage = totalDaysInRange > 0
      ? Math.round((recordDays / totalDaysInRange) * 100)
      : 0;
    
    // 计算平均蛋白质系数比例
    let avgProteinRatio = `${avgNaturalProteinCoef}:${avgSpecialProteinCoef}`;
    
    console.log('========== 数据处理完成 ==========');
    console.log('有效记录天数:', recordDays);
    console.log('平均奶量:', avgMilkVolume, 'ml');
    console.log('平均蛋白比例:', avgProteinRatio);
    console.log('图表数据点数:', dates.length);
    
    this.setData({
      chartData: {
        dates,
        milkVolumes,
        naturalMilk,
        specialMilk,
        naturalProteinCoefficient,
        specialProteinCoefficient,
        totalProteinCoefficient,
        totalCalories,
        calorieCoefficient
      },
      statistics: {
        avgMilkVolume,
        avgNaturalMilk,
        avgSpecialMilk,
        avgProteinRatio,
        avgCalories,
        avgCalorieCoefficient,
        avgTotalProteinCoefficient,
        recordCoverage,
        totalDays: recordDays
      }
    });
  },

  // 生成日期列表
  generateDateList(startDate, endDate) {
    const dates = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return dates;
  },

  // 格式化日期作为键
  formatDateKey(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 格式化日期显示
  formatDateDisplay(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  },

  calculateDailySummary(record) {
    const nutritionSettings = this.data.nutritionSettings || {};
    const intakes = Array.isArray(record.intakes) ? record.intakes : [];

    const summary = {
      calories: 0,
      naturalProtein: 0,
      specialProtein: 0
    };

    intakes.forEach(intake => {
      const nutrition = intake.nutrition || {};
      const protein = Number(nutrition.protein) || 0;
      const naturalProtein = typeof intake.naturalProtein === 'number'
        ? intake.naturalProtein
        : (intake.proteinSource === 'special' ? 0 : protein);
      const specialProtein = typeof intake.specialProtein === 'number'
        ? intake.specialProtein
        : (intake.proteinSource === 'special' ? protein : 0);

      summary.calories += Number(nutrition.calories) || 0;
      summary.naturalProtein += Number(naturalProtein) || 0;
      summary.specialProtein += Number(specialProtein) || 0;
    });

    let totalNaturalVolumeBreast = 0;
    let totalNaturalVolumeFormula = 0;
    let totalSpecialVolume = 0;

    (record.feedings || []).forEach(feeding => {
      const naturalVolume = parseFloat(feeding.naturalMilkVolume) || 0;
      const specialVolume = parseFloat(feeding.specialMilkVolume) || 0;
      const naturalTypeRaw = feeding.naturalMilkType || 'breast';
      const naturalType = naturalTypeRaw === 'breast' ? 'breast' : 'formula';

      if (naturalVolume > 0) {
        if (naturalType === 'formula') {
          totalNaturalVolumeFormula += naturalVolume;
        } else {
          totalNaturalVolumeBreast += naturalVolume;
        }
      }
      if (specialVolume > 0) {
        totalSpecialVolume += specialVolume;
      }
    });

    if (totalNaturalVolumeBreast > 0) {
      const nutrition = calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeBreast,
        naturalMilkType: 'breast',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }, nutritionSettings);
      summary.calories += nutrition.naturalCalories || 0;
      summary.naturalProtein += nutrition.naturalProtein || 0;
    }

    if (totalNaturalVolumeFormula > 0) {
      const nutrition = calculateMilkNutrition({
        naturalMilkVolume: totalNaturalVolumeFormula,
        naturalMilkType: 'formula',
        specialMilkVolume: 0,
        specialMilkPowder: 0
      }, nutritionSettings);
      summary.calories += nutrition.naturalCalories || 0;
      summary.naturalProtein += nutrition.naturalProtein || 0;
    }

    if (totalSpecialVolume > 0) {
      const specialPowder = calculateSpecialMilkPowder(totalSpecialVolume, nutritionSettings);
      const nutrition = calculateMilkNutrition({
        naturalMilkVolume: 0,
        naturalMilkType: 'breast',
        specialMilkVolume: totalSpecialVolume,
        specialMilkPowder: specialPowder
      }, nutritionSettings);
      summary.calories += nutrition.specialCalories || 0;
      summary.specialProtein += nutrition.specialProtein || 0;
    }

    summary.calories = roundCalories(summary.calories);
    summary.naturalProtein = roundNumber(summary.naturalProtein, 2);
    summary.specialProtein = roundNumber(summary.specialProtein, 2);

    return summary;
  },

  // 初始化图表
  initCharts() {
    // 延迟一点，确保DOM已渲染
    setTimeout(() => {
      this.setData({
        'ec.lazyLoad': false
      });
    }, 300);
  },

  // 切换时间维度
  onTimeDimensionChange(e) {
    const dimension = e.currentTarget.dataset.dimension;
    
    if (dimension === this.data.timeDimension) {
      return;
    }
    
    this.setData({
      timeDimension: dimension,
      selectedWeek: 0,
      selectedMonth: 0
    });
    
    this.loadAnalysisData();
  },

  // 上一周/月
  onPrevious() {
    const { timeDimension, selectedWeek, selectedMonth } = this.data;
    
    if (timeDimension === 'week') {
      this.setData({ selectedWeek: selectedWeek - 1 });
    } else {
      this.setData({ selectedMonth: selectedMonth - 1 });
    }
    
    this.loadAnalysisData();
  },

  // 下一周/月
  onNext() {
    const { timeDimension, selectedWeek, selectedMonth } = this.data;
    
    // 不能查看未来数据
    if ((timeDimension === 'week' && selectedWeek >= 0) ||
        (timeDimension === 'month' && selectedMonth >= 0)) {
      wx.showToast({
        title: '已是最新数据',
        icon: 'none'
      });
      return;
    }
    
    if (timeDimension === 'week') {
      this.setData({ selectedWeek: selectedWeek + 1 });
    } else {
      this.setData({ selectedMonth: selectedMonth + 1 });
    }
    
    this.loadAnalysisData();
  },

  // 打开日期选择器（仅月视图）
  onDatePicker() {
    const { timeDimension } = this.data;
    
    // 只在月视图下才打开选择器
    if (timeDimension !== 'month') {
      return;
    }
    
    // 初始化选择器的年月为当前选择的月份
    const now = new Date();
    const { selectedMonth } = this.data;
    const targetDate = new Date(now);
    targetDate.setMonth(now.getMonth() + selectedMonth);
    
    this.setData({
      showDatePicker: true,
      pickerYear: targetDate.getFullYear(),
      pickerMonth: targetDate.getMonth() + 1
    });
  },

  // 关闭日期选择器
  onCloseDatePicker() {
    this.setData({
      showDatePicker: false
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止点击弹窗内容时关闭弹窗
  },

  // 年份切换
  onYearChange(e) {
    const offset = parseInt(e.currentTarget.dataset.offset);
    const newYear = this.data.pickerYear + offset;
    
    // 限制年份范围（宝宝出生年份到当前年份）
    const currentYear = new Date().getFullYear();
    const minYear = currentYear - 5; // 假设最多查看5年前的数据
    
    if (newYear >= minYear && newYear <= currentYear) {
      this.setData({
        pickerYear: newYear
      });
    }
  },

  // 月份选择
  onMonthSelect(e) {
    const month = parseInt(e.currentTarget.dataset.month);
    this.setData({
      pickerMonth: month
    });
  },

  // 确认日期选择
  onDatePickerConfirm() {
    const { pickerYear, pickerMonth } = this.data;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    // 月视图：计算月份偏移
    const selectedDate = new Date(pickerYear, pickerMonth - 1, 1);
    const currentDate = new Date(currentYear, currentMonth - 1, 1);
    
    const monthDiff = (selectedDate.getFullYear() - currentDate.getFullYear()) * 12 
                      + (selectedDate.getMonth() - currentDate.getMonth());
    
    this.setData({
      selectedMonth: monthDiff,
      showDatePicker: false
    });
    
    // 加载新数据
    this.loadAnalysisData();
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadAnalysisData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 初始化奶量统计图表
  initMilkChart(e) {
    const component = e.detail.component;
    const { dates, naturalMilk, specialMilk, milkVolumes } = this.data.chartData;
    
    if (!dates || dates.length === 0) {
      console.log('奶量图表：暂无数据');
      return;
    }
    
    setTimeout(() => {
      component.drawChart({
        xData: dates,
        series: [
          { name: '总奶量', data: milkVolumes },
          { name: '天然奶', data: naturalMilk },
          { name: '特奶', data: specialMilk }
        ],
        options: {
          colors: ['#FFB800', '#4CAF50', '#2196F3'],
          showGrid: true,
          showLegend: true
        }
      });
    }, 200);
  },

  // 初始化蛋白质系数比例图表（曲线图）
  initProteinChart(e) {
    const component = e.detail.component;
    const { dates, naturalProteinCoefficient, specialProteinCoefficient, totalProteinCoefficient } = this.data.chartData;
    
    if (!dates || dates.length === 0) {
      console.log('蛋白质系数图表：暂无数据');
      return;
    }
    
    // 计算合理的Y轴范围
    const validData = [
      ...naturalProteinCoefficient.filter(v => v > 0),
      ...specialProteinCoefficient.filter(v => v > 0),
      ...totalProteinCoefficient.filter(v => v > 0)
    ];
    
    let yMax = 2.5; // 默认最大值
    if (validData.length > 0) {
      const maxValue = Math.max(...validData);
      // 向上取整到0.5的倍数
      yMax = Math.ceil(maxValue / 0.5) * 0.5;
      // 确保最小为2.0，最大不超过3.0
      yMax = Math.max(2.0, Math.min(yMax, 3.0));
    }
    
    console.log('蛋白质系数图表Y轴范围: 0 -', yMax);
    
    setTimeout(() => {
      component.drawChart({
        xData: dates,
        series: [
          { name: '总蛋白(g/kg)', data: totalProteinCoefficient },
          { name: '天然蛋白(g/kg)', data: naturalProteinCoefficient },
          { name: '特殊蛋白(g/kg)', data: specialProteinCoefficient }
        ],
        options: {
          colors: ['#FF9800', '#4CAF50', '#2196F3'], // 橙色-总蛋白，绿色-天然，蓝色-特殊
          showGrid: true,
          showLegend: true,
          yAxisMax: yMax, // 动态调整最大值
          yAxisMin: 0 // 最小值从0开始
        }
      });
    }, 200);
  },

  // 初始化热量图表
  initCalorieChart(e) {
    const component = e.detail.component;
    const { dates, totalCalories, calorieCoefficient } = this.data.chartData;
    
    if (!dates || dates.length === 0) {
      console.log('热量图表：暂无数据');
      return;
    }
    
    const validCoefficients = (calorieCoefficient || []).filter(v => v > 0);
    const yRightMax = validCoefficients.length > 0
      ? Math.ceil(Math.max(...validCoefficients) / 10) * 10
      : 100;

    setTimeout(() => {
      component.drawChart({
        xData: dates,
        series: [
          { name: '总热量(kcal)', data: totalCalories },
          { name: '热量系数(kcal/kg)', data: calorieCoefficient, yAxisIndex: 1 }
        ],
        options: {
          colors: ['#FF5722', '#4CAF50'],
          showGrid: true,
          showLegend: true,
          yAxisLabel: '总热量(kcal)',
          yAxisRightLabel: 'kcal/kg',
          yAxisRightMin: 0,
          yAxisRightMax: yRightMax
        }
      });
    }, 200);
  }
});
