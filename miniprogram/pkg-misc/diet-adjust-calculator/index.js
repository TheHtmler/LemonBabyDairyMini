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
const {
  BREAST_MILK_TAG_META,
  POWDER_CATEGORIES,
  POWDER_CATEGORY_META,
  POWDER_CATEGORY_ORDER,
  POWDER_STATUSES,
  buildCategoryBadgeStyle,
  sortFormulaPowdersByCategory
} = require('../../utils/formulaPowderUtils');
const { resolveCloudTempUrls } = require('../../utils/cloudTempUrlCache');

const DIET_ADJUST_FOOD_PICKER_SELECTION_KEY = 'diet_adjust_food_picker_selection';

const ADD_MILK_CATEGORY_LABELS = {
  [POWDER_CATEGORIES.BREAST_MILK]: '母乳',
  [POWDER_CATEGORIES.REGULAR_FORMULA]: '普奶',
  [POWDER_CATEGORIES.SPECIAL_FORMULA]: '特奶',
  [POWDER_CATEGORIES.ENERGY_SUPPLEMENT]: '能量粉'
};

/** 不跨分包 require pkg-milk；系统奶粉直接读云库 */
async function getSystemPowders() {
  try {
    if (!wx.cloud || !wx.cloud.database) return [];
    const res = await wx.cloud.database().collection('powder_catalog').limit(100).get();
    return Array.isArray(res?.data) ? res.data : [];
  } catch (error) {
    console.warn('加载系统奶粉失败:', error);
    return [];
  }
}

async function resolvePowderImageUrls(powders = []) {
  const list = Array.isArray(powders) ? powders : [];
  const fileIds = list
    .map((powder) => (powder?.image || '').toString().trim())
    .filter((image) => image.startsWith('cloud://'));
  if (!fileIds.length) return list;
  let imageUrlMap = new Map();
  try {
    imageUrlMap = await resolveCloudTempUrls(fileIds);
  } catch (error) {
    console.warn('解析奶粉图片临时地址失败:', error);
    return list;
  }
  return list.map((powder) => {
    const image = (powder?.image || '').toString().trim();
    return {
      ...powder,
      imageUrl: imageUrlMap.get(image) || image || ''
    };
  });
}

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

function enrichPowder(powder = {}) {
  const meta = POWDER_CATEGORY_META[powder.category] || {};
  return {
    ...powder,
    categoryShortLabel: meta.shortLabel || '',
    categoryBadgeClass: meta.badgeClass || '',
    categoryBadgeStyle: buildCategoryBadgeStyle(meta)
  };
}

function enrichMinePowder(powder = {}) {
  return {
    ...enrichPowder(powder),
    sourceType: 'user',
    sourcePowderCode: powder.sourceSystemPowderId || ''
  };
}

function enrichSystemPowder(powder = {}) {
  const powderCode = powder.powderCode || powder._id || powder.id || '';
  return {
    ...enrichPowder({
      id: powderCode,
      name: powder.name || '未命名奶粉',
      category: powder.category || '',
      proteinRole: powder.proteinRole || 'natural',
      image: powder.image || '',
      nutritionPer100g: powder.nutritionPer100g || {},
      mixRatio: powder.mixRatio || {},
      status: POWDER_STATUSES.ACTIVE
    }),
    sourceType: 'system',
    sourcePowderCode: powderCode,
    libraryScope: 'system'
  };
}

function getPowderDisplayImage(powder = {}) {
  if (powder.imageUrl) {
    return powder.imageUrl;
  }
  const image = (powder.image || '').toString().trim();
  return image.startsWith('cloud://') ? '' : image;
}

function mergeSelectablePowders(minePowders = [], systemPowders = []) {
  const usedSystemCodes = new Set(
    (minePowders || [])
      .map((powder) => powder.sourcePowderCode || powder.sourceSystemPowderId)
      .filter(Boolean)
  );
  const dedupedSystem = (systemPowders || []).filter(
    (powder) => !usedSystemCodes.has(powder.sourcePowderCode)
  );
  return sortFormulaPowdersByCategory([...(minePowders || []), ...dedupedSystem]);
}

function buildNutritionFromQuantity(item = {}, quantity) {
  const q = Number(quantity) || 0;
  return {
    protein: round(q * (Number(item.proteinPerUnit) || 0), 2),
    calories: round(q * (Number(item.caloriesPerUnit) || 0), 0),
    fat: round(q * (Number(item.fatPerUnit) || 0), 2),
    carbs: round(q * (Number(item.carbsPerUnit) || 0), 2),
    premiumProtein: round(q * (Number(item.premiumProteinPerUnit) || 0), 2)
  };
}

function readFoodSelectionIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : item?._id)).filter(Boolean);
  }
  if (Array.isArray(value?.foodIds)) {
    return value.foodIds.filter(Boolean);
  }
  if (Array.isArray(value?.items)) {
    return value.items.map((item) => item?.foodId || item?._id).filter(Boolean);
  }
  return [];
}

function mapFoodCatalog(foods = []) {
  return (foods || []).map((food) => {
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
    formulaPowders: [],
    foodCatalog: [],
    weight: 0,
    targetPreferences: {},
    useProteinTarget: true,
    useCalorieTarget: true,
    primaryMode: 'protein',
    proteinTarget: '',
    calorieTarget: '',
    selectedNormalMilks: [],
    selectedSpecialMilks: [],
    selectedEnergyPowders: [],
    selectedFoods: [],
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
    showAddMilkPanel: false,
    addMilkOptions: [],
    addMilkCart: [],
    addMilkCartExpanded: false,
    addMilkLibraryTabs: [
      { scope: 'mine', label: '我的奶粉' },
      { scope: 'system', label: '系统奶粉' }
    ],
    addMilkActiveScope: 'mine',
    addMilkCategories: [],
    addMilkActiveCategory: ''
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

  async onShow() {
    if (this._pendingPowderRefresh) {
      this._pendingPowderRefresh = false;
      await this.reloadFormulaPowders();
    }
    if (this._awaitingFoodPicker) {
      this._awaitingFoodPicker = false;
      await this.consumeFoodPickerSelection();
    }
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

  async loadSystemSelectablePowders() {
    try {
      const items = await getSystemPowders();
      return (items || []).map(enrichSystemPowder);
    } catch (error) {
      console.warn('加载系统奶粉失败：', error);
      return [];
    }
  },

  buildBreastMilkDietItem(nutritionSettings = this.data.nutritionSettings) {
    const breastDensity = withDensity({
      protein: nutritionSettings.natural_milk_protein,
      calories: nutritionSettings.natural_milk_calories,
      fat: nutritionSettings.natural_milk_fat,
      carbs: nutritionSettings.natural_milk_carbs
    });
    return {
      key: 'breast_milk',
      kind: 'breast_milk',
      name: '母乳',
      unit: 'ml',
      premiumProteinPerUnit: breastDensity.proteinPerUnit,
      ...breastDensity
    };
  },

  buildPowderDietItem(powder = {}) {
    const density = withDensity(powder.nutritionPer100g || {});
    const isNaturalRole = powder.proteinRole === 'natural'
      || powder.category === POWDER_CATEGORIES.REGULAR_FORMULA
      || powder.category === POWDER_CATEGORIES.BREAST_MILK;
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
  },

  classifyDietMilkItem(item = {}) {
    if (item.kind === 'breast_milk') return 'normal';
    const powder = item.powder || {};
    if (powder.category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT) return 'energy';
    if (
      powder.category === POWDER_CATEGORIES.SPECIAL_FORMULA
      || powder.proteinRole === 'special'
    ) {
      return 'special';
    }
    return 'normal';
  },

  async loadOptions() {
    this.setData({ loading: true });
    try {
      const today = formatDate();
      const [settings, foods, targetPreferences, basicInfo, birthday, systemPowders] = await Promise.all([
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
        this.loadBirthday(this.data.babyUid),
        this.loadSystemSelectablePowders()
      ]);
      const nutritionSettings = settings || {};
      const minePowders = (nutritionSettings.formulaPowders || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED)
        .map(enrichMinePowder);
      const formulaPowders = await resolvePowderImageUrls(
        mergeSelectablePowders(minePowders, systemPowders)
      );
      const foodCatalog = mapFoodCatalog(foods);
      const weight = Number(basicInfo?.weight) || 0;
      const preferredMode = targetPreferences.preferredTargetMode === 'calorie' ? 'calorie' : 'protein';
      const { ageMonths, ranges } = getDefaultMacroRatioRangesByBirthday(birthday);
      this.setData({
        nutritionSettings,
        formulaPowders,
        foodCatalog,
        targetPreferences,
        weight,
        birthday,
        ageMonths,
        useProteinTarget: true,
        useCalorieTarget: true,
        primaryMode: preferredMode,
        proteinTarget: this.defaultProteinTarget(weight, targetPreferences),
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

  async reloadFormulaPowders() {
    if (!this.data.babyUid) return;
    try {
      const [settings, systemPowders] = await Promise.all([
        MilkNutritionProfileModel.getNutritionProfileSettings(this.data.babyUid, {
          includeLegacyFallback: true
        }),
        this.loadSystemSelectablePowders()
      ]);
      const nutritionSettings = settings || this.data.nutritionSettings;
      const minePowders = ((nutritionSettings && nutritionSettings.formulaPowders) || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED)
        .map(enrichMinePowder);
      const formulaPowders = await resolvePowderImageUrls(
        mergeSelectablePowders(minePowders, systemPowders)
      );
      this.setData({ nutritionSettings, formulaPowders });
      if (this.data.showAddMilkPanel) {
        const scope = this.data.addMilkActiveScope || 'mine';
        const categories = this.buildAddMilkCategories(scope);
        const activeCategory = this.getNextAddMilkCategory(
          categories,
          this.data.addMilkActiveCategory
        );
        this.setData({
          addMilkCategories: categories,
          addMilkActiveCategory: activeCategory,
          addMilkOptions: this.buildAddMilkOptions(scope, activeCategory)
        });
      }
    } catch (error) {
      console.error('刷新奶粉档案失败：', error);
    }
  },

  defaultProteinTarget(weight, preferences = {}) {
    if (!(weight > 0)) return '';
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

  toggleTargetEnable(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode !== 'protein' && mode !== 'calorie') return;
    const useKey = mode === 'protein' ? 'useProteinTarget' : 'useCalorieTarget';
    const otherKey = mode === 'protein' ? 'useCalorieTarget' : 'useProteinTarget';
    const currentlyEnabled = !!this.data[useKey];

    if (currentlyEnabled) {
      if (!this.data[otherKey]) {
        wx.showToast({ title: '至少启用一个目标', icon: 'none' });
        return;
      }
      const patch = {
        [useKey]: false,
        hasResult: false
      };
      if (this.data.primaryMode === mode) {
        patch.primaryMode = mode === 'protein' ? 'calorie' : 'protein';
      }
      this.setData(patch);
      return;
    }

    this.setData({
      [useKey]: true,
      hasResult: false
    });
  },

  setPrimaryMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'protein' && !this.data.useProteinTarget) return;
    if (mode === 'calorie' && !this.data.useCalorieTarget) return;
    if (mode !== 'protein' && mode !== 'calorie') return;
    this.setData({
      primaryMode: mode,
      hasResult: false
    });
  },

  onTargetCardTap(event) {
    const mode = event.currentTarget.dataset.mode;
    const enabled = mode === 'protein'
      ? this.data.useProteinTarget
      : this.data.useCalorieTarget;
    if (!enabled) {
      this.toggleTargetEnable(event);
      return;
    }
    this.setPrimaryMode(event);
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

  noop() {},

  removeSelected(event) {
    const group = event.currentTarget.dataset.group;
    const key = event.currentTarget.dataset.key;
    const selectedKey = {
      normalMilks: 'selectedNormalMilks',
      specialMilks: 'selectedSpecialMilks',
      energyPowders: 'selectedEnergyPowders',
      foods: 'selectedFoods'
    }[group];
    if (!selectedKey) return;
    this.setData({
      [selectedKey]: (this.data[selectedKey] || []).filter((item) => item.key !== key),
      hasResult: false
    });
  },

  openFoodPicker() {
    const foodIds = (this.data.selectedFoods || [])
      .map((item) => item.food?._id || String(item.key || '').replace(/^food_/, ''))
      .filter(Boolean);
    try {
      wx.setStorageSync(DIET_ADJUST_FOOD_PICKER_SELECTION_KEY, {
        schemaVersion: 2,
        foodIds
      });
    } catch (error) {
      console.warn('写入食物选择缓存失败:', error);
    }
    this._awaitingFoodPicker = true;
    wx.navigateTo({
      url: '/pkg-records/food-picker/index?from=diet-adjust',
      fail: () => {
        this._awaitingFoodPicker = false;
      }
    });
  },

  async consumeFoodPickerSelection() {
    let payload = null;
    try {
      payload = wx.getStorageSync(DIET_ADJUST_FOOD_PICKER_SELECTION_KEY);
    } catch (error) {
      payload = null;
    }
    try {
      wx.removeStorageSync(DIET_ADJUST_FOOD_PICKER_SELECTION_KEY);
    } catch (error) {
      // ignore
    }
    if (!payload) return;

    const foodIds = readFoodSelectionIds(payload);
    try {
      const foods = await FoodModel.getAvailableFoods(this.data.babyUid);
      const foodCatalog = mapFoodCatalog(foods);
      const byId = new Map(
        foodCatalog.map((item) => [item.food?._id, item]).filter(([id]) => !!id)
      );
      const selectedFoods = foodIds
        .map((id) => byId.get(id))
        .filter(Boolean);
      this.setData({
        foodCatalog,
        selectedFoods,
        hasResult: false
      });
    } catch (error) {
      console.error('读取食物选择失败:', error);
      const byId = new Map(
        (this.data.foodCatalog || [])
          .map((item) => [item.food?._id, item])
          .filter(([id]) => !!id)
      );
      this.setData({
        selectedFoods: foodIds.map((id) => byId.get(id)).filter(Boolean),
        hasResult: false
      });
    }
  },

  goToManagePowders() {
    this._pendingPowderRefresh = true;
    wx.navigateTo({
      url: '/pkg-milk/powder-management/index',
      fail: (err) => {
        this._pendingPowderRefresh = false;
        console.error('打开奶粉管理页失败：', err);
      }
    });
  },

  buildAddMilkNutritionLabel(nutrition = {}, unitLabel = '100g') {
    const protein = Number(nutrition.protein);
    const calories = Number(nutrition.calories);
    if (!Number.isFinite(protein) && !Number.isFinite(calories)) {
      return '';
    }
    const parts = [];
    if (Number.isFinite(protein)) {
      parts.push(`蛋白 ${protein}g`);
    }
    if (Number.isFinite(calories)) {
      parts.push(`热量 ${calories}kcal`);
    }
    return `${unitLabel}：${parts.join('  ')}`;
  },

  buildScopedAddMilkOptions(scope = this.data.addMilkActiveScope) {
    const isSystemScope = scope === 'system';
    const scopedPowders = (this.data.formulaPowders || []).filter((powder) => (
      isSystemScope
        ? powder.sourceType === 'system'
        : powder.sourceType !== 'system'
    ));
    const settings = this.data.nutritionSettings || {};
    const breastMilkLabel = this.buildAddMilkNutritionLabel({
      protein: settings.natural_milk_protein,
      calories: settings.natural_milk_calories
    }, '100ml');

    return [
      ...(isSystemScope ? [] : [{
        key: 'breast_milk',
        kind: 'breast_milk',
        category: POWDER_CATEGORIES.BREAST_MILK,
        label: '母乳',
        subLabel: breastMilkLabel || '记录母乳体积',
        categoryShortLabel: '母',
        categoryBadgeClass: 'breast',
        categoryBadgeStyle: buildCategoryBadgeStyle(BREAST_MILK_TAG_META),
        selected: false
      }]),
      ...sortFormulaPowdersByCategory(scopedPowders).map((powder) => ({
        key: `powder:${powder.id}`,
        kind: 'formula_powder',
        powderId: powder.id,
        category: powder.category || '',
        sourceType: powder.sourceType || 'user',
        sourcePowderCode: powder.sourcePowderCode || powder.sourceSystemPowderId || '',
        scopeLabel: isSystemScope ? '系统' : '我的',
        label: powder.name || '未命名奶粉',
        subLabel: this.buildAddMilkNutritionLabel(powder.nutritionPer100g || {}, '100g')
          || `${powder.categoryShortLabel || '奶'}类奶粉`,
        displayImage: getPowderDisplayImage(powder),
        categoryShortLabel: powder.categoryShortLabel || '奶',
        categoryBadgeClass: powder.categoryBadgeClass || '',
        categoryBadgeStyle: powder.categoryBadgeStyle || '',
        selected: false
      }))
    ];
  },

  buildAddMilkCategories(scope = this.data.addMilkActiveScope) {
    const presentCategories = new Set(
      this.buildScopedAddMilkOptions(scope).map((option) => option.category).filter(Boolean)
    );
    const categories = POWDER_CATEGORY_ORDER
      .filter((category) => presentCategories.has(category))
      .map((category) => ({
        value: category,
        label: ADD_MILK_CATEGORY_LABELS[category] || (POWDER_CATEGORY_META[category] || {}).label || category
      }));
    if (categories.length === 0) {
      return [];
    }
    return [{ value: 'all', label: '全部' }, ...categories];
  },

  getNextAddMilkCategory(categories = [], preferredCategory = '') {
    if (preferredCategory && categories.some((item) => item.value === preferredCategory)) {
      return preferredCategory;
    }
    return categories.length > 0 ? categories[0].value : '';
  },

  isAddMilkOptionSelected(option = {}, cart = this.data.addMilkCart || []) {
    if (option.kind === 'breast_milk') {
      return (cart || []).some((item) => item.kind === 'breast_milk');
    }
    return (cart || []).some((item) => item.kind === 'formula_powder' && item.powderId === option.powderId);
  },

  buildAddMilkOptions(
    scope = this.data.addMilkActiveScope,
    category = this.data.addMilkActiveCategory,
    cart = this.data.addMilkCart
  ) {
    const options = this.buildScopedAddMilkOptions(scope);
    const filtered = category && category !== 'all'
      ? options.filter((option) => option.category === category)
      : options;
    return filtered.map((option) => ({
      ...option,
      selected: this.isAddMilkOptionSelected(option, cart)
    }));
  },

  buildAddMilkCartItem(option = {}) {
    return {
      key: option.key,
      kind: option.kind,
      powderId: option.powderId || '',
      label: option.label || (option.kind === 'breast_milk' ? '母乳' : '未命名奶粉'),
      displayImage: option.displayImage || '',
      categoryShortLabel: option.categoryShortLabel || '奶',
      categoryBadgeClass: option.categoryBadgeClass || '',
      categoryBadgeStyle: option.categoryBadgeStyle || ''
    };
  },

  buildAddMilkCartFromSelection() {
    const powders = this.data.formulaPowders || [];
    const cart = [];
    const pushItem = (item) => {
      if (!item) return;
      if (item.kind === 'breast_milk') {
        cart.push({
          key: 'breast_milk',
          kind: 'breast_milk',
          powderId: '',
          label: '母乳',
          displayImage: '',
          categoryShortLabel: '母',
          categoryBadgeClass: 'breast',
          categoryBadgeStyle: buildCategoryBadgeStyle(BREAST_MILK_TAG_META)
        });
        return;
      }
      const powderIdHint = item.powder?.id || String(item.key || '').replace(/^powder_/, '');
      const powder = item.powder
        || powders.find((row) => row.id === powderIdHint)
        || {};
      const powderId = powder.id || powderIdHint;
      cart.push({
        key: `powder:${powderId}`,
        kind: 'formula_powder',
        powderId,
        label: item.name || powder.name || '未命名奶粉',
        displayImage: getPowderDisplayImage(powder),
        categoryShortLabel: powder.categoryShortLabel || '奶',
        categoryBadgeClass: powder.categoryBadgeClass || '',
        categoryBadgeStyle: powder.categoryBadgeStyle || ''
      });
    };

    (this.data.selectedNormalMilks || []).forEach(pushItem);
    (this.data.selectedSpecialMilks || []).forEach(pushItem);
    (this.data.selectedEnergyPowders || []).forEach(pushItem);
    return cart;
  },

  openAddMilkPanel() {
    const categories = this.buildAddMilkCategories('mine');
    const activeCategory = this.getNextAddMilkCategory(categories, '');
    const cart = this.buildAddMilkCartFromSelection();
    this.setData({
      showAddMilkPanel: true,
      addMilkActiveScope: 'mine',
      addMilkActiveCategory: activeCategory,
      addMilkCategories: categories,
      addMilkCart: cart,
      addMilkCartExpanded: false,
      addMilkOptions: this.buildAddMilkOptions('mine', activeCategory, cart)
    });
  },

  switchAddMilkScope(event) {
    const { scope } = event.currentTarget.dataset || {};
    if (!scope || scope === this.data.addMilkActiveScope) return;
    const categories = this.buildAddMilkCategories(scope);
    const activeCategory = this.getNextAddMilkCategory(categories, '');
    this.setData({
      addMilkActiveScope: scope,
      addMilkActiveCategory: activeCategory,
      addMilkCategories: categories,
      addMilkOptions: this.buildAddMilkOptions(scope, activeCategory)
    });
  },

  switchAddMilkCategory(event) {
    const { category } = event.currentTarget.dataset || {};
    if (!category || category === this.data.addMilkActiveCategory) return;
    this.setData({
      addMilkActiveCategory: category,
      addMilkOptions: this.buildAddMilkOptions(this.data.addMilkActiveScope, category)
    });
  },

  toggleAddMilkOption(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) return;
    const option = (this.data.addMilkOptions || []).find((item) => item.key === key);
    if (!option) return;

    if (option.selected) {
      this.removeFromAddMilkCart(key);
      return;
    }

    const cart = [
      ...(this.data.addMilkCart || []),
      this.buildAddMilkCartItem(option)
    ];
    this.setData({
      addMilkCart: cart,
      addMilkOptions: (this.data.addMilkOptions || []).map((item) => (
        item.key === key ? { ...item, selected: true } : item
      ))
    });
  },

  removeFromAddMilkCart(key) {
    if (!key) return;
    const cart = (this.data.addMilkCart || []).filter((item) => item.key !== key);
    this.setData({
      addMilkCart: cart,
      addMilkCartExpanded: cart.length > 0 ? this.data.addMilkCartExpanded : false,
      addMilkOptions: (this.data.addMilkOptions || []).map((item) => (
        item.key === key ? { ...item, selected: false } : item
      ))
    });
  },

  removeAddMilkCartItem(event) {
    const { key } = event.currentTarget.dataset || {};
    this.removeFromAddMilkCart(key);
  },

  previewAddMilkImage(event) {
    const { url } = event.currentTarget.dataset || {};
    if (!url || typeof wx.previewImage !== 'function') return;
    wx.previewImage({
      urls: [url],
      current: url
    });
  },

  toggleAddMilkCartExpanded() {
    if ((this.data.addMilkCart || []).length === 0) {
      this.setData({ addMilkCartExpanded: false });
      return;
    }
    this.setData({ addMilkCartExpanded: !this.data.addMilkCartExpanded });
  },

  collapseAddMilkCart() {
    this.setData({ addMilkCartExpanded: false });
  },

  buildDietItemFromCart(cartItem = {}) {
    if (cartItem.kind === 'breast_milk') {
      return this.buildBreastMilkDietItem();
    }
    const powderId = cartItem.powderId || String(cartItem.key || '').replace(/^powder:/, '');
    const powder = (this.data.formulaPowders || []).find((item) => item.id === powderId);
    if (!powder) return null;
    return this.buildPowderDietItem(powder);
  },

  confirmAddMilkPanel() {
    const cart = this.data.addMilkCart || [];
    const selectedNormalMilks = [];
    const selectedSpecialMilks = [];
    const selectedEnergyPowders = [];

    cart.forEach((cartItem) => {
      const dietItem = this.buildDietItemFromCart(cartItem);
      if (!dietItem) return;
      const bucket = this.classifyDietMilkItem(dietItem);
      if (bucket === 'energy') {
        selectedEnergyPowders.push(dietItem);
      } else if (bucket === 'special') {
        selectedSpecialMilks.push(dietItem);
      } else {
        selectedNormalMilks.push(dietItem);
      }
    });

    this.setData({
      selectedNormalMilks,
      selectedSpecialMilks,
      selectedEnergyPowders,
      showAddMilkPanel: false,
      addMilkOptions: [],
      addMilkCart: [],
      addMilkCartExpanded: false,
      hasResult: false
    });
  },

  cancelAddMilkPanel() {
    this.setData({
      showAddMilkPanel: false,
      addMilkOptions: [],
      addMilkCart: [],
      addMilkCartExpanded: false
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

  resolveSolveInputs() {
    const {
      useProteinTarget,
      useCalorieTarget,
      primaryMode,
      proteinTarget,
      calorieTarget
    } = this.data;

    if (!useProteinTarget && !useCalorieTarget) {
      return { ok: false, message: '至少启用一个目标' };
    }

    let mode = primaryMode === 'calorie' ? 'calorie' : 'protein';
    if (mode === 'protein' && !useProteinTarget) mode = 'calorie';
    if (mode === 'calorie' && !useCalorieTarget) mode = 'protein';

    const target = mode === 'calorie' ? calorieTarget : proteinTarget;
    const softTargets = {};
    if (useProteinTarget && mode === 'calorie') {
      softTargets.protein = proteinTarget;
    }

    return {
      ok: true,
      mode,
      target,
      calorieTarget: useCalorieTarget ? calorieTarget : '',
      softTargets
    };
  },

  calculate() {
    if (!this.data.babyUid) {
      wx.showToast({ title: '请先登录并选择宝宝', icon: 'none' });
      return;
    }
    const solveInputs = this.resolveSolveInputs();
    if (!solveInputs.ok) {
      wx.showToast({ title: solveInputs.message, icon: 'none' });
      return;
    }

    const milkRatioPercent = Number(this.data.milkRatioPercent);
    const result = solveDietAdjust({
      mode: solveInputs.mode,
      target: solveInputs.target,
      milkRatio: milkRatioPercent / 100,
      foodRatio: (100 - milkRatioPercent) / 100,
      calorieTarget: solveInputs.calorieTarget,
      softTargets: solveInputs.softTargets,
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
      primaryMode: solveInputs.mode,
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
    if (!current) return;
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
        : current.waterVolume,
      nutrition: buildNutritionFromQuantity(current, quantity)
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
