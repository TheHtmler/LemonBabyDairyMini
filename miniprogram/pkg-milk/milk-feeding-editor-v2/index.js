const MilkNutritionProfileModel = require('../../models/nutritionProfile');
const PowderCatalogModel = require('../../models/powderCatalog');
const feedingRecordV2Model = require('../../models/feedingRecordV2');
const DailySummaryV2Model = require('../../models/dailySummaryV2');
const DailyRecordV2Service = require('../../utils/dailyRecordV2Service');
const { getBabyUid } = require('../../utils/index');
const {
  getNutritionTargetPreferences,
  pickCoefficient
} = require('../../utils/nutritionTargetPreferences');
const {
  buildEntryTargetPreview,
  normalizeSummary
} = require('../../utils/nutritionTargetPreview');
const {
  BREAST_MILK_TAG_META,
  POWDER_CATEGORY_META,
  POWDER_STATUSES,
  buildCategoryBadgeStyle,
  sortFormulaPowdersByCategory
} = require('../../utils/formulaPowderUtils');
const {
  buildBreastMilkComponent,
  buildFormulaPowderComponent,
  buildNutritionSummary
} = require('../../utils/feedingRecordV2Utils');
const {
  buildUpcomingReminderCandidates
} = require('../../utils/upcomingReminderCandidates');
const {
  rescheduleReminderSubscriptions
} = require('../../utils/reminderSubscriptionPrompt');

const getNutritionProfileSettings = MilkNutritionProfileModel.getNutritionProfileSettings.bind(MilkNutritionProfileModel);
const getSystemPowders = PowderCatalogModel.getSystemPowders.bind(PowderCatalogModel);
const addFeedingRecordV2 = feedingRecordV2Model.addRecord.bind(feedingRecordV2Model);
const updateFeedingRecordV2 = feedingRecordV2Model.updateRecord.bind(feedingRecordV2Model);
const markDailySummaryDirty = DailySummaryV2Model.markDirty.bind(DailySummaryV2Model);
const resolveBasicInfoSnapshot = feedingRecordV2Model.resolveBasicInfoSnapshot.bind(feedingRecordV2Model);
const getV2RecordsByDate = feedingRecordV2Model.getRecordsByDate.bind(feedingRecordV2Model);
const wxApi = wx;

function dismissKeyboard() {
  if (typeof wxApi.hideKeyboard === 'function') {
    wxApi.hideKeyboard();
  }
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(date = new Date()) {
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${hour}:${minute}`;
}

function buildDateTime(dateKey, timeText) {
  const [year, month, day] = String(dateKey || formatDateKey()).split('-').map(Number);
  const [hour, minute] = String(timeText || '00:00').split(':').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, 0, 0);
}

function toNumberOrEmpty(value) {
  if (value === '' || value === undefined || value === null) {
    return '';
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : '';
}

function toInputValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${num}` : '';
}

function toVolumeInputValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${Math.round(num)}` : '';
}

function formatLinkedInput(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return '';
  }
  const rounded = Math.round((num + Number.EPSILON) * 100) / 100;
  return `${rounded}`;
}

function formatProteinText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0.00';
  }
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
}

function withProteinDisplay(summary = {}) {
  return {
    ...summary,
    proteinText: formatProteinText(summary.protein),
    naturalProteinText: formatProteinText(summary.naturalProtein),
    specialProteinText: formatProteinText(summary.specialProtein)
  };
}

function calculatePowderFromWater(waterVolume, ratio = {}) {
  const waterNum = Number(waterVolume);
  const powder = Number(ratio.powder);
  const water = Number(ratio.water);
  if (!Number.isFinite(waterNum) || !Number.isFinite(powder) || !Number.isFinite(water) || waterNum <= 0 || powder <= 0 || water <= 0) {
    return '';
  }
  return formatLinkedInput((waterNum * powder) / water);
}

function calculateWaterFromPowder(powderWeight, ratio = {}) {
  const powderNum = Number(powderWeight);
  const powder = Number(ratio.powder);
  const water = Number(ratio.water);
  if (!Number.isFinite(powderNum) || !Number.isFinite(powder) || !Number.isFinite(water) || powderNum <= 0 || powder <= 0 || water <= 0) {
    return '';
  }
  return formatLinkedInput((powderNum * water) / powder);
}

function createEmptySummary() {
  return {
    totalVolume: 0,
    totalPowderWeight: 0,
    protein: 0,
    naturalProtein: 0,
    specialProtein: 0,
    calories: 0,
    fat: 0,
    carbs: 0,
    fiber: 0,
    zeroProteinCalories: 0
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

// 我的奶粉：来自 milk_nutrition_profiles.formulaPowders，标记来源便于录入快照写 sourceType。
function enrichMinePowder(powder = {}) {
  return {
    ...enrichPowder(powder),
    sourceType: 'user',
    sourcePowderCode: powder.sourceSystemPowderId || ''
  };
}

// 系统奶粉：来自云端 powder_catalog，映射成可选奶粉结构并标记 sourceType=system。
function enrichSystemPowder(powder = {}) {
  const powderCode = powder.powderCode || powder._id || powder.id || '';
  return {
    ...enrichPowder({
      id: powderCode,
      name: powder.name || '未命名奶粉',
      category: powder.category || '',
      proteinRole: powder.proteinRole || 'natural',
      nutritionPer100g: powder.nutritionPer100g || {},
      mixRatio: powder.mixRatio || {},
      status: POWDER_STATUSES.ACTIVE
    }),
    sourceType: 'system',
    sourcePowderCode: powderCode,
    libraryScope: 'system'
  };
}

// 合并我的+系统奶粉：已加入我的奶粉的系统项（sourceSystemPowderId 命中）不再重复展示。
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

function createFormulaEntry(powder = {}, overrides = {}) {
  return {
    localId: overrides.localId || `formula_${powder.id || 'unknown'}_${Date.now()}`,
    kind: 'formula_powder',
    powderId: overrides.powderId || powder.id || '',
    waterVolume: toVolumeInputValue(overrides.waterVolume),
    powderWeight: toInputValue(overrides.powderWeight),
    ratioMode: overrides.ratioMode === 'custom' ? 'custom' : 'standard',
    powderPickerIndex: Number.isInteger(overrides.powderPickerIndex) ? overrides.powderPickerIndex : 0,
    powderSnapshot: overrides.powderSnapshot || null,
    justAdded: overrides.justAdded === true
  };
}

function createBreastEntry(overrides = {}) {
  return {
    localId: overrides.localId || `breast_${Date.now()}`,
    kind: 'breast_milk',
    volume: toVolumeInputValue(overrides.volume),
    justAdded: overrides.justAdded === true
  };
}

function createPowderFromComponent(component = {}) {
  return {
    ...enrichPowder({
      id: component.powderId || '',
      name: component.powderName || '历史奶粉',
      category: component.category || '',
      proteinRole: component.proteinRole || 'natural',
      nutritionPer100g: component.nutritionSnapshot || {},
      mixRatio: component.mixRatioSnapshot || {},
      status: POWDER_STATUSES.ACTIVE
    }),
    sourceType: component.sourceType || 'user',
    sourcePowderCode: component.sourcePowderCode || ''
  };
}

function canLoadDailyTargetContext(wxLike = wxApi) {
  try {
    const command = wxLike?.cloud?.database?.().command;
    return !!(command && typeof command.gte === 'function' && typeof command.lte === 'function');
  } catch (error) {
    return false;
  }
}

Page({
  data: {
    babyUid: '',
    editorMode: 'create',
    editingRecordId: '',
    editingRecordIndex: -1,
    selectedDate: '',
    startTime: '',
    endTime: '',
    weight: '',
    height: '',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    nutritionSettings: {},
    breastMilkTag: {
      shortLabel: BREAST_MILK_TAG_META.shortLabel,
      badgeClass: BREAST_MILK_TAG_META.badgeClass,
      badgeStyle: buildCategoryBadgeStyle(BREAST_MILK_TAG_META)
    },
    formulaPowders: [],
    milkEntries: [],
    existingRecords: [],
    nutritionPreview: createEmptySummary(),
    targetPreview: null,
    targetContext: {
      currentSummary: normalizeSummary(),
      targetPreferences: {},
      weight: ''
    },
    goalPreview: {
      calorieGoal: '',
      consumedCalories: 0,
      remainingBefore: '',
      remainingAfter: ''
    },
    showAddMilkPanel: false,
    addMilkOptions: [],
    addMilkLibraryTabs: [
      { scope: 'mine', label: '我的奶粉' },
      { scope: 'system', label: '系统奶粉' }
    ],
    addMilkActiveScope: 'mine',
    flyMilkAnimation: {
      active: false,
      badge: '',
      label: '',
      count: 0,
      style: ''
    },
    recentDefaultsLoaded: false,
    recentDefaultText: '',
    notes: '',
    loading: false
  },

  async onLoad(options = {}) {
    const selectedDate = options.date || formatDateKey();
    const babyUid = getBabyUid() || getApp().globalData.babyUid || '';
    const editorMode = options.mode === 'edit' ? 'edit' : 'create';
    const editingRecordId = options.recordId || options.id || '';
    const editingRecordIndex = Number.isInteger(Number(options.index)) ? Number(options.index) : -1;
    const startTime = options.startTime || (editorMode === 'edit' ? '' : formatTime());
    if (wxApi.setNavigationBarTitle) {
      wxApi.setNavigationBarTitle({
        title: editorMode === 'edit' ? '编辑喂奶' : '添加喂奶'
      });
    }

    this.setData({
      babyUid,
      editorMode,
      editingRecordId,
      editingRecordIndex,
      selectedDate,
      startTime
    });

    await this.loadPageData();
  },

  async onShow() {
    // 从配奶设置页返回时，只刷新奶粉档案，避免清空本次已录入的奶。
    if (this._pendingPowderRefresh) {
      this._pendingPowderRefresh = false;
      await this.reloadFormulaPowders();
    }
    await this.refreshTargetContextFromPreferences();
  },

  async loadPageData() {
    if (!this.data.babyUid) {
      wxApi.showToast({ title: '缺少宝宝信息', icon: 'none' });
      return;
    }

    try {
      const [settings, basicInfo, records, systemPowders] = await Promise.all([
        getNutritionProfileSettings(this.data.babyUid, { includeLegacyFallback: false }),
        resolveBasicInfoSnapshot(this.data.babyUid, this.data.selectedDate, {
          includeFallbacks: false,
          includeProfileInitial: true,
          // 当天成长记录可能只有身高体重、缺蛋白系数，补齐历史系数，避免存下缺系数的喂奶快照。
          carryForwardMissing: true
        }),
        getV2RecordsByDate(this.data.babyUid, this.data.selectedDate),
        this.loadSystemSelectablePowders()
      ]);
      const targetContext = await this.loadTargetContext(basicInfo || {}, records || []);
      const minePowders = ((settings && settings.formulaPowders) || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED)
        .map(enrichMinePowder);

      this.setData({
        nutritionSettings: settings || {},
        formulaPowders: mergeSelectablePowders(minePowders, systemPowders),
        existingRecords: records || [],
        targetContext,
        weight: toInputValue(basicInfo?.weight),
        height: toInputValue(basicInfo?.height),
        naturalProteinCoefficientInput: toInputValue(basicInfo?.naturalProteinCoefficient),
        specialProteinCoefficientInput: toInputValue(basicInfo?.specialProteinCoefficient),
        calorieCoefficientInput: toInputValue(basicInfo?.calorieCoefficient)
      }, () => {
        const editingRecord = this.resolveEditingRecord(records || []);
        if (editingRecord) {
          this.applyEditingRecord(editingRecord);
          return;
        }
        this.refreshNutritionPreview();
      });
    } catch (error) {
      console.error('加载喂奶记录失败：', error);
      wxApi.showToast({ title: '加载失败，请稍后再试', icon: 'none' });
    }
  },

  summarizeRecordsForTarget(records = []) {
    return normalizeSummary((records || []).reduce((summary, record = {}) => {
      const nutrition = record.nutritionSummary || {};
      summary.calories += Number(nutrition.calories) || 0;
      summary.protein += Number(nutrition.protein) || 0;
      summary.naturalProtein += Number(nutrition.naturalProtein) || 0;
      summary.specialProtein += Number(nutrition.specialProtein) || 0;
      summary.carbs += Number(nutrition.carbs) || 0;
      summary.fat += Number(nutrition.fat) || 0;
      return summary;
    }, normalizeSummary()));
  },

  async loadTargetContext(basicInfo = {}, records = []) {
    const localTarget = await getNutritionTargetPreferences(this.data.babyUid, wxApi);
    const fallbackSummary = this.summarizeRecordsForTarget(records);
    let currentSummary = fallbackSummary;
    let resolvedBasicInfo = basicInfo || {};

    try {
      if (!canLoadDailyTargetContext()) {
        return {
          currentSummary: fallbackSummary,
          weight: pickCoefficient('', resolvedBasicInfo.weight),
          targetPreferences: {
            naturalProteinCoefficient: pickCoefficient(localTarget.naturalProteinCoefficient, resolvedBasicInfo.naturalProteinCoefficient),
            specialProteinCoefficient: pickCoefficient(localTarget.specialProteinCoefficient, resolvedBasicInfo.specialProteinCoefficient),
            calorieCoefficient: pickCoefficient(localTarget.calorieCoefficient, resolvedBasicInfo.calorieCoefficient)
          }
        };
      }

      const daily = await DailyRecordV2Service.getDailyRecordV2(this.data.babyUid, this.data.selectedDate);
      currentSummary = normalizeSummary(daily?.summary?.macroSummary || daily?.overview?.macroSummary || fallbackSummary);
      resolvedBasicInfo = {
        ...resolvedBasicInfo,
        ...(daily?.basicInfo || {})
      };
    } catch (error) {
      console.warn('加载当日目标上下文失败，使用当前喂奶记录估算:', error);
    }

    return {
      currentSummary,
      weight: pickCoefficient('', resolvedBasicInfo.weight),
      targetPreferences: {
        naturalProteinCoefficient: pickCoefficient(localTarget.naturalProteinCoefficient, resolvedBasicInfo.naturalProteinCoefficient),
        specialProteinCoefficient: pickCoefficient(localTarget.specialProteinCoefficient, resolvedBasicInfo.specialProteinCoefficient),
        calorieCoefficient: pickCoefficient(localTarget.calorieCoefficient, resolvedBasicInfo.calorieCoefficient)
      }
    };
  },

  async refreshTargetContextFromPreferences() {
    if (!this.data.babyUid) return;
    const targetContext = await this.loadTargetContext({
      weight: this.data.weight,
      naturalProteinCoefficient: this.data.naturalProteinCoefficientInput,
      specialProteinCoefficient: this.data.specialProteinCoefficientInput,
      calorieCoefficient: this.data.calorieCoefficientInput
    }, this.data.existingRecords || []);
    this.setData({
      targetContext,
      naturalProteinCoefficientInput: targetContext.targetPreferences?.naturalProteinCoefficient || this.data.naturalProteinCoefficientInput,
      specialProteinCoefficientInput: targetContext.targetPreferences?.specialProteinCoefficient || this.data.specialProteinCoefficientInput,
      calorieCoefficientInput: targetContext.targetPreferences?.calorieCoefficient || this.data.calorieCoefficientInput
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  async handleNutritionTargetsSaved() {
    await this.refreshTargetContextFromPreferences();
  },

  onBasicInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [field]: e.detail.value
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  onTimeChange(e) {
    this.setData({
      startTime: e.detail.value
    });
  },

  onNotesInput(e) {
    this.setData({
      notes: e.detail.value
    });
  },

  noop() {},

  findPowderForEntry(entry = {}) {
    const powder = (this.data.formulaPowders || []).find((item) => item.id === entry.powderId);
    return powder || entry.powderSnapshot || null;
  },

  normalizeMilkEntries(entries = []) {
    const options = this.data.formulaPowders || [];
    return (entries || []).map((entry) => {
      if (entry.kind === 'breast_milk') {
        return entry;
      }
      const powderPickerIndex = Math.max(0, options.findIndex((powder) => powder.id === entry.powderId));
      return {
        ...entry,
        powderPickerIndex
      };
    });
  },

  navigateToGoalPlanner() {
    const selectedDate = this.data.selectedDate || formatDateKey();
    const recordIdParam = this.data.editorMode === 'edit' && this.data.editingRecordId
      ? `&recordId=${encodeURIComponent(this.data.editingRecordId)}`
      : '';
    wxApi.navigateTo({
      url: `/pkg-milk/milk-goal-planner-v2/index?date=${encodeURIComponent(selectedDate)}${recordIdParam}`
    });
  },

  // 选奶弹窗内的引导入口：新手没配过奶粉时只有“母乳”，这里跳到奶粉管理去添加奶粉。
  goToManagePowders() {
    this._pendingPowderRefresh = true;
    wxApi.navigateTo({
      url: '/pkg-milk/powder-management/index',
      fail: (err) => {
        this._pendingPowderRefresh = false;
        console.error('打开奶粉管理页失败：', err);
      }
    });
  },

  // 加载系统奶粉（云端 powder_catalog）作为可选奶粉；失败/为空时返回空数组，页面照常展示我的奶粉。
  async loadSystemSelectablePowders() {
    try {
      const items = await getSystemPowders();
      return (items || []).map(enrichSystemPowder);
    } catch (error) {
      console.warn('加载系统奶粉失败：', error);
      return [];
    }
  },

  // 仅刷新奶粉档案与依赖它的视图，不动 milkEntries（本次已录入的奶）。
  async reloadFormulaPowders() {
    if (!this.data.babyUid) return;
    try {
      const [settings, systemPowders] = await Promise.all([
        getNutritionProfileSettings(this.data.babyUid, { includeLegacyFallback: false }),
        this.loadSystemSelectablePowders()
      ]);
      const minePowders = ((settings && settings.formulaPowders) || [])
        .filter((powder) => powder.status !== POWDER_STATUSES.ARCHIVED)
        .map(enrichMinePowder);
      const formulaPowders = mergeSelectablePowders(minePowders, systemPowders);
      this.setData({
        nutritionSettings: settings || this.data.nutritionSettings,
        formulaPowders,
        milkEntries: this.normalizeMilkEntries(this.data.milkEntries || [])
      }, () => {
        if (this.data.showAddMilkPanel) {
          this.setData({ addMilkOptions: this.buildAddMilkOptions() });
        }
        this.refreshNutritionPreview();
      });
    } catch (error) {
      console.error('刷新奶粉档案失败：', error);
    }
  },

  isAddMilkOptionSelected(option = {}, entries = this.data.milkEntries || []) {
    if (option.kind === 'breast_milk') {
      return (entries || []).some((entry) => entry.kind === 'breast_milk');
    }
    return (entries || []).some((entry) => entry.kind === 'formula_powder' && entry.powderId === option.powderId);
  },

  isEntryForAddMilkOption(entry = {}, option = {}) {
    if (option.kind === 'breast_milk') {
      return entry.kind === 'breast_milk';
    }
    return entry.kind === 'formula_powder' && entry.powderId === option.powderId;
  },

  createEntryFromAddMilkOption(option = {}) {
    if (option.kind === 'breast_milk') {
      return createBreastEntry({ justAdded: true });
    }
    const powders = this.data.formulaPowders || [];
    const powder = powders.find((item) => item.id === option.powderId);
    if (!powder) return null;
    const powderPickerIndex = Math.max(0, powders.findIndex((item) => item.id === powder.id));
    return createFormulaEntry(powder, { powderPickerIndex, justAdded: true });
  },

  // 按 Tab 分库展示：我的奶粉（含母乳）/ 系统奶粉，交互与食物选择一致。
  buildAddMilkOptions(scope = this.data.addMilkActiveScope) {
    const isSystemScope = scope === 'system';
    const scopedPowders = (this.data.formulaPowders || []).filter((powder) => (
      isSystemScope
        ? powder.sourceType === 'system'
        : powder.sourceType !== 'system'
    ));

    const options = [
      ...(isSystemScope ? [] : [{
        key: 'breast_milk',
        kind: 'breast_milk',
        label: '母乳',
        subLabel: '记录母乳体积',
        categoryShortLabel: '母',
        categoryBadgeClass: 'breast',
        categoryBadgeStyle: buildCategoryBadgeStyle(BREAST_MILK_TAG_META),
        selected: false
      }]),
      ...sortFormulaPowdersByCategory(scopedPowders).map((powder) => ({
        key: `powder:${powder.id}`,
        kind: 'formula_powder',
        powderId: powder.id,
        sourceType: powder.sourceType || 'user',
        sourcePowderCode: powder.sourcePowderCode || powder.sourceSystemPowderId || '',
        scopeLabel: isSystemScope ? '系统' : '我的',
        label: powder.name || '未命名奶粉',
        subLabel: `${powder.categoryShortLabel || '奶'}类奶粉`,
        categoryShortLabel: powder.categoryShortLabel || '奶',
        categoryBadgeClass: powder.categoryBadgeClass || '',
        categoryBadgeStyle: powder.categoryBadgeStyle || '',
        selected: false
      }))
    ];

    return options.map((option) => ({
      ...option,
      selected: this.isAddMilkOptionSelected(option)
    }));
  },

  switchAddMilkScope(e) {
    const { scope } = e.currentTarget.dataset || {};
    if (!scope || scope === this.data.addMilkActiveScope) return;
    this.setData({
      addMilkActiveScope: scope,
      addMilkOptions: this.buildAddMilkOptions(scope)
    });
  },

  addMilkEntry() {
    this.openAddMilkPanel();
  },

  openAddMilkPanel() {
    dismissKeyboard();
    this.setData({
      showAddMilkPanel: true,
      addMilkActiveScope: 'mine',
      addMilkOptions: this.buildAddMilkOptions('mine')
    }, dismissKeyboard);
  },

  buildFlyMilkStyle(flight = {}, moving = false) {
    const fromX = Number.isFinite(Number(flight.fromX)) ? Number(flight.fromX) : 0;
    const fromY = Number.isFinite(Number(flight.fromY)) ? Number(flight.fromY) : 0;
    const toX = Number.isFinite(Number(flight.toX)) ? Number(flight.toX) : fromX;
    const toY = Number.isFinite(Number(flight.toY)) ? Number(flight.toY) : fromY;
    const dx = moving ? Math.round(toX - fromX) : 0;
    const dy = moving ? Math.round(toY - fromY) : 0;
    const opacity = moving ? 0 : 1;
    const transition = moving
      ? 'transform 760ms cubic-bezier(0.55, 0, 1, 0.45), opacity 260ms ease-out 500ms'
      : 'none';

    return [
      `left: ${Math.round(fromX)}px`,
      `top: ${Math.round(fromY)}px`,
      `transform: translate3d(${dx}px, ${dy}px, 0)`,
      `opacity: ${opacity}`,
      `transition: ${transition}`
    ].join('; ');
  },

  getFallbackFlight(touch = {}) {
    const fromX = Number.isFinite(Number(touch.clientX)) ? Number(touch.clientX) : 180;
    const fromY = Number.isFinite(Number(touch.clientY)) ? Number(touch.clientY) : 520;
    return {
      fromX,
      fromY,
      toX: 24,
      toY: 220
    };
  },

  measureAddMilkFlight(optionIndex, fallbackFlight = this.getFallbackFlight()) {
    return new Promise((resolve) => {
      if (!wxApi.createSelectorQuery) {
        resolve(fallbackFlight);
        return;
      }

      const query = wxApi.createSelectorQuery();
      const scopedQuery = typeof query.in === 'function' ? query.in(this) : query;
      let sourceRect = null;
      let targetRect = null;

      scopedQuery.select(`.add-milk-option-source-${optionIndex}`).boundingClientRect((rect) => {
        sourceRect = rect;
      });
      scopedQuery.select('.milk-entry-list-anchor').boundingClientRect((rect) => {
        targetRect = rect;
      });
      scopedQuery.exec(() => {
        if (!sourceRect || !targetRect) {
          resolve(fallbackFlight);
          return;
        }

        resolve({
          fromX: sourceRect.left,
          fromY: sourceRect.top + Math.max(0, (sourceRect.height - 42) / 2),
          toX: targetRect.left + 14,
          toY: targetRect.top + 14
        });
      });
    });
  },

  toggleAddMilkOption(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const optionIndex = Number(e.currentTarget.dataset.index);
    const touch = ((e.changedTouches || e.touches || [])[0]) || {};
    const option = (this.data.addMilkOptions || []).find((item) => item.key === key);
    if (!option) return;

    if (option.selected) {
      const nextEntries = (this.data.milkEntries || []).filter((entry) => !this.isEntryForAddMilkOption(entry, option));
      this.setData({
        milkEntries: nextEntries,
        addMilkOptions: (this.data.addMilkOptions || []).map((item) => (
          item.key === key ? { ...item, selected: false } : item
        ))
      }, () => {
        dismissKeyboard();
        this.refreshNutritionPreview();
      });
      return;
    }

    const nextEntry = this.createEntryFromAddMilkOption(option);
    if (!nextEntry) return;

    this.setData({
      milkEntries: [
        ...(this.data.milkEntries || []),
        nextEntry
      ],
      addMilkOptions: (this.data.addMilkOptions || []).map((item) => (
        item.key === key ? { ...item, selected: true } : item
      ))
    }, () => {
      dismissKeyboard();
      this.playAddMilkAnimation(option, optionIndex, touch);
      this.refreshNutritionPreview();
    });
  },

  playAddMilkAnimation(option = {}, optionIndex = 0, touch = {}) {
    const fallbackFlight = this.getFallbackFlight(touch);
    const startStyle = this.buildFlyMilkStyle(fallbackFlight, false);
    this.setData({
      flyMilkAnimation: {
        active: true,
        badge: option.categoryShortLabel || '奶',
        label: option.label || '奶',
        count: 1,
        style: startStyle
      }
    });

    this.measureAddMilkFlight(optionIndex, fallbackFlight).then((flight) => {
      this.setData({
        'flyMilkAnimation.style': this.buildFlyMilkStyle(flight, false)
      }, () => {
        const startMove = () => {
          this.setData({
            'flyMilkAnimation.style': this.buildFlyMilkStyle(flight, true)
          });
        };
        if (typeof wxApi.nextTick === 'function') {
          wxApi.nextTick(startMove);
        } else {
          setTimeout(startMove, 0);
        }
      });
    });

    const timer = setTimeout(() => {
      this.clearAddMilkAnimation();
    }, 900);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
  },

  clearAddMilkAnimation() {
    this.setData({
      flyMilkAnimation: {
        active: false,
        badge: '',
        label: '',
        count: 0,
        style: ''
      },
      milkEntries: (this.data.milkEntries || []).map((entry) => ({
        ...entry,
        justAdded: false
      }))
    });
  },

  cancelAddMilkPanel() {
    this.setData({
      showAddMilkPanel: false,
      addMilkOptions: []
    });
  },

  removeMilkEntry(e) {
    const index = Number(e.currentTarget.dataset.index);
    const entries = (this.data.milkEntries || []).filter((_, itemIndex) => itemIndex !== index);

    this.setData({
      milkEntries: entries
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  onMilkEntryPickerChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const pickerIndex = Number(e.detail.value) || 0;
    const options = this.data.formulaPowders || [];
    const powder = options[pickerIndex];
    if (!powder) return;

    const entries = [...(this.data.milkEntries || [])];
    const entry = {
      ...(entries[index] || {}),
      powderId: powder.id,
      powderPickerIndex: pickerIndex,
      powderSnapshot: null
    };

    if (entry.ratioMode !== 'custom') {
      if (entry.waterVolume) {
        entry.powderWeight = calculatePowderFromWater(entry.waterVolume, powder.mixRatio);
      } else if (entry.powderWeight) {
        entry.waterVolume = calculateWaterFromPowder(entry.powderWeight, powder.mixRatio);
      }
    }

    entries[index] = entry;
    this.setData({
      milkEntries: entries
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  onMilkEntryInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const value = e.detail.value;
    const entries = [...(this.data.milkEntries || [])];
    const entry = {
      ...(entries[index] || {}),
      [field]: value
    };
    const powder = this.findPowderForEntry(entry);

    if (powder && entry.ratioMode !== 'custom') {
      if (field === 'waterVolume') {
        entry.powderWeight = calculatePowderFromWater(value, powder.mixRatio);
      } else if (field === 'powderWeight') {
        entry.waterVolume = calculateWaterFromPowder(value, powder.mixRatio);
      }
    }

    entries[index] = entry;
    this.setData({
      milkEntries: entries
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  onBreastMilkEntryInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const entries = [...(this.data.milkEntries || [])];
    entries[index] = {
      ...(entries[index] || {}),
      volume: toVolumeInputValue(e.detail.value)
    };
    this.setData({
      milkEntries: entries
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  onMilkEntryRatioModeChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const mode = e.currentTarget.dataset.mode === 'custom' ? 'custom' : 'standard';
    const entries = [...(this.data.milkEntries || [])];
    const entry = {
      ...(entries[index] || {}),
      ratioMode: mode
    };
    const powder = this.findPowderForEntry(entry);

    if (mode === 'standard' && powder) {
      if (entry.waterVolume) {
        entry.powderWeight = calculatePowderFromWater(entry.waterVolume, powder.mixRatio);
      } else if (entry.powderWeight) {
        entry.waterVolume = calculateWaterFromPowder(entry.powderWeight, powder.mixRatio);
      }
    }

    entries[index] = entry;
    this.setData({
      milkEntries: entries
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  createEntryFromComponent(component = {}) {
    if (component.kind === 'breast_milk') {
      return createBreastEntry({
        localId: `breast_${component.volume || 0}`,
        volume: component.volume
      });
    }

    const options = this.data.formulaPowders || [];
    const powder = options.find((item) => item.id === component.powderId);
    const powderSnapshot = powder ? null : createPowderFromComponent(component);
    const powderPickerIndex = Math.max(0, options.findIndex((item) => item.id === component.powderId));
    return createFormulaEntry(powder || powderSnapshot, {
      localId: `formula_${component.powderId || 'history'}_${component.waterVolume || 0}_${component.powderWeight || 0}`,
      powderId: component.powderId,
      waterVolume: component.waterVolume,
      powderWeight: component.powderWeight,
      ratioMode: component.ratioMode,
      powderPickerIndex,
      powderSnapshot
    });
  },

  resolveEditingRecord(records = []) {
    if (this.data.editorMode !== 'edit') {
      return null;
    }

    if (this.data.editingRecordId) {
      return (records || []).find((record) => (
        record._id === this.data.editingRecordId || record.id === this.data.editingRecordId
      )) || null;
    }

    const index = Number(this.data.editingRecordIndex);
    if (Number.isInteger(index) && index >= 0) {
      return (records || [])[index] || null;
    }

    return null;
  },

  applyEditingRecord(record = {}) {
    const components = Array.isArray(record.formulaComponents) ? record.formulaComponents : [];
    const milkEntries = components
      .filter((component) => component.kind === 'breast_milk' || component.kind === 'formula_powder')
      .map((component) => this.createEntryFromComponent(component));
    const basicInfo = record.basicInfoSnapshot || {};
    const recordId = record._id || record.id || this.data.editingRecordId;
    const originalDueAt = record.startDateTime
      ? new Date(record.startDateTime)
      : buildDateTime(record.date || this.data.selectedDate, record.startTime || this.data.startTime);
    this._originalReminderSourceKey = recordId ? `milk:${recordId}` : '';
    this._originalReminderDueAtMs = Number.isNaN(originalDueAt.getTime()) ? 0 : originalDueAt.getTime();

    this.setData({
      editingRecordId: recordId,
      startTime: record.startTime || this.data.startTime,
      endTime: record.endTime || '',
      notes: record.notes || '',
      weight: toInputValue(basicInfo.weight || this.data.weight),
      height: toInputValue(basicInfo.height || this.data.height),
      naturalProteinCoefficientInput: toInputValue(basicInfo.naturalProteinCoefficient || this.data.naturalProteinCoefficientInput),
      specialProteinCoefficientInput: toInputValue(basicInfo.specialProteinCoefficient || this.data.specialProteinCoefficientInput),
      calorieCoefficientInput: toInputValue(basicInfo.calorieCoefficient || this.data.calorieCoefficientInput),
      milkEntries: this.normalizeMilkEntries(milkEntries),
      recentDefaultsLoaded: false,
      recentDefaultText: ''
    }, () => {
      this.refreshNutritionPreview();
    });
  },

  buildCurrentComponents() {
    return this.buildComponentsFromEntries(this.data.milkEntries || []);
  },

  buildComponentsFromEntries(entries = []) {
    return (entries || [])
      .map((entry) => {
        if (entry.kind === 'breast_milk') {
          const volume = Number(entry.volume);
          return Number.isFinite(volume) && volume > 0
            ? buildBreastMilkComponent(volume, this.data.nutritionSettings || {})
            : null;
        }
        const powder = this.findPowderForEntry(entry);
        if (!powder) return null;
        return buildFormulaPowderComponent(powder, entry);
      })
      .filter(Boolean);
  },

  refreshNutritionPreview() {
    const components = this.buildCurrentComponents();
    const nutritionPreview = withProteinDisplay(buildNutritionSummary(components));
    const targetContext = this.data.targetContext || {};
    const previousSummary = this.getEditingPreviousSummary();
    const targetPreview = buildEntryTargetPreview({
      currentSummary: targetContext.currentSummary || this.summarizeRecordsForTarget(this.data.existingRecords || []),
      draftSummary: nutritionPreview,
      previousSummary,
      weight: this.data.weight || targetContext.weight,
      targetPreferences: targetContext.targetPreferences || {},
      includeCalories: true
    });
    const dailyConsumedCalories = Number(targetContext.currentSummary?.calories);
    const fallbackConsumedCalories = (this.data.existingRecords || []).reduce((total, record) => (
      total + (Number(record?.nutritionSummary?.calories) || 0)
    ), 0);
    const consumedCalories = Number.isFinite(dailyConsumedCalories) ? dailyConsumedCalories : fallbackConsumedCalories;
    const effectiveConsumedCalories = Math.max(0, consumedCalories - (Number(previousSummary.calories) || 0));
    const weight = Number(this.data.weight || targetContext.weight);
    const calorieCoefficient = Number(this.data.calorieCoefficientInput || targetContext.targetPreferences?.calorieCoefficient);
    const hasGoal = Number.isFinite(weight) && weight > 0 && Number.isFinite(calorieCoefficient) && calorieCoefficient > 0;
    const calorieGoal = hasGoal ? Math.round(weight * calorieCoefficient) : '';
    const remainingBefore = hasGoal ? Math.max(0, Math.round(calorieGoal - effectiveConsumedCalories)) : '';
    const remainingAfter = hasGoal ? Math.max(0, Math.round(calorieGoal - effectiveConsumedCalories - nutritionPreview.calories)) : '';

    this.setData({
      nutritionPreview,
      targetPreview,
      goalPreview: {
        calorieGoal,
        consumedCalories: Math.round(effectiveConsumedCalories),
        remainingBefore,
        remainingAfter
      }
    });
  },

  getEditingPreviousSummary() {
    if (this.data.editorMode !== 'edit') {
      return normalizeSummary();
    }
    const record = this.resolveEditingRecord(this.data.existingRecords || []);
    return normalizeSummary(record?.nutritionSummary || {});
  },

  buildBasicInfoSnapshot() {
    return {
      weight: toNumberOrEmpty(this.data.weight),
      height: toNumberOrEmpty(this.data.height),
      naturalProteinCoefficient: toNumberOrEmpty(this.data.naturalProteinCoefficientInput),
      specialProteinCoefficient: toNumberOrEmpty(this.data.specialProteinCoefficientInput),
      calorieCoefficient: toNumberOrEmpty(this.data.calorieCoefficientInput),
      source: 'manual'
    };
  },

  validateMilkEntries(entries = []) {
    for (const entry of entries || []) {
      if (entry.kind === 'breast_milk') {
        const volume = Number(entry.volume);
        if (!Number.isFinite(volume) || volume <= 0) {
          wxApi.showToast({ title: '请填写母乳体积', icon: 'none' });
          return false;
        }
        continue;
      }

      const powder = this.findPowderForEntry(entry);
      const waterVolume = Number(entry.waterVolume);
      const powderWeight = Number(entry.powderWeight);
      if (!powder) {
        wxApi.showToast({ title: '请选择奶粉', icon: 'none' });
        return false;
      }
      if (!Number.isFinite(waterVolume) || waterVolume <= 0) {
        wxApi.showToast({ title: '请填写水量', icon: 'none' });
        return false;
      }
      if (!Number.isFinite(powderWeight) || powderWeight <= 0) {
        wxApi.showToast({ title: '请填写粉量', icon: 'none' });
        return false;
      }
    }
    return true;
  },

  async notifyPreviousPageRefresh() {
    const pages = getCurrentPages();
    const prevPage = pages[pages.length - 2];
    if (!prevPage) {
      return;
    }
    if (typeof prevPage.fetchDailyRecords === 'function') {
      await prevPage.fetchDailyRecords(this.data.selectedDate, {
        silent: true,
        skipNextOnShowRefresh: true
      });
      return;
    }
    if (prevPage.route === 'pages/daily-feeding/index' && typeof prevPage.loadTodayData === 'function') {
      await prevPage.loadTodayData(true);
    }
  },

  async saveFeedingRecord() {
    if (!this.data.startTime) {
      wxApi.showToast({ title: '请选择喂奶时间', icon: 'none' });
      return false;
    }

    if (!this.validateMilkEntries(this.data.milkEntries || [])) {
      return false;
    }

    const formulaComponents = this.buildCurrentComponents();
    if (!formulaComponents.length) {
      wxApi.showToast({ title: '至少记录一种奶', icon: 'none' });
      return false;
    }

    const nutritionSummary = buildNutritionSummary(formulaComponents);
    const payload = {
      babyUid: this.data.babyUid,
      date: this.data.selectedDate,
      startTime: this.data.startTime,
      endTime: this.data.endTime || '',
      startDateTime: buildDateTime(this.data.selectedDate, this.data.startTime),
      endDateTime: this.data.endTime ? buildDateTime(this.data.selectedDate, this.data.endTime) : null,
      formulaComponents,
      nutritionSummary,
      basicInfoSnapshot: this.buildBasicInfoSnapshot(),
      notes: this.data.notes || ''
    };

    try {
      wxApi.showLoading({ title: '保存中' });
      if (this.data.editorMode === 'edit') {
        if (!this.data.editingRecordId) {
          wxApi.hideLoading();
          wxApi.showToast({ title: '未找到要编辑的记录', icon: 'none' });
          return false;
        }
        await updateFeedingRecordV2(this.data.editingRecordId, payload);
        payload._id = this.data.editingRecordId;
        const nextDueAtMs = payload.startDateTime.getTime();
        if (
          this._originalReminderSourceKey
          && this._originalReminderDueAtMs
          && nextDueAtMs !== this._originalReminderDueAtMs
        ) {
          const candidate = buildUpcomingReminderCandidates({
            milkRecords: [payload]
          }).milk;
          await rescheduleReminderSubscriptions({
            wxApi,
            sourceKey: this._originalReminderSourceKey,
            candidate
          });
        }
      } else {
        const addResult = await addFeedingRecordV2(payload);
        payload._id = (addResult && (addResult._id || (addResult.result && addResult.result._id))) || '';
      }
      await markDailySummaryDirty(this.data.babyUid, this.data.selectedDate);
      await this.notifyPreviousPageRefresh();
      wxApi.hideLoading();
      wxApi.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        wxApi.navigateBack();
      }, 300);
      return true;
    } catch (error) {
      wxApi.hideLoading();
      console.error('保存喂奶记录失败：', error);
      wxApi.showToast({ title: '保存失败，请稍后再试', icon: 'none' });
      return false;
    }
  },

  onCancel() {
    wxApi.navigateBack();
  }
});
