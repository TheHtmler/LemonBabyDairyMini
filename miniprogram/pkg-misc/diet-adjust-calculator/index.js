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
const {
  getDefaultMacroRatioRangesByBirthday,
  buildMacroRatioSummary,
  parseRangeInputs
} = require('../../utils/dietAdjustMacroRanges');

const FOOD_SELECT_LIMIT = 5;

const PICKER_META = {
  normalMilks: { title: '添加普奶', empty: '暂无普奶', catalogKey: 'normalMilkCatalog' },
  specialMilks: { title: '添加特奶', empty: '暂无特奶', catalogKey: 'specialMilkCatalog' },
  energyPowders: { title: '添加能量粉', empty: '暂无能量粉', catalogKey: 'energyPowderCatalog' },
  foods: { title: '添加辅食', empty: '暂无食物', catalogKey: 'foodCatalog' }
};

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

function normalizeSearchText(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, '');
}

function fuzzyIncludes(text = '', query = '') {
  const source = normalizeSearchText(text);
  const keyword = normalizeSearchText(query);
  if (!keyword) return true;
  if (!source) return false;
  if (source.includes(keyword)) return true;
  let queryIndex = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === keyword[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === keyword.length) return true;
    }
  }
  return false;
}

function applyRangeDefaults(ranges = {}) {
  return {
    proteinEnergyMin: ranges.proteinEnergy?.min ?? '',
    proteinEnergyMax: ranges.proteinEnergy?.max ?? '',
    fatEnergyMin: ranges.fatEnergy?.min ?? '',
    fatEnergyMax: ranges.fatEnergy?.max ?? '',
    carbsEnergyMin: ranges.carbsEnergy?.min ?? '',
    carbsEnergyMax: ranges.carbsEnergy?.max ?? '',
    premiumRatioMin: ranges.premiumProteinRatio?.min ?? '',
    premiumRatioMax: ranges.premiumProteinRatio?.max ?? '',
    ageRangeLabel: ranges.fatEnergy?.label || '参考'
  };
}

Page({
  data: {
    loading: true,
    applying: false,
    showMoreTargets: false,
    hasResult: false,
    babyUid: '',
    birthday: '',
    ageMonths: null,
    nutritionSettings: {},
    weight: 0,
    targetPreferences: {},
    normalMilkCatalog: [],
    specialMilkCatalog: [],
    energyPowderCatalog: [],
    foodCatalog: [],
    selectedNormalMilks: [],
    selectedSpecialMilks: [],
    selectedEnergyPowders: [],
    selectedFoods: [],
    mode: 'protein',
    target: '',
    calorieTarget: '',
    milkRatioPercent: 70,
    proteinEnergyMin: '',
    proteinEnergyMax: '',
    fatEnergyMin: '',
    fatEnergyMax: '',
    carbsEnergyMin: '',
    carbsEnergyMax: '',
    premiumRatioMin: '',
    premiumRatioMax: '',
    ageRangeLabel: '',
    resultItems: [],
    achieved: {
      protein: 0,
      calories: 0,
      fat: 0,
      carbs: 0,
      premiumProtein: 0
    },
    comparisonTargets: {},
    macroRows: [],
    hints: [],
    applyDate: formatDate(),
    showPicker: false,
    pickerGroup: '',
    pickerTitle: '',
    pickerKeyword: '',
    pickerEmpty: '',
    pickerOptions: []
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

  async loadBirthday(babyUid) {
    try {
      const cached = getApp()?.globalData?.babyInfo;
      if (cached?.babyUid === babyUid && cached.birthday) return cached.birthday;
      const res = await wx.cloud.database().collection('baby_info').where({ babyUid }).limit(1).get();
      return res?.data?.[0]?.birthday || '';
    } catch (error) {
      return '';
    }
  },

  async loadOptions() {
    this.setData({ loading: true });
    try {
      const today = formatDate();
      const [settings, foods, targetPreferences, basicInfo, birthday] = await Promise.all([
        MilkNutritionProfileModel.getNutritionProfileSettings(this.data.babyUid, {
          includeLegacyFallback: true
        }),
        FoodModel.getAvailableFoods(this.data.babyUid),
        getNutritionTargetPreferences(this.data.babyUid),
        FeedingRecordV2Model.resolveBasicInfoSnapshot(this.data.babyUid, today, {
          includeFallbacks: true,
          includeProfileInitial: true,
          carryForwardMissing: true
        }),
        this.loadBirthday(this.data.babyUid)
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
        premiumProteinPerUnit: breastDensity.proteinPerUnit,
        ...breastDensity
      };
      const powderItems = formulaPowders.map((powder) => {
        const density = withDensity(powder.nutritionPer100g || {});
        const isNaturalRole = powder.proteinRole === 'natural'
          || powder.category === 'regular_formula'
          || powder.category === 'breast_milk';
        return {
          key: `powder_${powder.id}`,
          kind: 'formula_powder',
          name: powder.name,
          unit: 'g',
          powder,
          mixRatio: powder.mixRatio || {},
          premiumProteinPerUnit: isNaturalRole ? density.proteinPerUnit : 0,
          ...density
        };
      });
      const energyPowderCatalog = powderItems.filter((item) => (
        item.powder.category === 'energy_supplement'
      ));
      const specialMilkCatalog = powderItems.filter((item) => {
        const category = item.powder.category;
        if (category === 'energy_supplement') return false;
        return category === 'special_formula' || item.powder.proteinRole === 'special';
      });
      const normalMilkCatalog = [
        breastMilk,
        ...powderItems.filter((item) => {
          const category = item.powder.category;
          if (category === 'energy_supplement' || category === 'special_formula') return false;
          if (item.powder.proteinRole === 'special') return false;
          return category === 'regular_formula'
            || category === 'breast_milk'
            || item.powder.proteinRole === 'natural';
        })
      ];
      const foodCatalog = (foods || []).map((food) => {
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
          food,
          premiumProteinPerUnit: food.proteinQuality === 'premium' ? density.proteinPerUnit : 0,
          ...density
        };
      });
      const weight = Number(basicInfo?.weight) || 0;
      const preferredMode = targetPreferences.preferredTargetMode === 'calorie' ? 'calorie' : 'protein';
      const { ageMonths, ranges } = getDefaultMacroRatioRangesByBirthday(birthday);
      this.setData({
        nutritionSettings,
        normalMilkCatalog,
        specialMilkCatalog,
        energyPowderCatalog,
        foodCatalog,
        targetPreferences,
        weight,
        birthday,
        ageMonths,
        mode: preferredMode,
        target: this.defaultTarget(preferredMode, weight, targetPreferences),
        calorieTarget: this.defaultCalorieTarget(weight, targetPreferences),
        ...applyRangeDefaults(ranges),
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

  defaultCalorieTarget(weight, preferences = {}) {
    if (!(weight > 0)) return '';
    const coefficient = Number(preferences.calorieCoefficient);
    return coefficient > 0 ? round(weight * coefficient, 0) : '';
  },

  toggleMoreTargets() {
    this.setData({ showMoreTargets: !this.data.showMoreTargets });
  },

  chooseMode(event) {
    const mode = event.currentTarget.dataset.mode;
    this.setData({
      mode,
      target: this.defaultTarget(mode, this.data.weight, this.data.targetPreferences),
      hasResult: false
    });
  },

  updateField(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value, hasResult: false });
  },

  onMilkRatioChanging(event) {
    this.setData({
      milkRatioPercent: Number(event.detail.value),
      hasResult: false
    });
  },

  openPicker(event) {
    const group = event.currentTarget.dataset.group;
    const meta = PICKER_META[group];
    if (!meta) return;
    this.setData({
      showPicker: true,
      pickerGroup: group,
      pickerTitle: meta.title,
      pickerEmpty: meta.empty,
      pickerKeyword: '',
      pickerOptions: this.buildPickerOptions(group, '')
    });
  },

  closePicker() {
    this.setData({ showPicker: false, pickerKeyword: '', pickerOptions: [] });
  },

  noop() {},

  onPickerSearch(event) {
    const keyword = event.detail.value || '';
    this.setData({
      pickerKeyword: keyword,
      pickerOptions: this.buildPickerOptions(this.data.pickerGroup, keyword)
    });
  },

  buildPickerOptions(group, keyword = '') {
    const meta = PICKER_META[group];
    if (!meta) return [];
    const selectedKey = {
      normalMilks: 'selectedNormalMilks',
      specialMilks: 'selectedSpecialMilks',
      energyPowders: 'selectedEnergyPowders',
      foods: 'selectedFoods'
    }[group];
    const selectedKeys = new Set((this.data[selectedKey] || []).map((item) => item.key));
    return (this.data[meta.catalogKey] || [])
      .filter((item) => fuzzyIncludes(item.name, keyword))
      .map((item) => ({
        ...item,
        alreadySelected: selectedKeys.has(item.key)
      }));
  },

  pickCatalogItem(event) {
    const key = event.currentTarget.dataset.key;
    const group = this.data.pickerGroup;
    const meta = PICKER_META[group];
    const selectedKey = {
      normalMilks: 'selectedNormalMilks',
      specialMilks: 'selectedSpecialMilks',
      energyPowders: 'selectedEnergyPowders',
      foods: 'selectedFoods'
    }[group];
    const catalog = this.data[meta.catalogKey] || [];
    const item = catalog.find((row) => row.key === key);
    if (!item) return;
    const selected = [...(this.data[selectedKey] || [])];
    if (selected.some((row) => row.key === key)) {
      wx.showToast({ title: '已经添加过了', icon: 'none' });
      return;
    }
    if (group === 'foods' && selected.length >= FOOD_SELECT_LIMIT) {
      wx.showToast({ title: `食物最多选择 ${FOOD_SELECT_LIMIT} 种`, icon: 'none' });
      return;
    }
    selected.push({ ...item });
    this.setData({
      [selectedKey]: selected,
      hasResult: false,
      pickerOptions: this.buildPickerOptions(group, this.data.pickerKeyword)
    });
    wx.showToast({ title: '已添加', icon: 'success', duration: 800 });
  },

  removeSelected(event) {
    const group = event.currentTarget.dataset.group;
    const key = event.currentTarget.dataset.key;
    const selectedKey = {
      normalMilks: 'selectedNormalMilks',
      specialMilks: 'selectedSpecialMilks',
      energyPowders: 'selectedEnergyPowders',
      foods: 'selectedFoods'
    }[group];
    this.setData({
      [selectedKey]: (this.data[selectedKey] || []).filter((item) => item.key !== key),
      hasResult: false
    });
  },

  currentRatioRanges() {
    return {
      proteinEnergy: parseRangeInputs('proteinEnergy', this.data),
      fatEnergy: parseRangeInputs('fatEnergy', this.data),
      carbsEnergy: parseRangeInputs('carbsEnergy', this.data),
      premiumProteinRatio: parseRangeInputs('premiumRatio', this.data)
    };
  },

  calculate() {
    if (!this.data.babyUid) {
      wx.showToast({ title: '请先登录并选择宝宝', icon: 'none' });
      return;
    }
    const milkRatioPercent = Number(this.data.milkRatioPercent);
    const result = solveDietAdjust({
      mode: this.data.mode,
      target: this.data.target,
      milkRatio: milkRatioPercent / 100,
      foodRatio: (100 - milkRatioPercent) / 100,
      calorieTarget: this.data.calorieTarget,
      naturalProteinCoefficient: this.data.targetPreferences.naturalProteinCoefficient,
      specialProteinCoefficient: this.data.targetPreferences.specialProteinCoefficient,
      ratioRanges: this.currentRatioRanges(),
      normalMilks: this.data.selectedNormalMilks,
      specialMilks: this.data.selectedSpecialMilks,
      energyPowders: this.data.selectedEnergyPowders,
      foods: this.data.selectedFoods
    });
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none', duration: 2800 });
      return;
    }
    this.setData({
      hasResult: true,
      resultItems: result.items,
      achieved: result.achieved,
      comparisonTargets: result.comparisonTargets || {},
      macroRows: result.macroRatioSummary?.rows || [],
      hints: result.hints || []
    });
  },

  updateQuantity(event) {
    const index = Number(event.currentTarget.dataset.index);
    const resultItems = [...this.data.resultItems];
    const quantity = event.detail.value;
    const current = resultItems[index];
    resultItems[index] = {
      ...current,
      quantity,
      waterVolume: current.kind === 'formula_powder'
        ? round(
          Number(quantity)
          * (Number(current.mixRatio?.water) || 0)
          / (Number(current.mixRatio?.powder) || 1),
          0
        )
        : current.waterVolume
    };
    const achieved = summarizeQuantities(resultItems);
    const macroRatioSummary = buildMacroRatioSummary(achieved, this.currentRatioRanges());
    this.setData({
      resultItems,
      achieved,
      macroRows: macroRatioSummary.rows
    });
  },

  chooseApplyDate(event) {
    this.setData({ applyDate: event.detail.value });
  },

  confirmApply() {
    if (this.data.applying) return;
    if (!this.data.hasResult || !this.data.resultItems.length) {
      wx.showToast({ title: '请先点「算一算」', icon: 'none' });
      return;
    }
    if (this.data.resultItems.some((item) => !(Number(item.quantity) > 0))) {
      wx.showToast({ title: '所有推荐量都须大于 0', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认记下这一天？',
      content: '会清掉这一天已有的喂奶和辅食，再按刚才的推荐量重新记上。用药、尿布等其它记录不动。',
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
      wx.showToast({ title: '已按新方案记到这一天', icon: 'success' });
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
