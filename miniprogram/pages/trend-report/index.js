const app = getApp();
const NutritionModel = require('../../models/nutrition');
const { calculator: feedingCalculator } = require('../../utils/feedingUtils');
const DAY_MS = 24 * 60 * 60 * 1000;
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
  const specialPowderWeight = feedingCalculator.getSpecialMilkPowder(feeding, nutritionSettings);
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
    rangeType: 'week',
    rangeLabel: '本周',
    rangeText: '',
    useCustomRange: false,
    customRange: {
      start: '',
      end: ''
    },
    showRangePicker: false,
    tempRangeStart: '',
    tempRangeEnd: '',
    todayStr: '',
    summary: {
      avgPerDay: '--',
      periodAvgPerDay: '--',
      avgPerFeed: '--',
      trendLabel: '--',
      trendSlope: '--',
      dataQuality: '--',
      coverage: '--',
      medianPerDay: '--',
      cv: '--',
      naturalVolume: '--',
      specialVolume: '--',
      naturalRatioText: '--',
      naturalRatioValue: 0,
      specialRatioValue: 0,
      milkCalorieRatio: '--',
      foodCalorieRatio: '--',
      milkCalorieRatioValue: 0,
      foodCalorieRatioValue: 0,
      specialRatio: '--',
      volatility: '--',
      recordDays: 0,
      expectedDays: 0,
      records: 0,
      foodRecords: 0,
      milkTotal: '--',
      milkCaloriesTotal: '--',
      foodCaloriesTotal: '--'
    },
    chartView: 'calorie',
    objectiveFindings: [],
    metricDefinitions: [],
    narratives: [],
    insights: [],
    reminders: [],
    nutritionSettings: null,
    babyInfo: null,
    chartData: {
      dates: [],
      totalCalories: [],
      milkCalories: [],
      foodCalories: [],
      calorieCoefficient: [],
      naturalProtein: [],
      specialProtein: [],
      proteinCoefficient: [],
      milkRatioDaily: [],
      foodRatioDaily: [],
      ratio: { milk: 0, food: 0 }
    },
    hasChartData: false,
    ec: {
      lazyLoad: true
    },
    loading: false
  },

  onShow() {
    this.initPage();
  },

  async initPage() {
    this.setData({
      todayStr: this.formatDateKey(new Date())
    });
    await this.loadBabyInfo();
    await this.loadNutritionSettings();
    await this.loadSummary();
  },

  async loadBabyInfo() {
    try {
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) return;
      const db = wx.cloud.database({ env: app.globalData.cloudEnvId });
      const res = await db.collection('baby_info').where({ babyUid }).get();
      if (res.data && res.data.length > 0) {
        this.setData({ babyInfo: res.data[0] });
      }
    } catch (error) {
      console.error('加载宝宝信息失败:', error);
    }
  },

  async loadNutritionSettings() {
    try {
      const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
      if (!babyUid) {
        const defaultSettings = NutritionModel.createDefaultSettings();
        this.setData({ nutritionSettings: defaultSettings });
        return;
      }
      const settings = await NutritionModel.getNutritionSettings(babyUid);
      const resolved = settings || NutritionModel.createDefaultSettings();
      this.setData({ nutritionSettings: resolved });
    } catch (error) {
      console.error('加载配奶设置失败:', error);
      const defaultSettings = NutritionModel.createDefaultSettings();
      this.setData({ nutritionSettings: defaultSettings });
    }
  },

  onRangeChange(e) {
    const type = e.currentTarget.dataset.type;
    if (!type || type === this.data.rangeType) return;
    this.setData({ rangeType: type, useCustomRange: false });
    this.loadSummary();
  },

  // 计算本周起止（周一为起点）
  getWeekRange() {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now.getTime() - (day - 1) * DAY_MS);
    monday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
    return { start: monday, end: nextMonday };
  },

  // 计算本月起止
  getMonthRange(baseDate = new Date()) {
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const end = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
    return { start, end };
  },

  getDaysInMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  },

  calculateMedian(values = []) {
    const nums = values
      .map(v => Number(v))
      .filter(v => !isNaN(v))
      .sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    if (nums.length % 2 === 0) {
      return (nums[mid - 1] + nums[mid]) / 2;
    }
    return nums[mid];
  },

  calculateLinearTrendSlope(dayEntries = [], rangeStart) {
    if (!dayEntries || dayEntries.length < 2 || !rangeStart) return null;
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);
    const points = dayEntries.map(([dayKey, value]) => {
      const dayDate = this.parseDateString(dayKey);
      if (!dayDate) return null;
      dayDate.setHours(0, 0, 0, 0);
      return {
        x: Math.round((dayDate.getTime() - start.getTime()) / DAY_MS),
        y: Number(value) || 0
      };
    }).filter(Boolean);

    if (points.length < 2) return null;

    const n = points.length;
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumXX = points.reduce((sum, p) => sum + p.x * p.x, 0);
    const denominator = n * sumXX - sumX * sumX;
    if (!denominator) return null;

    return (n * sumXY - sumX * sumY) / denominator;
  },

  getTrendLabel(slope) {
    if (slope === null || slope === undefined || isNaN(slope)) return '--';
    if (Math.abs(slope) < 20) return '平稳';
    return slope > 0 ? '上升' : '下降';
  },

  getDataQualityLevel(meta = {}) {
    if (!meta.hasAnyRecords) return '无样本';
    if (meta.daysRecorded >= 5 && meta.coveragePercent >= 80 && meta.milkRecordsCount >= 10) return '高';
    if (meta.daysRecorded >= 3 && meta.coveragePercent >= 60 && meta.milkRecordsCount >= 6) return '中';
    return '低';
  },

  buildObjectiveFindings(meta = {}) {
    if (!meta.hasAnySamples) {
      return [
        { title: '样本状态', text: '当前区间没有喂养记录，无法进行统计分析。' }
      ];
    }

    const list = [];
    const coverageStatus = meta.coveragePercent >= 80
      ? '覆盖充足'
      : (meta.coveragePercent >= 60 ? '覆盖一般' : '覆盖不足');
    list.push({
      title: '样本覆盖',
      text: `${meta.daysRecorded}/${meta.expectedDays}天有奶量样本（${meta.coveragePercent}%），${coverageStatus}。`
    });

    if (meta.trendSlopeValue === null) {
      list.push({
        title: '奶量趋势',
        text: '奶量有效样本天数不足2天，无法计算线性趋势斜率。'
      });
    } else {
      list.push({
        title: '奶量趋势',
        text: `线性趋势斜率 ${roundNumber(meta.trendSlopeValue, 1)} ml/天（${meta.trendLabel}，阈值±20 ml/天）。`
      });
    }

    list.push({
      title: '奶源结构',
      text: `天然 ${Math.round(meta.naturalTotal || 0)}ml（${meta.naturalRatioValue.toFixed(1)}%），特殊 ${Math.round(meta.specialTotal || 0)}ml（${meta.specialRatioValue.toFixed(1)}%）。`
    });

    list.push({
      title: '热量结构',
      text: `奶类 ${roundCalories(meta.milkCaloriesTotal)}kcal（${meta.milkCalorieRatioValue.toFixed(1)}%），食物 ${roundCalories(meta.foodCaloriesTotal)}kcal（${meta.foodCalorieRatioValue.toFixed(1)}%）。`
    });

    return list;
  },

  buildMetricDefinitions() {
    return [
      { text: '区间日均奶量 = 总奶量 / 区间天数' },
      { text: '记录日均奶量 = 总奶量 / 有奶量记录天数' },
      { text: '单次均量 = 总奶量 / 奶类记录笔数' },
      { text: '趋势斜率 = 每日奶量线性回归，单位 ml/天' }
    ];
  },

  formatRangeText(rangeType, start, end) {
    const endDate = new Date(end.getTime() - DAY_MS);
    return `${this.formatDisplayDate(start)} - ${this.formatDisplayDate(endDate)}`;
  },

  resolveDateValue(rawValue) {
    if (!rawValue && rawValue !== 0) return null;

    if (rawValue instanceof Date) {
      return isNaN(rawValue.getTime()) ? null : rawValue;
    }

    if (typeof rawValue === 'number') {
      const date = new Date(rawValue);
      return isNaN(date.getTime()) ? null : date;
    }

    if (typeof rawValue === 'string') {
      const direct = new Date(rawValue);
      if (!isNaN(direct.getTime())) return direct;
      const normalized = rawValue.replace(/\./g, '-').slice(0, 10);
      const fallback = new Date(normalized);
      return isNaN(fallback.getTime()) ? null : fallback;
    }

    if (typeof rawValue === 'object') {
      if (rawValue.$date) return this.resolveDateValue(rawValue.$date);
      if (typeof rawValue.toDate === 'function') return this.resolveDateValue(rawValue.toDate());
      if (typeof rawValue.seconds === 'number') return this.resolveDateValue(rawValue.seconds * 1000);
    }

    return null;
  },

  normalizeDayKey(feed = {}) {
    const date = this.resolveDateValue(feed.date) || this.resolveDateValue(feed.startDateTime);
    if (!date) return 'unknown';
    return this.formatDateKey(date);
  },

  getFeedingHour(feed) {
    const startDate = this.resolveDateValue(feed.startDateTime);
    if (startDate) return startDate.getHours();
    if (typeof feed.startTime === 'string') {
      const parts = feed.startTime.split(':');
      const hour = Number(parts[0]);
      if (!isNaN(hour) && hour >= 0 && hour <= 23) return hour;
    }
    return null;
  },

  getPeakPeriod(feedings = []) {
    const buckets = [
      { key: 'dawn', label: '凌晨(0-5)', start: 0, end: 5 },
      { key: 'morning', label: '上午(6-11)', start: 6, end: 11 },
      { key: 'afternoon', label: '下午(12-17)', start: 12, end: 17 },
      { key: 'evening', label: '夜间(18-23)', start: 18, end: 23 }
    ];
    const counts = {};
    buckets.forEach(bucket => { counts[bucket.key] = 0; });
    feedings.forEach(feed => {
      const hour = this.getFeedingHour(feed);
      if (hour === null) return;
      const bucket = buckets.find(item => hour >= item.start && hour <= item.end);
      if (bucket) counts[bucket.key] += 1;
    });
    let bestKey = null;
    let bestCount = 0;
    buckets.forEach(bucket => {
      const count = counts[bucket.key];
      if (count > bestCount) {
        bestCount = count;
        bestKey = bucket.key;
      }
    });
    if (!bestKey || bestCount === 0) return '--';
    return buckets.find(item => item.key === bestKey).label;
  },

  formatDayLabel(dayKey) {
    if (!dayKey || dayKey === 'unknown') return '未知日期';
    const parts = dayKey.split('-');
    if (parts.length < 3) return dayKey;
    return `${parts[1]}.${parts[2]}`;
  },

  formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  generateDateKeys(startDate, endDate) {
    const keys = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    while (current.getTime() <= end.getTime()) {
      keys.push(this.formatDateKey(current));
      current.setDate(current.getDate() + 1);
    }
    return keys;
  },

  getRecordWeight(record) {
    if (!record) return 0;
    const weightCandidate = record.basicInfo?.weight ?? record.weight;
    let weight = parseFloat(weightCandidate);
    if (!weight || isNaN(weight)) {
      weight = parseFloat(this.data.babyInfo?.weight);
    }
    return weight && !isNaN(weight) ? weight : 0;
  },

  resolveIntakeType(intake = {}) {
    const explicitType = intake.foodType || intake.type;
    if (explicitType === 'food') return 'food';
    if (explicitType === 'milk') {
      const hasMilkType = !!intake.milkType;
      const protein = Number(intake.nutrition?.protein) || 0;
      const hasMilkHint = hasMilkType || intake.proteinSource === 'special' || intake.proteinSource === 'mixed';
      return (!hasMilkHint && protein <= 0) ? 'food' : 'milk';
    }
    return intake.milkType ? 'milk' : 'food';
  },

  formatDisplayDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  },

  parseDateString(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-').map(Number);
    if (parts.length < 3) return null;
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  },

  getRollingRange(type) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = type === 'month' ? 30 : 7;
    const start = new Date(today.getTime() - (days - 1) * DAY_MS);
    const end = new Date(today.getTime() + DAY_MS);
    return { start, end, days };
  },

  openRangePicker() {
    const { rangeType, useCustomRange, customRange } = this.data;
    let startStr = customRange.start;
    let endStr = customRange.end;
    if (!useCustomRange || !startStr || !endStr) {
      const rolling = this.getRollingRange(rangeType);
      startStr = this.formatDateKey(rolling.start);
      endStr = this.formatDateKey(new Date(rolling.end.getTime() - DAY_MS));
    }
    this.setData({
      showRangePicker: true,
      tempRangeStart: startStr,
      tempRangeEnd: endStr
    });
  },

  closeRangePicker() {
    this.setData({ showRangePicker: false });
  },

  stopTap() {},

  onChartViewChange(e) {
    const view = e.currentTarget.dataset.view;
    if (!view || view === this.data.chartView) return;
    this.setData({ chartView: view }, () => {
      this.drawCharts();
    });
  },

  onStartDateChange(e) {
    this.setData({ tempRangeStart: e.detail.value });
  },

  onEndDateChange(e) {
    this.setData({ tempRangeEnd: e.detail.value });
  },

  applyCustomRange() {
    const { tempRangeStart, tempRangeEnd } = this.data;
    const start = this.parseDateString(tempRangeStart);
    const end = this.parseDateString(tempRangeEnd);
    if (!start || !end) {
      wx.showToast({ title: '请选择完整日期', icon: 'none' });
      return;
    }
    if (start.getTime() > end.getTime()) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({
      useCustomRange: true,
      customRange: { start: tempRangeStart, end: tempRangeEnd },
      showRangePicker: false
    });
    this.loadSummary();
  },

  async fetchFeedingRecords(startDate, endDate) {
    const db = wx.cloud.database({ env: app.globalData.cloudEnvId });
    const _ = db.command;
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid');
    if (!babyUid) throw new Error('缺少宝宝ID');

    const fetchByWhere = async (whereObj) => {
      let allData = [];
      let skip = 0;
      let hasMore = true;
      const MAX_LIMIT = 20;
      const MAX_TOTAL = 400;

      while (hasMore) {
        const res = await db.collection('feeding_records')
          .where(whereObj)
          .skip(skip)
          .limit(MAX_LIMIT)
          .get();

        const batch = res.data || [];
        if (batch.length) {
          allData = allData.concat(batch);
          skip += batch.length;
        }

        if (batch.length < MAX_LIMIT || skip >= MAX_TOTAL) {
          hasMore = false;
        }
      }
      return allData;
    };

    const startKey = this.formatDateKey(startDate);
    const endInclusive = new Date(endDate.getTime() - DAY_MS);
    const endKey = this.formatDateKey(endInclusive);

    // 主查询：date 字段为 Date 类型
    const dateTypeRecords = await fetchByWhere({
      babyUid,
      date: _.gte(startDate).and(_.lt(endDate))
    });

    // 兼容查询：date 字段为 YYYY-MM-DD 字符串
    const stringTypeRecords = await fetchByWhere({
      babyUid,
      date: _.gte(startKey).and(_.lte(endKey))
    });

    const mergedMap = new Map();
    dateTypeRecords.concat(stringTypeRecords).forEach(record => {
      if (record && record._id) {
        mergedMap.set(record._id, record);
      }
    });

    let allData = Array.from(mergedMap.values());

    // 兜底：若仍为空，读取最近记录后在本地按日期过滤（处理混合/异常数据）
    if (!allData.length) {
      const fallbackRecords = await fetchByWhere({ babyUid });
      allData = fallbackRecords.filter(record => {
        const dayKey = this.normalizeDayKey({ date: record.date });
        return dayKey !== 'unknown' && dayKey >= startKey && dayKey <= endKey;
      });
    }

    if (allData.length) {
      allData.sort((a, b) => {
        const dayA = this.normalizeDayKey({ date: a.date });
        const dayB = this.normalizeDayKey({ date: b.date });
        return dayA.localeCompare(dayB);
      });
    }

    return allData;
  },

  buildChartData(records = [], range, rangeLabel) {
    const endDate = new Date(range.end.getTime() - DAY_MS);
    const dateKeys = this.generateDateKeys(range.start, endDate);
    if (!dateKeys.length) {
      return {
        dates: [],
        totalCalories: [],
        milkCalories: [],
        foodCalories: [],
        calorieCoefficient: [],
        naturalProtein: [],
        specialProtein: [],
        proteinCoefficient: [],
        milkRatioDaily: [],
        foodRatioDaily: [],
        ratio: { milk: 0, food: 0 },
        rangeLabel
      };
    }

    const statsMap = {};
    const weightMap = {};
    dateKeys.forEach(key => {
      statsMap[key] = {
        milkCalories: 0,
        foodCalories: 0,
        naturalProtein: 0,
        specialProtein: 0
      };
    });

    const nutritionSettings = this.data.nutritionSettings || NutritionModel.createDefaultSettings();

    records.forEach(record => {
      const recordDayKey = this.normalizeDayKey({ date: record.date });
      if (!weightMap[recordDayKey]) {
        const weight = this.getRecordWeight(record);
        if (weight > 0) weightMap[recordDayKey] = weight;
      }
      const feedings = record.feedings || [];
      feedings.forEach(feed => {
        const feedKey = this.normalizeDayKey(feed);
        const dayKey = statsMap[feedKey] ? feedKey : recordDayKey;
        if (!statsMap[dayKey]) return;
        const nutrition = calculateMilkNutrition(feed, nutritionSettings);
        statsMap[dayKey].milkCalories += Number(nutrition.calories) || 0;
        statsMap[dayKey].naturalProtein += Number(nutrition.naturalProtein) || 0;
        statsMap[dayKey].specialProtein += Number(nutrition.specialProtein) || 0;
      });

      const intakes = record.intakes || [];
      intakes.forEach(intake => {
        const dayKey = statsMap[recordDayKey] ? recordDayKey : null;
        if (!dayKey) return;
        const nutrition = intake.nutrition || {};
        const calories = Number(nutrition.calories) || 0;
        const protein = Number(nutrition.protein) || 0;
        const naturalProtein = typeof intake.naturalProtein === 'number'
          ? intake.naturalProtein
          : (intake.proteinSource === 'special' ? 0 : protein);
        const specialProtein = typeof intake.specialProtein === 'number'

          ? intake.specialProtein
          : (intake.proteinSource === 'special' ? protein : 0);
        const intakeType = this.resolveIntakeType(intake);

        if (intakeType === 'milk') {
          statsMap[dayKey].milkCalories += calories;
          statsMap[dayKey].naturalProtein += naturalProtein;
          statsMap[dayKey].specialProtein += specialProtein;
        } else {
          statsMap[dayKey].foodCalories += calories;
        }
      });
    });

    const dates = dateKeys.map(key => this.formatDayLabel(key));
    const milkCalories = dateKeys.map(key => roundCalories(statsMap[key].milkCalories));
    const foodCalories = dateKeys.map(key => roundCalories(statsMap[key].foodCalories));
    const totalCalories = milkCalories.map((val, index) => roundCalories(val + foodCalories[index]));
    const naturalProtein = dateKeys.map(key => roundNumber(statsMap[key].naturalProtein, 2));
    const specialProtein = dateKeys.map(key => roundNumber(statsMap[key].specialProtein, 2));
    const proteinCoefficient = dateKeys.map((key, index) => {
      const weight = weightMap[key] || 0;
      if (!weight) return 0;
      const totalProtein = naturalProtein[index] + specialProtein[index];
      return roundNumber(totalProtein / weight, 2);
    });
    const calorieCoefficient = dateKeys.map((key, index) => {
      const weight = weightMap[key] || 0;
      if (!weight) return 0;
      return roundNumber(totalCalories[index] / weight, 1);
    });

    const milkRatioDaily = dateKeys.map((key, index) => {
      const total = totalCalories[index];
      if (!total) return 0;
      return roundNumber((milkCalories[index] / total) * 100, 1);
    });
    const foodRatioDaily = dateKeys.map((key, index) => {
      const total = totalCalories[index];
      if (!total) return 0;
      return roundNumber((foodCalories[index] / total) * 100, 1);
    });

    const totalMilkCalories = milkCalories.reduce((sum, value) => sum + value, 0);
    const totalFoodCalories = foodCalories.reduce((sum, value) => sum + value, 0);
    const total = totalMilkCalories + totalFoodCalories;
    const ratio = total > 0
      ? {
        milk: roundNumber((totalMilkCalories / total) * 100, 1),
        food: roundNumber((totalFoodCalories / total) * 100, 1)
      }
      : { milk: 0, food: 0 };

    return {
      dates,
      totalCalories,
      milkCalories,
      foodCalories,
      calorieCoefficient,
      naturalProtein,
      specialProtein,
      proteinCoefficient,
      milkRatioDaily,
      foodRatioDaily,
      ratio,
      rangeLabel
    };
  },

  initCalorieChart(e) {
    this.calorieChart = e.detail.component;
    this.drawCalorieChart();
  },

  initProteinChart(e) {
    this.proteinChart = e.detail.component;
    this.drawProteinChart();
  },

  initRatioChart(e) {
    this.ratioChart = e.detail.component;
    this.drawRatioChart();
  },

  drawCharts() {
    this.drawCalorieChart();
    this.drawProteinChart();
    this.drawRatioChart();
  },

  drawCalorieChart() {
    if (!this.calorieChart) return;
    const { dates, totalCalories, milkCalories, foodCalories, calorieCoefficient } = this.data.chartData;
    if (!dates || !dates.length) return;
    const validCoefficients = (calorieCoefficient || []).filter(v => v > 0);
    const yRightMax = validCoefficients.length
      ? Math.ceil(Math.max(...validCoefficients) / 10) * 10
      : 100;
    this.calorieChart.drawChart({
      xData: dates,
      series: [
        { name: '总热量', data: totalCalories },
        { name: '奶类热量', data: milkCalories },
        { name: '食物热量', data: foodCalories },
        { name: '热量系数(kcal/kg)', data: calorieCoefficient, yAxisIndex: 1 }
      ],
      options: {
        colors: ['#FF7A00', '#FFB800', '#4FC3F7', '#8C9EFF'],
        showGrid: true,
        showLegend: true,
        yAxisLabel: 'kcal',
        yAxisRightLabel: 'kcal/kg',
        yAxisRightMin: 0,
        yAxisRightMax: yRightMax,
        legendFont: '9px sans-serif',
        legendMarkerSize: 10,
        legendMarkerGap: 4,
        legendItemGap: 8,
        legendRowGap: 4,
        legendRowHeight: 14,
        legendMaxRows: 1,
        legendTruncate: false,
        legendOffsetX: -8,
        tooltipPlacement: 'top',
        tooltipTopOffset: 6,
        padding: { top: 36, right: 36, bottom: 56, left: 40 }
      }
    });
  },

  drawProteinChart() {
    if (!this.proteinChart) return;
    const { dates, naturalProtein, specialProtein, proteinCoefficient } = this.data.chartData;
    if (!dates || !dates.length) return;
    const validCoefficients = (proteinCoefficient || []).filter(v => v > 0);
    const yRightMax = validCoefficients.length
      ? Math.ceil(Math.max(...validCoefficients) / 0.5) * 0.5
      : 3;
    this.proteinChart.drawChart({
      xData: dates,
      series: [
        { name: '天然蛋白(g)', data: naturalProtein },
        { name: '特殊蛋白(g)', data: specialProtein },
        { name: '蛋白系数(g/kg)', data: proteinCoefficient, yAxisIndex: 1 }
      ],
      options: {
        colors: ['#4CAF50', '#FF6B6B', '#7E57C2'],
        showGrid: true,
        showLegend: true,
        yAxisLabel: 'g',
        yAxisRightLabel: 'g/kg',
        yAxisRightMin: 0,
        yAxisRightMax: yRightMax,
        legendFont: '9px sans-serif',
        legendMarkerSize: 10,
        legendMarkerGap: 4,
        legendItemGap: 8,
        legendRowGap: 4,
        legendRowHeight: 14,
        legendMaxRows: 1,
        legendTruncate: false,
        legendOffsetX: -8,
        tooltipPlacement: 'top',
        tooltipTopOffset: 6,
        padding: { top: 36, right: 36, bottom: 56, left: 40 }
      }
    });
  },

  drawRatioChart() {
    if (!this.ratioChart) return;
    const { dates, milkRatioDaily, foodRatioDaily } = this.data.chartData;
    if (!dates || !dates.length) return;
    this.ratioChart.drawChart({
      xData: dates,
      series: [
        { name: '奶类(%)', data: milkRatioDaily },
        { name: '食物(%)', data: foodRatioDaily }
      ],
      options: {
        chartType: 'stackedBar',
        colors: ['#FFB800', '#6BB8FF'],
        showGrid: true,
        showLegend: true,
        legendFont: '9px sans-serif',
        legendMarkerSize: 10,
        legendMarkerGap: 4,
        legendItemGap: 8,
        legendRowGap: 4,
        legendRowHeight: 14,
        legendMaxRows: 1,
        legendTruncate: false,
        legendOffsetX: -8,
        tooltipPlacement: 'top',
        tooltipTopOffset: 6,
        padding: { top: 32, right: 28, bottom: 54, left: 40 }
      }
    });
  },

  async loadSummary() {
    try {
      this.setData({ loading: true });
      const { rangeType, useCustomRange, customRange } = this.data;
      let range = null;
      let rangeLabel = '';
      let expectedDays = 0;

      if (useCustomRange && customRange.start && customRange.end) {
        const start = this.parseDateString(customRange.start);
        const end = this.parseDateString(customRange.end);
        range = {
          start,
          end: new Date(end.getTime() + DAY_MS)
        };
        expectedDays = Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS);
        rangeLabel = '自定义';
      } else {
        const rolling = this.getRollingRange(rangeType);
        range = { start: rolling.start, end: rolling.end };
        expectedDays = rolling.days;
        rangeLabel = rangeType === 'month' ? '最近30天' : '最近7天';
      }

      const rangeText = this.formatRangeText(rangeType, range.start, range.end);

      const records = await this.fetchFeedingRecords(range.start, range.end);
      let milkTotal = 0;
      let naturalTotal = 0;
      let specialTotal = 0;
      let milkRecordsCount = 0;
      let foodRecordsCount = 0;
      let milkCaloriesTotal = 0;
      let foodCaloriesTotal = 0;
      const dailyTotals = {};

      const addMilkSample = (dayKey, sample = {}) => {
        const total = Number(sample.totalVolume) || 0;
        const special = Number(sample.specialVolume) || 0;
        const natural = Number(sample.naturalVolume) || Math.max(total - special, 0);
        const calories = Number(sample.calories) || 0;
        if (dayKey === 'unknown' || total <= 0) return;
        dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + total;
        milkTotal += total;
        naturalTotal += natural;
        specialTotal += special;
        milkCaloriesTotal += calories;
        milkRecordsCount += 1;
      };

      (records || []).forEach(record => {
        const recordDayKey = this.normalizeDayKey({ date: record.date });
        const feedings = record.feedings || [];
        feedings.forEach(feed => {
          const nat = parseFloat(feed.naturalMilkVolume) || 0;
          const spe = parseFloat(feed.specialMilkVolume) || 0;
          const total = nat + spe;
          const nutrition = calculateMilkNutrition(feed, this.data.nutritionSettings || NutritionModel.createDefaultSettings());
          const dayKey = this.normalizeDayKey(feed);
          addMilkSample(dayKey !== 'unknown' ? dayKey : recordDayKey, {
            totalVolume: total,
            specialVolume: spe,
            naturalVolume: nat,
            calories: Number(nutrition.calories) || 0
          });
        });

        // 与图表口径保持一致：将 milk 类型 intake 也纳入统计
        const intakes = record.intakes || [];
        intakes.forEach(intake => {
          const intakeType = this.resolveIntakeType(intake);
          const calories = Number(intake.nutrition?.calories) || 0;
          if (intakeType !== 'milk') {
            foodRecordsCount += 1;
            foodCaloriesTotal += calories;
            return;
          }

          const quantity = Number(intake.quantity) || 0;
          const isSpecial = intake.proteinSource === 'special' || intake.milkType === 'special_formula';

          // 优先使用 quantity 作为体积；缺失时按热量反推
          let total = quantity;
          if (!total && calories > 0) {
            const kcalPerMl = isSpecial ? SPECIAL_MILK_KCAL : BREAST_MILK_KCAL;
            total = calories / kcalPerMl;
          }
          if (total <= 0) return;

          const special = isSpecial ? total : 0;
          const natural = isSpecial ? 0 : total;
          const resolvedCalories = calories || (total * (isSpecial ? SPECIAL_MILK_KCAL : BREAST_MILK_KCAL));
          const intakeDayKey = this.normalizeDayKey({
            date: intake.date,
            startDateTime: intake.recordTime
          });
          addMilkSample(intakeDayKey !== 'unknown' ? intakeDayKey : recordDayKey, {
            totalVolume: total,
            specialVolume: special,
            naturalVolume: natural,
            calories: resolvedCalories
          });
        });
      });

      const dayEntries = Object.entries(dailyTotals)
        .filter(([dayKey]) => dayKey !== 'unknown')
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      const days = dayEntries.map(([, value]) => Number(value) || 0);
      const daysRecorded = days.length;

      let volatility = '--';
      let volatilityValue = null;
      let cv = '--';
      let cvValue = null;
      if (days.length > 1) {
        const mean = days.reduce((a, b) => a + b, 0) / days.length;
        const variance = days.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / days.length;
        const std = Math.sqrt(variance);
        volatility = std.toFixed(1);
        volatilityValue = Number(volatility);
        if (mean > 0) {
          cvValue = (std / mean) * 100;
          cv = `${cvValue.toFixed(1)}%`;
        }
      }

      const hasAnyRecords = Array.isArray(records) && records.length > 0;
      const hasAnySamples = hasAnyRecords || milkRecordsCount > 0 || foodRecordsCount > 0;
      const totalCalories = milkCaloriesTotal + foodCaloriesTotal;
      const milkCalorieRatioValue = totalCalories > 0 ? (milkCaloriesTotal / totalCalories) * 100 : null;
      const foodCalorieRatioValue = totalCalories > 0 ? (foodCaloriesTotal / totalCalories) * 100 : null;
      const safeMilkRatioValue = milkCalorieRatioValue === null ? 0 : milkCalorieRatioValue;
      const safeFoodRatioValue = foodCalorieRatioValue === null ? 0 : foodCalorieRatioValue;
      const specialRatio = milkTotal > 0 ? (specialTotal / milkTotal) * 100 : null;
      const specialRatioValue = specialRatio === null ? 0 : specialRatio;
      const naturalRatioValue = milkTotal > 0 ? ((naturalTotal / milkTotal) * 100) : 0;
      const specialRatioDisplay = specialRatio === null
        ? (hasAnySamples ? '0.0%' : '--')
        : `${specialRatio.toFixed(1)}%`;
      const milkCalorieRatio = milkCalorieRatioValue === null
        ? (hasAnySamples ? '0.0%' : '--')
        : `${milkCalorieRatioValue.toFixed(1)}%`;
      const foodCalorieRatio = foodCalorieRatioValue === null
        ? (hasAnySamples ? '0.0%' : '--')
        : `${foodCalorieRatioValue.toFixed(1)}%`;
      const avgPerDayValue = daysRecorded ? Math.round(milkTotal / daysRecorded) : null;
      const avgPerDay = avgPerDayValue === null ? (hasAnySamples ? 0 : '--') : avgPerDayValue;
      const periodAvgPerDayValue = expectedDays ? Math.round(milkTotal / expectedDays) : null;
      const periodAvgPerDay = periodAvgPerDayValue === null ? '--' : periodAvgPerDayValue;
      const coveragePercent = expectedDays ? Math.round((daysRecorded / expectedDays) * 100) : 0;
      const coverage = daysRecorded ? `${coveragePercent}%` : (hasAnySamples ? '0%' : '--');
      const medianPerDayValue = this.calculateMedian(days);
      const medianPerDay = medianPerDayValue === null ? (hasAnySamples ? 0 : '--') : Math.round(medianPerDayValue);
      const avgPerFeed = milkRecordsCount ? Math.round(milkTotal / milkRecordsCount) : null;
      const trendSlopeValue = this.calculateLinearTrendSlope(dayEntries, range.start);
      const trendLabel = this.getTrendLabel(trendSlopeValue);
      const trendSlopeDisplay = trendSlopeValue === null ? '--' : `${roundNumber(trendSlopeValue, 1)} ml/天`;
      const dataQuality = this.getDataQualityLevel({
        hasAnyRecords: hasAnySamples,
        daysRecorded,
        coveragePercent,
        milkRecordsCount
      });

      let maxEntry = null;
      let minEntry = null;
      if (dayEntries.length) {
        maxEntry = dayEntries.reduce((best, cur) => (cur[1] > best[1] ? cur : best), dayEntries[0]);
        minEntry = dayEntries.reduce((best, cur) => (cur[1] < best[1] ? cur : best), dayEntries[0]);
      }

      const summary = {
        avgPerDay,
        periodAvgPerDay,
        avgPerFeed: avgPerFeed === null ? (hasAnySamples ? 0 : '--') : avgPerFeed,
        trendLabel,
        trendSlope: trendSlopeDisplay,
        dataQuality,
        coverage,
        medianPerDay,
        cv: cv === '--' && hasAnySamples ? '0.0%' : cv,
        naturalVolume: hasAnySamples ? Math.round(naturalTotal) : '--',
        specialVolume: hasAnySamples ? Math.round(specialTotal) : '--',
        naturalRatioText: hasAnySamples ? `${naturalRatioValue.toFixed(1)}%` : '--',
        naturalRatioValue: roundNumber(naturalRatioValue, 1),
        specialRatioValue: roundNumber(specialRatioValue, 1),
        milkCalorieRatio,
        foodCalorieRatio,
        milkCalorieRatioValue: roundNumber(safeMilkRatioValue, 1),
        foodCalorieRatioValue: roundNumber(safeFoodRatioValue, 1),
        specialRatio: specialRatioDisplay,
        volatility: volatility === '--' && hasAnySamples ? '0.0' : volatility,
        recordDays: daysRecorded,
        expectedDays,
        records: milkRecordsCount,
        foodRecords: foodRecordsCount,
        milkTotal: hasAnySamples ? Math.round(milkTotal) : '--',
        milkCaloriesTotal: hasAnySamples ? roundCalories(milkCaloriesTotal) : '--',
        foodCaloriesTotal: hasAnySamples ? roundCalories(foodCaloriesTotal) : '--'
      };

      const objectiveFindings = this.buildObjectiveFindings({
        hasAnySamples,
        daysRecorded,
        expectedDays,
        coveragePercent,
        trendSlopeValue,
        trendLabel,
        naturalTotal,
        specialTotal,
        naturalRatioValue: roundNumber(naturalRatioValue, 1),
        specialRatioValue: roundNumber(specialRatioValue, 1),
        milkCaloriesTotal,
        foodCaloriesTotal,
        milkCalorieRatioValue: safeMilkRatioValue,
        foodCalorieRatioValue: safeFoodRatioValue
      });
      const metricDefinitions = this.buildMetricDefinitions();

      const narratives = this.buildNarratives({
        hasAnyRecords,
        rangeLabel,
        daysRecorded,
        expectedDays,
        avgPerDayValue,
        periodAvgPerDayValue,
        medianPerDayValue,
        avgPerFeed,
        records: milkRecordsCount,
        foodRecords: foodRecordsCount,
        naturalTotal,
        specialTotal,
        milkCalorieRatioValue,
        foodCalorieRatioValue,
        coverage,
        volatilityValue,
        cvValue
      });

      const insights = this.buildInsights({
        hasAnyRecords,
        dayEntries,
        trendSlopeValue,
        trendLabel,
        cv,
        volatility,
        maxEntry,
        minEntry,
        daysRecorded,
        naturalTotal,
        specialTotal,
        milkCalorieRatioValue,
        foodCalorieRatioValue,
        rangeLabel
      });

      const reminders = this.buildReminders({
        hasAnyRecords,
        daysRecorded,
        expectedDays,
        records: milkRecordsCount,
        coveragePercent
      });

      const chartData = this.buildChartData(records, range, rangeLabel);

      this.setData({
        rangeLabel,
        rangeText,
        summary,
        objectiveFindings,
        metricDefinitions,
        narratives,
        insights,
        reminders: reminders.slice(0, 2),
        chartData,
        hasChartData: records && records.length > 0,
        loading: false
      }, () => {
        this.drawCharts();
      });
    } catch (err) {
      console.error('加载趋势报告失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  buildInsights(meta) {
    const list = [];
    if (!meta.hasAnyRecords) {
      return list;
    }

    if (!meta.daysRecorded) {
      list.push({
        title: '趋势判断',
        desc: '当前区间奶类样本为0，无法计算趋势斜率。',
        level: 'info'
      });
    } else if (meta.trendSlopeValue === null) {
      list.push({
        title: '趋势判断',
        desc: '有效样本天数不足2天，无法计算线性趋势斜率。',
        level: 'info'
      });
    } else {
      list.push({
        title: '趋势判断',
        desc: `${roundNumber(meta.trendSlopeValue, 1)} ml/天（${meta.trendLabel}）`,
        level: 'info'
      });
    }

    if (meta.maxEntry && meta.minEntry) {
      const spread = Math.round((Number(meta.maxEntry[1]) || 0) - (Number(meta.minEntry[1]) || 0));
      list.push({
        title: '波动幅度',
        desc: `最高 ${this.formatDayLabel(meta.maxEntry[0])} ${Math.round(meta.maxEntry[1])}ml；最低 ${this.formatDayLabel(meta.minEntry[0])} ${Math.round(meta.minEntry[1])}ml；振幅 ${spread}ml。`,
        level: 'info'
      });
    }

    list.push({
      title: '离散程度',
      desc: `标准差 ${meta.volatility}ml，变异系数 ${meta.cv}。`,
      level: 'info'
    });

    return list;
  },

  buildNarratives(meta) {
    const lines = [];
    if (!meta.hasAnyRecords) {
      lines.push({ text: `${meta.rangeLabel}暂无喂养记录，无法进行统计分析。` });
      return lines;
    }

    lines.push({
      text: `${meta.rangeLabel}区间共${meta.expectedDays}天，奶量记录${meta.daysRecorded}天（奶量覆盖率${meta.coverage}），奶类记录${meta.records}笔，食物记录${meta.foodRecords}笔。`
    });

    if (meta.daysRecorded > 0 && meta.avgPerDayValue !== null && meta.medianPerDayValue !== null) {
      lines.push({
        text: `记录日统计：均值${meta.avgPerDayValue}ml，中位数${Math.round(meta.medianPerDayValue)}ml，标准差${meta.volatilityValue ? meta.volatilityValue.toFixed(1) : '--'}ml，变异系数${meta.cvValue !== null && meta.cvValue !== undefined ? `${meta.cvValue.toFixed(1)}%` : '--'}。`
      });
    } else if (meta.daysRecorded === 0) {
      lines.push({ text: '奶量样本为0，奶量均值/中位数/波动指标不参与计算。' });
    }

    if (meta.periodAvgPerDayValue !== null && meta.avgPerFeed !== null) {
      lines.push({
        text: `区间日均（含未记录日）${meta.periodAvgPerDayValue}ml，单次均量${meta.avgPerFeed}ml。`
      });
    }

    const naturalText = `${Math.round(Number(meta.naturalTotal) || 0)}ml`;
    const specialText = `${Math.round(Number(meta.specialTotal) || 0)}ml`;
    const milkRatioText = meta.milkCalorieRatioValue === null || meta.milkCalorieRatioValue === undefined
      ? '--'
      : `${meta.milkCalorieRatioValue.toFixed(1)}%`;
    const foodRatioText = meta.foodCalorieRatioValue === null || meta.foodCalorieRatioValue === undefined
      ? '--'
      : `${meta.foodCalorieRatioValue.toFixed(1)}%`;
    lines.push({
      text: `结构统计：天然奶${naturalText}，特殊奶${specialText}；热量占比奶类${milkRatioText}、食物${foodRatioText}。`
    });

    return lines;
  },

  buildReminders(meta) {
    const tips = [];
    if (!meta.hasAnyRecords) {
      tips.push({ text: '无可分析样本：当前区间没有喂养记录。' });
      return tips;
    }

    if (meta.coveragePercent < 60) {
      tips.push({ text: `统计代表性提示：覆盖率仅${meta.coveragePercent}%，结果受缺失日期影响较大。` });
    }

    if (meta.daysRecorded < 3) {
      tips.push({ text: '样本稳定性提示：有效样本天数小于3天，趋势斜率仅供参考。' });
    }

    if (meta.daysRecorded > 0 && (meta.records / meta.daysRecorded) < 2) {
      tips.push({ text: '数据密度提示：平均每天记录少于2笔，日内波动信息不足。' });
    }

    if (!tips.length) {
      tips.push({ text: '统计质量：样本量与覆盖率满足基础分析条件。' });
    }
    return tips;
  }
});
