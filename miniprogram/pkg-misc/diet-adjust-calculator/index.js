const MilkNutritionProfileModel = require('../../models/nutritionProfile');
const FoodModel = require('../../models/food');
const FeedingRecordV2Model = require('../../models/feedingRecordV2');
const FoodIntakeRecordModel = require('../../models/foodIntakeRecord');
const DailySummaryV2Model = require('../../models/dailySummaryV2');
const {
  buildBreastMilkComponent,
  buildFormulaPowderComponent,
  buildNutritionSummary
} = require('../../utils/feedingRecordV2Utils');
const {
  getNutritionTargetPreferences
} = require('../../utils/nutritionTargetPreferences');
const {
  solveDietAdjust,
  summarizeQuantities
} = require('../../utils/dietAdjustCalculator');

function round(value, precision = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const multiplier = 10 ** precision;
  return Math.round((number + Number.EPSILON) * multiplier) / multiplier;
}

function formatDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function timeForIndex(index) {
  const totalMinutes = 8 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function dateTime(date, time) {
  return new Date(`${date}T${time}:00`);
}

function equalized(items = []) {
  const selectedCount = items.filter((item) => item.selected).length;
  let assigned = 0;
  let selectedIndex = 0;
  return items.map((item) => {
    if (!item.selected || selectedCount === 0) return { ...item, sharePercent: 0 };
    selectedIndex += 1;
    const sharePercent = selectedIndex === selectedCount
      ? round(100 - assigned, 2)
      : round(100 / selectedCount, 2);
    assigned += sharePercent;
    return { ...item, sharePercent };
  });
}

function withDensity(nutrition = {}, basis = 100) {
  const denominator = Number(basis) || 100;
  return {
    proteinPerUnit: (Number(nutrition.protein) || 0) / denominator,
    caloriesPerUnit: (Number(nutrition.calories) || 0) / denominator,
    fatPerUnit: (Number(nutrition.fat) || 0) / denominator,
    carbsPerUnit: (Number(nutrition.carbs) || 0) / denominator
  };
}

function splitProtein(food = {}, protein = 0) {
  if (food.proteinSource === 'special') {
    return { naturalProtein: 0, specialProtein: protein };
  }
  if (food.proteinSource === 'mixed' && food.proteinSplit) {
    const natural = Number(food.proteinSplit.natural) || 0;
    const special = Number(food.proteinSplit.special) || 0;
    const total = natural + special || 1;
    return {
      naturalProtein: protein * natural / total,
      specialProtein: protein * special / total
    };
  }
  return { naturalProtein: protein, specialProtein: 0 };
}

Page({
  data: {
    step: 1,
    loading: true,
    applying: false,
    babyUid: '',
    nutritionSettings: {},
    weight: 0,
    targetPreferences: {},
    normalMilks: [],
    specialMilks: [],
    foods: [],
    selectedNormalMilks: [],
    selectedSpecialMilks: [],
    selectedFoods: [],
    mode: 'protein',
    target: '',
    milkRatioPercent: 70,
    foodRatioPercent: 30,
    normalMilkOfMilkPercent: 50,
    specialMilkOfMilkPercent: 50,
    resultItems: [],
    achieved: {
      protein: 0,
      calories: 0,
      fat: 0,
      carbs: 0,
      premiumProtein: 0
    },
    applyDate: formatDate(),
    hasBothMilkGroups: false
  },

  onLoad() {
    const app = getApp();
    const babyUid = app.globalData.babyUid || wx.getStorageSync('baby_uid') || '';
    this.setData({ babyUid });
    if (!babyUid) {
      this.setData({ loading: false });
      wx.showToast({ title: '请先登录并选择宝宝', icon: 'none' });
      return;
    }
    this.loadOptions();
  },

  async loadOptions() {
    this.setData({ loading: true });
    try {
      const today = formatDate();
      const [settings, foods, targetPreferences, basicInfo] = await Promise.all([
        MilkNutritionProfileModel.getNutritionProfileSettings(this.data.babyUid, {
          includeLegacyFallback: true
        }),
        FoodModel.getAvailableFoods(this.data.babyUid),
        getNutritionTargetPreferences(this.data.babyUid),
        FeedingRecordV2Model.resolveBasicInfoSnapshot(this.data.babyUid, today, {
          includeFallbacks: true,
          includeProfileInitial: true,
          carryForwardMissing: true
        })
      ]);
      const nutritionSettings = settings || {};
      const formulaPowders = (nutritionSettings.formulaPowders || [])
        .filter((powder) => powder.status !== 'archived');
      const breastDensity = withDensity({
        protein: nutritionSettings.natural_milk_protein,
        calories: nutritionSettings.natural_milk_calories,
        fat: nutritionSettings.natural_milk_fat,
        carbs: nutritionSettings.natural_milk_carbs
      });
      const breastMilk = {
        key: 'breast_milk',
        kind: 'breast_milk',
        name: '母乳',
        unit: 'ml',
        selected: false,
        sharePercent: 0,
        premiumProteinPerUnit: breastDensity.proteinPerUnit,
        ...breastDensity
      };
      const powderItems = formulaPowders.map((powder) => {
        const density = withDensity(powder.nutritionPer100g || {});
        return {
          key: `powder_${powder.id}`,
          kind: 'formula_powder',
          name: powder.name,
          unit: 'g',
          selected: false,
          sharePercent: 0,
          powder,
          mixRatio: powder.mixRatio || {},
          premiumProteinPerUnit: powder.proteinRole === 'natural' ? density.proteinPerUnit : 0,
          ...density
        };
      });
      const normalMilks = [
        breastMilk,
        ...powderItems.filter((item) => (
          item.powder.category === 'regular_formula'
          && item.powder.proteinRole !== 'special'
        ))
      ];
      const specialMilks = powderItems.filter((item) => (
        item.powder.category === 'special_formula'
        || item.powder.proteinRole === 'special'
      ));
      const foodItems = (foods || []).map((food) => {
        const basis = food.nutritionBasis || {
          quantity: food.baseQuantity || 100,
          unit: food.baseUnit || (food.isLiquid ? 'ml' : 'g')
        };
        const nutrition = food.nutritionPerBasis || food.nutritionPerUnit || {};
        const density = withDensity(nutrition, basis.quantity);
        return {
          key: `food_${food._id}`,
          kind: 'food',
          name: food.name,
          unit: basis.unit || 'g',
          selected: false,
          sharePercent: 0,
          food,
          premiumProteinPerUnit: food.proteinQuality === 'premium' ? density.proteinPerUnit : 0,
          ...density
        };
      });
      const weight = Number(basicInfo?.weight) || 0;
      const preferredMode = targetPreferences.preferredTargetMode === 'calorie' ? 'calorie' : 'protein';
      this.setData({
        nutritionSettings,
        normalMilks,
        specialMilks,
        foods: foodItems,
        targetPreferences,
        weight,
        mode: preferredMode,
        target: this.defaultTarget(preferredMode, weight, targetPreferences),
        loading: false
      });
    } catch (error) {
      console.error('加载饮食调整换算数据失败:', error);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
    }
  },

  defaultTarget(mode, weight, preferences = {}) {
    if (!(weight > 0)) return '';
    if (mode === 'calorie') {
      const coefficient = Number(preferences.calorieCoefficient);
      return coefficient > 0 ? round(weight * coefficient, 0) : '';
    }
    const natural = Number(preferences.naturalProteinCoefficient) || 0;
    const special = Number(preferences.specialProteinCoefficient) || 0;
    const coefficient = natural + special;
    return coefficient > 0 ? round(weight * coefficient, 2) : '';
  },

  toggleOption(event) {
    const group = event.currentTarget.dataset.group;
    const key = event.currentTarget.dataset.key;
    const list = this.data[group] || [];
    const target = list.find((item) => item.key === key);
    if (!target) return;
    if (group === 'foods' && !target.selected && list.filter((item) => item.selected).length >= 3) {
      wx.showToast({ title: '食物最多选择 3 种', icon: 'none' });
      return;
    }
    const next = equalized(list.map((item) => (
      item.key === key ? { ...item, selected: !item.selected } : item
    )));
    this.setData({ [group]: next });
  },

  goToTargets() {
    const selectedCount = ['normalMilks', 'specialMilks', 'foods']
      .reduce((total, group) => total + this.data[group].filter((item) => item.selected).length, 0);
    if (!selectedCount) {
      wx.showToast({ title: '请至少选择 1 个品项', icon: 'none' });
      return;
    }
    const selectedNormalMilks = this.data.normalMilks.filter((item) => item.selected);
    const selectedSpecialMilks = this.data.specialMilks.filter((item) => item.selected);
    const selectedFoods = this.data.foods.filter((item) => item.selected);
    this.setData({
      step: 2,
      selectedNormalMilks,
      selectedSpecialMilks,
      selectedFoods,
      hasBothMilkGroups: selectedNormalMilks.length > 0 && selectedSpecialMilks.length > 0
    });
  },

  backStep() {
    if (this.data.step > 1) this.setData({ step: this.data.step - 1 });
  },

  chooseMode(event) {
    const mode = event.currentTarget.dataset.mode;
    this.setData({
      mode,
      target: this.defaultTarget(mode, this.data.weight, this.data.targetPreferences)
    });
  },

  updateField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  updateShare(event) {
    const group = event.currentTarget.dataset.group;
    const index = Number(event.currentTarget.dataset.index);
    const list = [...(this.data[group] || [])];
    list[index] = { ...list[index], sharePercent: event.detail.value };
    this.setData({ [group]: list });
  },

  calculate() {
    const result = solveDietAdjust({
      mode: this.data.mode,
      target: this.data.target,
      milkRatio: Number(this.data.milkRatioPercent) / 100,
      foodRatio: Number(this.data.foodRatioPercent) / 100,
      normalMilkOfMilkRatio: Number(this.data.normalMilkOfMilkPercent) / 100,
      specialMilkOfMilkRatio: Number(this.data.specialMilkOfMilkPercent) / 100,
      normalMilks: this.data.selectedNormalMilks,
      specialMilks: this.data.selectedSpecialMilks,
      foods: this.data.selectedFoods
    });
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none', duration: 2600 });
      return;
    }
    this.setData({
      step: 3,
      resultItems: result.items,
      achieved: result.achieved
    });
  },

  updateQuantity(event) {
    const index = Number(event.currentTarget.dataset.index);
    const resultItems = [...this.data.resultItems];
    resultItems[index] = {
      ...resultItems[index],
      quantity: event.detail.value,
      waterVolume: resultItems[index].kind === 'formula_powder'
        ? round(
          Number(event.detail.value)
          * (Number(resultItems[index].mixRatio?.water) || 0)
          / (Number(resultItems[index].mixRatio?.powder) || 1),
          0
        )
        : resultItems[index].waterVolume
    };
    this.setData({
      resultItems,
      achieved: summarizeQuantities(resultItems)
    });
  },

  goToApply() {
    if (this.data.resultItems.some((item) => !(Number(item.quantity) > 0))) {
      wx.showToast({ title: '所有推荐量都须大于 0', icon: 'none' });
      return;
    }
    this.setData({ step: 4 });
  },

  chooseApplyDate(event) {
    this.setData({ applyDate: event.detail.value });
  },

  confirmApply() {
    if (this.data.applying) return;
    wx.showModal({
      title: '确认覆盖记录',
      content: '可能覆盖当天喂奶与辅食，确认后将删除当天奶和辅食并写入推荐量（不预查）',
      confirmText: '确认应用',
      confirmColor: '#E39A00',
      success: (result) => {
        if (result.confirm) this.applyPlan();
      }
    });
  },

  async applyPlan() {
    const { babyUid, applyDate, resultItems } = this.data;
    if (!babyUid || !resultItems.length) return;
    this.setData({ applying: true });
    wx.showLoading({ title: '正在应用' });
    let deleteStarted = false;
    try {
      const [milkRecords, foodRecords] = await Promise.all([
        FeedingRecordV2Model.getRecordsByDate(babyUid, applyDate),
        FoodIntakeRecordModel.findByDate(babyUid, applyDate)
      ]);
      deleteStarted = true;
      for (const record of milkRecords || []) {
        await FeedingRecordV2Model.deleteRecord(record._id || record.id, { babyUid });
      }
      for (const record of foodRecords || []) {
        await FoodIntakeRecordModel.softDeleteFoodIntake(record._id, { babyUid });
      }
      for (let index = 0; index < resultItems.length; index += 1) {
        const item = resultItems[index];
        const time = timeForIndex(index);
        if (item.kind === 'food') {
          await this.writeFood(item, time);
        } else {
          await this.writeMilk(item, time);
        }
      }
      await DailySummaryV2Model.markDirty(babyUid, applyDate);
      wx.hideLoading();
      wx.showToast({ title: '已应用到所选日期', icon: 'success' });
    } catch (error) {
      console.error('应用饮食调整方案失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: deleteStarted
          ? '应用失败，旧记录可能已清除，请到数据记录页检查该日并手工补录'
          : '应用失败，请稍后重试',
        icon: 'none',
        duration: 4000
      });
    } finally {
      this.setData({ applying: false });
    }
  },

  async writeMilk(item, time) {
    const quantity = Number(item.quantity);
    const component = item.kind === 'breast_milk'
      ? buildBreastMilkComponent(quantity, this.data.nutritionSettings)
      : buildFormulaPowderComponent(item.powder, {
        powderWeight: quantity,
        waterVolume: Number(item.waterVolume) || 0,
        ratioMode: 'standard'
      });
    const formulaComponents = [component];
    await FeedingRecordV2Model.addRecord({
      babyUid: this.data.babyUid,
      date: this.data.applyDate,
      startTime: time,
      endTime: '',
      startDateTime: dateTime(this.data.applyDate, time),
      endDateTime: null,
      formulaComponents,
      nutritionSummary: buildNutritionSummary(formulaComponents),
      notes: '饮食调整换算推荐量'
    });
  },

  async writeFood(item, time) {
    const food = item.food;
    const quantity = Number(item.quantity);
    const nutritionBase = FoodModel.calculateNutrition(food, quantity);
    const protein = Number(nutritionBase.protein) || 0;
    const proteinSplit = splitProtein(food, protein);
    const nutrition = {
      ...nutritionBase,
      naturalProtein: round(proteinSplit.naturalProtein, 2),
      specialProtein: round(proteinSplit.specialProtein, 2)
    };
    await FoodIntakeRecordModel.createFoodIntake({
      babyUid: this.data.babyUid,
      date: this.data.applyDate,
      time,
      recordedAt: time,
      foodId: food._id || '',
      foodName: food.name,
      foodSnapshot: FoodModel.buildFoodSnapshot(food),
      quantity,
      unit: item.unit || food.baseUnit || 'g',
      nutrition,
      proteinSource: food.proteinSource || 'natural',
      proteinQuality: food.proteinQuality || '',
      sourceType: food.sourceType || (food.isSystem ? 'system' : 'user_custom'),
      source: 'diet_adjust_calculator',
      completionPercent: 100,
      notes: '饮食调整换算推荐量'
    });
  }
});
