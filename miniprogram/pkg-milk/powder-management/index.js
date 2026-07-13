const PowderCatalogModel = require('../../models/powderCatalog');
const NutritionModel = require('../../models/nutrition');
const SystemPowderIndex = require('../../utils/systemPowderIndex');
const {
  buildVirtualBreastMilkPowder,
  buildBreastMilkPowderDraft,
  isVirtualBreastMilkPowder,
  stripVirtualBreastMilkPowders
} = require('../../utils/breastMilkProfileItem');
const {
  POWDER_CATEGORIES,
  POWDER_CATEGORY_META,
  POWDER_CATEGORY_ORDER,
  POWDER_STATUSES,
  PROTEIN_ROLES,
  buildCategoryBadgeStyle
} = require('../../utils/formulaPowderUtils');
const { waitForAppInitialization, getBabyUid, handleError } = require('../../utils/index');

const ACTIVE_POWDER_RENDER_BATCH = 30;
const POWDER_PLACEHOLDER_IMAGE = '/images/LemonLogo.png';
const POWDER_TYPE_OPTIONS = [
  {
    value: POWDER_CATEGORIES.REGULAR_FORMULA,
    label: POWDER_CATEGORY_META[POWDER_CATEGORIES.REGULAR_FORMULA].label,
    desc: '默认按天然蛋白计算'
  },
  {
    value: POWDER_CATEGORIES.SPECIAL_FORMULA,
    label: POWDER_CATEGORY_META[POWDER_CATEGORIES.SPECIAL_FORMULA].label,
    desc: '默认按特殊蛋白计算'
  },
  {
    value: POWDER_CATEGORIES.ENERGY_SUPPLEMENT,
    label: POWDER_CATEGORY_META[POWDER_CATEGORIES.ENERGY_SUPPLEMENT].label,
    desc: '无蛋白，计入热量'
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function getServerDate() {
  return wx.cloud.database().serverDate();
}

function isBlank(value) {
  return value === undefined || value === null || `${value}`.trim() === '';
}

function isValidNumber(value, allowZero = true) {
  if (isBlank(value)) return false;
  const num = Number(value);
  if (!Number.isFinite(num)) return false;
  return allowZero ? num >= 0 : num > 0;
}

function createEmptyPowderDraft(category = POWDER_CATEGORIES.REGULAR_FORMULA) {
  const proteinRole = category === POWDER_CATEGORIES.SPECIAL_FORMULA
    ? PROTEIN_ROLES.SPECIAL
    : category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT
      ? PROTEIN_ROLES.NONE
      : PROTEIN_ROLES.NATURAL;

  return {
    id: '',
    name: '',
    category,
    proteinRole,
    nutritionPer100g: {
      protein: '',
      calories: '',
      fat: '',
      carbs: '',
      fiber: ''
    },
    mixRatio: {
      powder: '',
      water: ''
    },
    status: POWDER_STATUSES.ACTIVE,
    source: 'user',
    createdAt: '',
    updatedAt: '',
    deletedAt: null
  };
}

function getPowderTypeIndex(category) {
  const index = POWDER_TYPE_OPTIONS.findIndex((option) => option.value === category);
  return index >= 0 ? index : 0;
}

function buildPowderTypeState(category) {
  const powderTypeIndex = getPowderTypeIndex(category);
  const option = POWDER_TYPE_OPTIONS[powderTypeIndex];
  return {
    powderTypeIndex,
    powderTypeLabel: option.label,
    powderTypeDesc: option.desc
  };
}

function buildPowderSearchText(powder = {}) {
  return [
    powder.name || '',
    powder.brand || '',
    powder.stage || '',
    Array.isArray(powder.alias) ? powder.alias.join(' ') : ''
  ].join(' ');
}

function matchesPowderSearch(powder, query = '') {
  const normalized = query.toString().trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return true;
  return SystemPowderIndex.fuzzyIncludes(buildPowderSearchText(powder), normalized);
}

function buildPowderDraftFromSystem(powder = {}) {
  return {
    id: '',
    name: powder.name || '',
    category: powder.category || POWDER_CATEGORIES.REGULAR_FORMULA,
    proteinRole: powder.proteinRole || PROTEIN_ROLES.NATURAL,
    nutritionPer100g: {
      protein: `${powder.nutritionPer100g?.protein ?? ''}`,
      calories: `${powder.nutritionPer100g?.calories ?? ''}`,
      fat: `${powder.nutritionPer100g?.fat ?? ''}`,
      carbs: `${powder.nutritionPer100g?.carbs ?? ''}`,
      fiber: `${powder.nutritionPer100g?.fiber ?? ''}`
    },
    mixRatio: {
      powder: `${powder.mixRatio?.powder ?? ''}`,
      water: `${powder.mixRatio?.water ?? ''}`
    },
    status: POWDER_STATUSES.ACTIVE,
    source: 'system',
    sourceSystemPowderId: powder.powderCode || powder._id || '',
    createdAt: '',
    updatedAt: '',
    deletedAt: null
  };
}

function enrichPowderItem(powder = {}) {
  const isBreastMilk = isVirtualBreastMilkPowder(powder)
    || powder.category === POWDER_CATEGORIES.BREAST_MILK;
  const categoryMeta = POWDER_CATEGORY_META[powder.category] || {
    label: '配方粉',
    shortLabel: '粉',
    badgeClass: 'regular',
    colors: {}
  };
  const listImage = powder.imageUrl || powder.image || '';
  const nutrition = powder.nutritionPer100g || {};
  const mixRatio = powder.mixRatio || {};

  return {
    ...powder,
    powderId: powder.id || powder._id || '',
    categoryLabel: categoryMeta.label,
    categoryShortLabel: categoryMeta.shortLabel,
    categoryBadgeClass: categoryMeta.badgeClass,
    categoryBadgeStyle: buildCategoryBadgeStyle(categoryMeta),
    displayImage: listImage || POWDER_PLACEHOLDER_IMAGE,
    showListImage: !!listImage,
    showImageSlot: true,
    isVirtualBreastMilk: isBreastMilk,
    nutritionBasisUnit: powder.nutritionBasisUnit || (isBreastMilk ? 'ml' : 'g'),
    nutritionBasisQuantity: powder.nutritionBasisQuantity || 100,
    metaPath: powder.brandStageText || [powder.brand, powder.stage].filter(Boolean).join(' · ') || categoryMeta.label,
    nutritionPer100g: nutrition,
    mixRatio,
    showMixRatio: !isBreastMilk,
    mixRatioText: isBreastMilk ? '无需冲配' : `${mixRatio.powder || 0}g : ${mixRatio.water || 0}ml`
  };
}

Page({
  data: {
    loading: false,
    babyUid: '',
    breastMilkSettings: {},
    powders: [],
    groupedPowders: [],
    activeLibraryScope: 'mine',
    libraryTabs: [
      { scope: 'mine', label: '我的奶粉' },
      { scope: 'system', label: '系统奶粉' }
    ],
    searchQuery: '',
    filteredPowderCount: 0,
    activeCategory: POWDER_CATEGORIES.BREAST_MILK,
    activeCategoryLabel: POWDER_CATEGORY_META[POWDER_CATEGORIES.BREAST_MILK].label,
    activePowders: [],
    activePowderTotal: 0,
    activePowderRenderLimit: ACTIVE_POWDER_RENDER_BATCH,
    hasMoreActivePowders: false,
    powderPanelScrollTop: 0,
    powderPlaceholderImage: POWDER_PLACEHOLDER_IMAGE,
    showAddModal: false,
    powderTypeOptions: POWDER_TYPE_OPTIONS,
    powderTypeIndex: 0,
    powderTypeLabel: POWDER_TYPE_OPTIONS[0].label,
    powderTypeDesc: POWDER_TYPE_OPTIONS[0].desc,
    powderDraft: createEmptyPowderDraft(),
    energyKjInput: '',
    editingPowderIsSystemSource: false,
    editingSourceSystemPowderId: '',
    editingBreastMilk: false
  },

  async onLoad(options = {}) {
    try {
      this.shouldOpenAddModal = options.openAdd === '1';
      this.shouldOpenBreastMilk = options.editBreastMilk === '1';
      await waitForAppInitialization();
      const babyUid = getBabyUid();
      this.setData({ babyUid: babyUid || '' });
      await this.loadPowders();
      if (this.shouldOpenBreastMilk) {
        this.shouldOpenBreastMilk = false;
        this.openBreastMilkEditor();
      } else if (this.shouldOpenAddModal) {
        this.shouldOpenAddModal = false;
        this.showAddModal();
      }
    } catch (error) {
      handleError(error, { title: '加载奶粉库失败' });
    }
  },

  openBreastMilkEditor() {
    const breastMilk = (this.data.powders || []).find((item) => isVirtualBreastMilkPowder(item));
    if (!breastMilk) {
      return;
    }
    this.setData({ activeLibraryScope: 'mine' });
    this.showEditModal({ currentTarget: { dataset: { id: breastMilk.powderId || breastMilk._id } } });
  },

  async onShow() {
    // 列表已加载时，返回本页不强制重载；避免重复 getTempFileURL。
    // 子页保存后可通过 powdersDirty 触发刷新。
    if (this.data.powders.length > 0 && !this._powdersDirty) {
      return;
    }
    this._powdersDirty = false;
    await this.loadPowders({ keepScope: this.data.powders.length > 0 });
  },

  markPowdersDirty() {
    this._powdersDirty = true;
  },

  async loadPowders(options = {}) {
    try {
      this.setData({ loading: true });
      await waitForAppInitialization();
      const babyUid = this.data.babyUid || getBabyUid();
      this.setData({ babyUid: babyUid || '' });

      const { systemPowders, userPowders } = await PowderCatalogModel.getAvailablePowders(babyUid);
      // 合并后一次换链，配合 cloudTempUrlCache 命中则接近 0 次存储调用
      const resolvedAll = await PowderCatalogModel.resolvePowderImageUrls([
        ...(systemPowders || []),
        ...(userPowders || [])
      ]);
      let breastMilkSettings = {};
      if (babyUid) {
        try {
          breastMilkSettings = await NutritionModel.getNutritionSettings(babyUid);
        } catch (error) {
          console.warn('加载母乳参数失败，使用默认值:', error);
        }
      }
      const powders = resolvedAll.map(enrichPowderItem);

      this.applyPowderList(powders, { ...options, breastMilkSettings });
    } catch (error) {
      console.error('加载奶粉数据失败:', error);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyPowderList(powders = [], options = {}) {
    const breastMilkSettings = options.breastMilkSettings || this.data.breastMilkSettings || {};
    const powdersWithBreastMilk = [
      enrichPowderItem(buildVirtualBreastMilkPowder(breastMilkSettings)),
      ...stripVirtualBreastMilkPowders(powders)
    ];
    const scopedPowders = this.filterPowdersByLibrary(powdersWithBreastMilk);
    const filteredPowders = scopedPowders.filter((item) => matchesPowderSearch(item, this.data.searchQuery));
    const isMineScope = (this.data.activeLibraryScope || 'mine') === 'mine';
    const alwaysShowBreastMilk = isMineScope && !this.data.searchQuery;
    const groupedPowders = this.groupPowdersByCategory(filteredPowders, {
      alwaysShowBreastMilk
    });
    const activeCategory = this.getNextActiveCategory(
      groupedPowders,
      options.keepScope ? this.data.activeCategory : ''
    );

    this.setData({
      powders: powdersWithBreastMilk,
      breastMilkSettings,
      groupedPowders,
      filteredPowderCount: filteredPowders.length,
      activeCategory
    });
    this.refreshActivePowders(groupedPowders, activeCategory);
  },

  filterPowdersByLibrary(powders = []) {
    const scope = this.data.activeLibraryScope || 'mine';
    return (powders || []).filter((powder) => {
      const libraryScope = powder.libraryScope || (powder.isSystem ? 'system' : 'mine');
      return libraryScope === scope;
    });
  },

  groupPowdersByCategory(powders = [], options = {}) {
    const alwaysShowBreastMilk = options.alwaysShowBreastMilk === true;
    const groups = POWDER_CATEGORY_ORDER.reduce((acc, category) => {
      acc[category] = [];
      return acc;
    }, {});

    powders.forEach((powder) => {
      const category = groups[powder.category] ? powder.category : POWDER_CATEGORIES.REGULAR_FORMULA;
      groups[category].push(powder);
    });

    if (
      alwaysShowBreastMilk
      && !groups[POWDER_CATEGORIES.BREAST_MILK].length
    ) {
      groups[POWDER_CATEGORIES.BREAST_MILK].push(
        enrichPowderItem(buildVirtualBreastMilkPowder(this.data.breastMilkSettings || {}))
      );
    }

    return POWDER_CATEGORY_ORDER
      .map((category, index) => ({
        navId: `powder-category-${index}`,
        category,
        categoryLabel: POWDER_CATEGORY_META[category]?.label || category,
        items: (groups[category] || []).sort((a, b) => {
          if (a.isVirtualBreastMilk) return -1;
          if (b.isVirtualBreastMilk) return 1;
          return a.name.localeCompare(b.name);
        })
      }))
      .filter((group) => {
        if (group.category === POWDER_CATEGORIES.BREAST_MILK && alwaysShowBreastMilk) {
          return true;
        }
        return group.items.length > 0;
      });
  },

  getNextActiveCategory(groupedPowders = [], preferredCategory = '') {
    const isMineScope = (this.data.activeLibraryScope || 'mine') === 'mine';
    if (!groupedPowders.length) {
      return isMineScope
        ? POWDER_CATEGORIES.BREAST_MILK
        : POWDER_CATEGORIES.REGULAR_FORMULA;
    }

    const candidate = preferredCategory || this.data.activeCategory || '';
    const matchedGroup = groupedPowders.find((group) => group.category === candidate);
    if (matchedGroup) {
      return matchedGroup.category;
    }

    if (isMineScope) {
      const breastGroup = groupedPowders.find((group) => group.category === POWDER_CATEGORIES.BREAST_MILK);
      if (breastGroup) {
        return breastGroup.category;
      }
    }

    return groupedPowders[0].category;
  },

  refreshActivePowders(groupedPowders = this.data.groupedPowders, activeCategory = this.data.activeCategory) {
    const activeGroup = groupedPowders.find((group) => group.category === activeCategory)
      || groupedPowders[0];
    const items = activeGroup ? (activeGroup.items || []) : [];
    const limit = Math.min(
      Math.max(Number(this.data.activePowderRenderLimit) || ACTIVE_POWDER_RENDER_BATCH, ACTIVE_POWDER_RENDER_BATCH),
      items.length
    );

    this.setData({
      activeCategory: activeGroup ? activeGroup.category : POWDER_CATEGORIES.REGULAR_FORMULA,
      activeCategoryLabel: activeGroup
        ? (activeGroup.categoryLabel || POWDER_CATEGORY_META[activeGroup.category]?.label || '')
        : POWDER_CATEGORY_META[POWDER_CATEGORIES.REGULAR_FORMULA].label,
      activePowders: items.slice(0, limit),
      activePowderTotal: items.length,
      activePowderRenderLimit: limit,
      hasMoreActivePowders: limit < items.length,
      powderPanelScrollTop: 0
    });
  },

  switchLibraryScope(e) {
    const scope = e?.currentTarget?.dataset?.scope || e;
    if (!scope || scope === this.data.activeLibraryScope) {
      return;
    }

    this.setData({
      activeLibraryScope: scope,
      activePowderRenderLimit: ACTIVE_POWDER_RENDER_BATCH
    });
    this.applyPowderList(this.data.powders, { keepScope: false });
  },

  switchCategory(e) {
    const category = e.currentTarget.dataset.category;
    if (!category || category === this.data.activeCategory) {
      return;
    }

    this.setData({
      activeCategory: category,
      activePowderRenderLimit: ACTIVE_POWDER_RENDER_BATCH
    });
    this.refreshActivePowders(this.data.groupedPowders, category);
  },

  onSearchInput(e) {
    const searchQuery = e.detail.value || '';
    this.setData({
      searchQuery,
      activePowderRenderLimit: ACTIVE_POWDER_RENDER_BATCH
    });
    this.applyPowderList(this.data.powders, { keepScope: true });
  },

  clearSearch() {
    this.setData({
      searchQuery: '',
      activePowderRenderLimit: ACTIVE_POWDER_RENDER_BATCH
    });
    this.applyPowderList(this.data.powders, { keepScope: true });
  },

  loadMoreActivePowders() {
    if (!this.data.hasMoreActivePowders) {
      return;
    }

    const activeGroup = this.data.groupedPowders.find(
      (group) => group.category === this.data.activeCategory
    );
    const items = activeGroup ? (activeGroup.items || []) : [];
    const nextLimit = Math.min(
      this.data.activePowderRenderLimit + ACTIVE_POWDER_RENDER_BATCH,
      items.length
    );

    this.setData({
      activePowders: items.slice(0, nextLimit),
      activePowderRenderLimit: nextLimit,
      hasMoreActivePowders: nextLimit < items.length
    });
  },

  previewPowderImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({ urls: [url], current: url });
  },

  showAddModal() {
    const activeCategory = this.data.activeCategory || POWDER_CATEGORIES.REGULAR_FORMULA;
    const category = activeCategory === POWDER_CATEGORIES.BREAST_MILK
      ? POWDER_CATEGORIES.REGULAR_FORMULA
      : activeCategory;
    this.setData({
      showAddModal: true,
      energyKjInput: '',
      editingPowderIsSystemSource: false,
      editingSourceSystemPowderId: '',
      editingBreastMilk: false,
      powderDraft: createEmptyPowderDraft(category),
      ...buildPowderTypeState(category)
    });
  },

  showSystemSaveModal(e) {
    const powderCode = e.currentTarget.dataset.id;
    const systemPowder = (this.data.powders || []).find(
      (item) => (item.powderCode || item._id) === powderCode && item.libraryScope === 'system'
    );

    if (!systemPowder) {
      wx.showToast({ title: '未找到该系统奶粉', icon: 'none' });
      return;
    }

    this.setData({
      showAddModal: true,
      energyKjInput: '',
      editingPowderIsSystemSource: true,
      editingSourceSystemPowderId: systemPowder.powderCode || systemPowder._id || '',
      editingBreastMilk: false,
      powderDraft: buildPowderDraftFromSystem(systemPowder),
      ...buildPowderTypeState(systemPowder.category)
    });
  },

  showEditModal(e) {
    const powderId = e.currentTarget.dataset.id;
    const powder = (this.data.powders || []).find((item) => item.powderId === powderId || item._id === powderId);
    if (!powder) {
      return;
    }
    if (isVirtualBreastMilkPowder(powder)) {
      this.setData({
        showAddModal: true,
        energyKjInput: '',
        editingPowderIsSystemSource: false,
        editingSourceSystemPowderId: '',
        editingBreastMilk: true,
        powderDraft: buildBreastMilkPowderDraft(powder),
        powderTypeIndex: -1,
        powderTypeLabel: POWDER_CATEGORY_META[POWDER_CATEGORIES.BREAST_MILK].label,
        powderTypeDesc: '天然蛋白来源，按每 100ml 维护营养参数'
      });
      return;
    }
    if (powder.libraryScope === 'system') {
      return;
    }

    this.setData({
      showAddModal: true,
      energyKjInput: '',
      editingPowderIsSystemSource: false,
      editingSourceSystemPowderId: '',
      editingBreastMilk: false,
      powderDraft: clone({
        id: powder.powderId || powder.id || '',
        name: powder.name || '',
        category: powder.category,
        proteinRole: powder.proteinRole,
        nutritionPer100g: {
          protein: `${powder.nutritionPer100g?.protein ?? ''}`,
          calories: `${powder.nutritionPer100g?.calories ?? ''}`,
          fat: `${powder.nutritionPer100g?.fat ?? ''}`,
          carbs: `${powder.nutritionPer100g?.carbs ?? ''}`,
          fiber: `${powder.nutritionPer100g?.fiber ?? ''}`
        },
        mixRatio: {
          powder: `${powder.mixRatio?.powder ?? ''}`,
          water: `${powder.mixRatio?.water ?? ''}`
        },
        status: powder.status || POWDER_STATUSES.ACTIVE,
        source: powder.source || 'user',
        sourceSystemPowderId: powder.sourceSystemPowderId || '',
        createdAt: powder.createdAt || '',
        updatedAt: powder.updatedAt || '',
        deletedAt: powder.deletedAt || null
      }),
      ...buildPowderTypeState(powder.category)
    });
  },

  hideAddModal() {
    this.setData({
      showAddModal: false,
      energyKjInput: '',
      editingPowderIsSystemSource: false,
      editingSourceSystemPowderId: '',
      editingBreastMilk: false,
      powderDraft: createEmptyPowderDraft(),
      ...buildPowderTypeState(POWDER_CATEGORIES.REGULAR_FORMULA)
    });
  },

  parseNumber(value) {
    if (value === '' || value === undefined || value === null) {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  },

  roundNumber(value, precision = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return 0;
    }
    const multiplier = Math.pow(10, precision);
    return Math.round((num + Number.EPSILON) * multiplier) / multiplier;
  },

  onEnergyKjInput(e) {
    this.setData({
      energyKjInput: e.detail.value || ''
    });
  },

  applyKjToKcal() {
    const kjValue = this.parseNumber(this.data.energyKjInput);
    if (kjValue === null || kjValue < 0) {
      wx.showToast({ title: '请填写有效的 kJ 数值', icon: 'none' });
      return;
    }

    const kcalValue = this.roundNumber(kjValue / 4.184, 2);
    this.setData({
      'powderDraft.nutritionPer100g.calories': String(kcalValue)
    });
    wx.showToast({ title: '已换算为 kcal', icon: 'success' });
  },

  onPowderTypePickerChange(e) {
    const index = Number(e.detail.value);
    const option = POWDER_TYPE_OPTIONS[index] || POWDER_TYPE_OPTIONS[0];
    const category = option.value;
    const draft = {
      ...this.data.powderDraft,
      category,
      proteinRole: category === POWDER_CATEGORIES.SPECIAL_FORMULA
        ? PROTEIN_ROLES.SPECIAL
        : category === POWDER_CATEGORIES.ENERGY_SUPPLEMENT
          ? PROTEIN_ROLES.NONE
          : PROTEIN_ROLES.NATURAL
    };
    this.setData({
      powderDraft: draft,
      ...buildPowderTypeState(category)
    });
  },

  validatePowderDraftRequired(values = {}, options = {}) {
    const isBreastMilk = options.isBreastMilk === true;
    const requiredFields = [
      ...(isBreastMilk ? [] : [{ field: 'name', label: '名称', type: 'text' }]),
      { field: 'protein', label: '蛋白', type: 'number' },
      { field: 'calories', label: '热量', type: 'number' },
      { field: 'fat', label: '脂肪', type: 'number' },
      { field: 'carbs', label: '碳水', type: 'number' },
      ...(isBreastMilk ? [] : [
        { field: 'ratioPowder', label: '冲配比粉量', type: 'positiveNumber' },
        { field: 'ratioWater', label: '冲配比水量', type: 'positiveNumber' }
      ])
    ];
    const invalidField = requiredFields.find(({ field, type }) => {
      if (type === 'text') {
        return isBlank(values[field]);
      }
      if (type === 'positiveNumber') {
        return !isValidNumber(values[field], false);
      }
      return !isValidNumber(values[field], true);
    });

    if (!invalidField) {
      return '';
    }

    return invalidField.type === 'text'
      ? `请填写${invalidField.label}`
      : `请填写有效的${invalidField.label}`;
  },

  async savePowderDraft(e) {
    const values = e.detail.value || {};
    const isBreastMilk = !!this.data.editingBreastMilk;
    const requiredError = this.validatePowderDraftRequired(values, { isBreastMilk });
    if (requiredError) {
      wx.showToast({ title: requiredError, icon: 'none' });
      return;
    }

    const babyUid = this.data.babyUid || getBabyUid();
    if (!babyUid) {
      wx.showToast({ title: '未找到宝宝信息', icon: 'none' });
      return;
    }

    if (isBreastMilk) {
      try {
        wx.showLoading({ title: '保存中...', mask: true });
        const result = await PowderCatalogModel.saveBreastMilkSettings(babyUid, {
          protein: toNumber(values.protein),
          calories: toNumber(values.calories),
          fat: toNumber(values.fat),
          carbs: toNumber(values.carbs),
          fiber: toNumber(values.fiber)
        });
        wx.hideLoading();
        wx.showToast({
          title: result.message || '保存成功',
          icon: 'success'
        });
        this.hideAddModal();
        await this.loadPowders({ keepScope: true });
      } catch (error) {
        wx.hideLoading();
        wx.showToast({ title: error?.message || '保存失败', icon: 'none' });
      }
      return;
    }

    const current = this.data.powderDraft;
    const isSystemSource = !!this.data.editingPowderIsSystemSource;
    const draft = {
      id: isSystemSource ? '' : (current.id || createId('powder')),
      name: (values.name || '').trim(),
      category: current.category,
      proteinRole: current.proteinRole,
      nutritionPer100g: {
        protein: toNumber(values.protein),
        calories: toNumber(values.calories),
        fat: toNumber(values.fat),
        carbs: toNumber(values.carbs),
        fiber: toNumber(values.fiber)
      },
      mixRatio: {
        powder: toNumber(values.ratioPowder),
        water: toNumber(values.ratioWater)
      },
      status: POWDER_STATUSES.ACTIVE,
      source: isSystemSource ? 'system' : (current.source || 'user'),
      sourceSystemPowderId: isSystemSource
        ? (this.data.editingSourceSystemPowderId || current.sourceSystemPowderId || '')
        : (current.sourceSystemPowderId || ''),
      createdAt: current.createdAt || getServerDate()
    };

    if (!draft.id) {
      draft.id = createId('powder');
    }

    try {
      wx.showLoading({ title: '保存中...', mask: true });
      const result = await PowderCatalogModel.saveUserPowder(babyUid, draft);
      wx.hideLoading();
      wx.showToast({
        title: result.message || '保存成功',
        icon: result.added === false ? 'none' : 'success'
      });

      if (result.added === false) {
        return;
      }

      this.hideAddModal();
      await this.loadPowders({ keepScope: true });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error?.message || '保存失败', icon: 'none' });
    }
  },

  async deletePowder(e) {
    const powderId = e.currentTarget.dataset.id;
    const powderName = e.currentTarget.dataset.name || '该奶粉';
    const babyUid = this.data.babyUid || getBabyUid();

    if (!babyUid || !powderId) {
      return;
    }
    if (isVirtualBreastMilkPowder({ _id: powderId, powderId })) {
      wx.showToast({ title: '母乳为固定条目，不能删除', icon: 'none' });
      return;
    }

    const modalRes = await wx.showModal({
      title: '删除这个奶粉？',
      content: `删除「${powderName}」后，记录喂奶时将不能再选择它。`,
      confirmText: '删除',
      confirmColor: '#E65A4F',
      cancelText: '取消'
    });

    if (!modalRes.confirm) {
      return;
    }

    try {
      wx.showLoading({ title: '删除中...', mask: true });
      const result = await PowderCatalogModel.deleteUserPowder(babyUid, powderId);
      wx.hideLoading();
      wx.showToast({ title: result.message || '已删除', icon: 'success' });
      await this.loadPowders({ keepScope: true });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error?.message || '删除失败', icon: 'none' });
    }
  }
});
