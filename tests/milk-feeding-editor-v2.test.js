const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createPageInstance(page, overrides = {}) {
  function applyPath(target, path, value) {
    const parts = String(path).split('.');
    if (parts.length === 1) {
      target[path] = value;
      return;
    }
    let cursor = target;
    parts.slice(0, -1).forEach((part) => {
      if (!cursor[part] || typeof cursor[part] !== 'object') {
        cursor[part] = {};
      }
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data)),
      ...overrides
    },
    setData(patch, callback) {
      const nextData = { ...this.data };
      Object.entries(patch).forEach(([key, value]) => {
        applyPath(nextData, key, value);
      });
      this.data = nextData;
      if (callback) {
        callback();
      }
    }
  };
}

function loadV2Page(options = {}) {
  const pagePath = require.resolve('../miniprogram/pkg-milk/milk-feeding-editor-v2/index.js');
  const profilePath = require.resolve('../miniprogram/models/nutritionProfile.js');
  const modelPath = require.resolve('../miniprogram/models/feedingRecordV2.js');
  const dailySummaryPath = require.resolve('../miniprogram/models/dailySummaryV2.js');
  const utilsPath = require.resolve('../miniprogram/utils/index.js');
  delete require.cache[pagePath];
  delete require.cache[profilePath];
  delete require.cache[modelPath];
  delete require.cache[dailySummaryPath];
  delete require.cache[utilsPath];

  const calls = {
    toasts: [],
    loading: [],
    titles: [],
    saved: null,
    updated: null,
    dirty: null,
    navigationBack: 0,
    navigatedUrl: ''
  };
  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  global.wx = {
    cloud: {
      database() {
        return {
          command: {
            lt(value) {
              return { value };
            }
          },
          serverDate() {
            return '__server_date__';
          },
          collection() {
            return {
              where() {
                return {
                  orderBy() {
                    return this;
                  },
                  limit() {
                    return this;
                  },
                  get: async () => ({ data: [] })
                };
              },
              doc() {
                return {
                  update: async () => ({})
                };
              },
              add: async () => ({ _id: 'v2-record-1' })
            };
          }
        };
      }
    },
    showToast(payload) {
      calls.toasts.push(payload);
    },
    showLoading(payload) {
      calls.loading.push(payload);
    },
    setNavigationBarTitle(payload) {
      calls.titles.push(payload);
    },
    navigateTo({ url }) {
      calls.navigatedUrl = url;
    },
    hideLoading() {},
    navigateBack() {
      calls.navigationBack += 1;
    }
  };
  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1'
    }
  });

  const profileModel = require(profilePath);
  const feedingRecordV2Model = require(modelPath);
  const dailySummaryV2Model = require(dailySummaryPath);
  const utilsModule = require(utilsPath);
  const previousGetNutritionProfileSettings = profileModel.getNutritionProfileSettings;
  const previousAddRecord = feedingRecordV2Model.addRecord;
  const previousUpdateRecord = feedingRecordV2Model.updateRecord;
  const previousMarkDirty = dailySummaryV2Model.markDirty;
  const previousResolveBasicInfoSnapshot = feedingRecordV2Model.resolveBasicInfoSnapshot;
  const previousGetRecordsByDate = feedingRecordV2Model.getRecordsByDate;
  const previousGetRecentRecord = feedingRecordV2Model.getRecentRecord;
  const previousGetBabyUid = utilsModule.getBabyUid;

  profileModel.getNutritionProfileSettings = options.getNutritionProfileSettings || (async () => ({
    natural_milk_protein: 1.1,
    natural_milk_calories: 67,
    natural_milk_fat: 4,
    natural_milk_carbs: 6.8,
    formulaPowders: []
  }));
  feedingRecordV2Model.addRecord = options.addRecord || (async (data) => {
    calls.saved = data;
    return { _id: 'v2-record-1' };
  });
  feedingRecordV2Model.updateRecord = options.updateRecord || (async (recordId, data) => {
    calls.updated = { recordId, data };
    return true;
  });
  dailySummaryV2Model.markDirty = options.markDirty || (async (babyUid, date) => {
    calls.dirty = { babyUid, date };
    return true;
  });
  feedingRecordV2Model.resolveBasicInfoSnapshot = options.resolveBasicInfoSnapshot || (async () => ({
    weight: 5.2,
    height: 58,
    naturalProteinCoefficient: 1.2,
    specialProteinCoefficient: '',
    calorieCoefficient: 100,
    source: 'baby_info'
  }));
  feedingRecordV2Model.getRecordsByDate = options.getRecordsByDate || (async () => []);
  feedingRecordV2Model.getRecentRecord = options.getRecentRecord || (async () => null);
  utilsModule.getBabyUid = options.getBabyUid || (() => 'baby-1');

  let pageConfig = null;
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  profileModel.getNutritionProfileSettings = previousGetNutritionProfileSettings;
  feedingRecordV2Model.addRecord = previousAddRecord;
  feedingRecordV2Model.updateRecord = previousUpdateRecord;
  dailySummaryV2Model.markDirty = previousMarkDirty;
  feedingRecordV2Model.resolveBasicInfoSnapshot = previousResolveBasicInfoSnapshot;
  feedingRecordV2Model.getRecordsByDate = previousGetRecordsByDate;
  feedingRecordV2Model.getRecentRecord = previousGetRecentRecord;
  utilsModule.getBabyUid = previousGetBabyUid;
  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;

  return { pageConfig, calls };
}

test('milk feeding v2 page renders v1-style editor with a unified optional component list', () => {
  const source = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxss', 'utf8');

  assert.match(source, /feedingRecordV2Model/);
  assert.match(source, /MilkNutritionProfileModel/);
  assert.match(source, /buildFormulaPowderComponent/);
  assert.doesNotMatch(source, /findOrCreateDailyRecord/);
  assert.doesNotMatch(source, /collection\(['"]feeding_records['"]\)/);
  assert.match(source, /milkEntries:\s*\[\]/);
  assert.match(source, /addMilkEntry/);
  assert.match(source, /toggleAddMilkOption/);
  assert.doesNotMatch(source, /confirmAddMilkEntries/);
  assert.match(source, /buildFlyMilkStyle/);
  assert.match(source, /measureAddMilkFlight/);
  assert.match(source, /createSelectorQuery/);
  assert.match(source, /playAddMilkAnimation/);
  assert.match(source, /clearAddMilkAnimation/);
  assert.match(source, /onMilkEntryInput/);
  assert.doesNotMatch(source, /loadRecentDefaults/);
  assert.doesNotMatch(source, /applyRecordDefaults/);

  assert.match(wxml, /本次记录/);
  assert.match(wxml, /配奶录入/);
  assert.match(wxml, /这次喝什么/);
  assert.match(wxml, /添加奶/);
  assert.doesNotMatch(wxml, /recent-default-row/);
  assert.doesNotMatch(wxml, /recentDefaultText/);
  assert.match(wxml, /showAddMilkPanel/);
  assert.match(wxml, /add-milk-dialog-mask/);
  assert.match(wxml, /add-milk-dialog-panel/);
  assert.match(wxml, /add-milk-dialog-header/);
  assert.match(wxml, /add-milk-dialog-close/);
  assert.match(wxml, /选择后会直接加入本次配奶/);
  assert.match(wxml, /flyMilkAnimation\.active/);
  assert.match(wxml, /milk-fly-ghost/);
  assert.match(wxml, /style="\{\{flyMilkAnimation\.style\}\}"/);
  assert.match(wxml, /milk-fly-content/);
  assert.match(wxml, /flyMilkAnimation\.badge/);
  assert.match(wxml, /add-milk-option-source/);
  assert.match(wxml, /data-index="\{\{index\}\}"/);
  assert.match(wxml, /营养预览/);
  assert.match(wxml, /碳水 g/);
  assert.match(wxml, /脂肪 g/);
  assert.doesNotMatch(wxml, /无蛋白热量/);
  assert.doesNotMatch(wxml, /膳食纤维/);
  assert.doesNotMatch(wxml, /奶量组件/);
  assert.doesNotMatch(wxml, /添加母乳/);
  assert.doesNotMatch(wxml, /添加配方粉/);
  assert.match(wxml, /保存/);
  assert.match(wxml, /category-badge/);
  assert.match(wxml, /style="\{\{breastMilkTag\.badgeStyle\}\}"/);
  assert.match(wxml, /style="\{\{formulaPowders\[item\.powderPickerIndex\]\.categoryBadgeStyle\}\}"/);
  assert.match(wxml, /style="\{\{item\.categoryBadgeStyle\}\}"/);
  assert.match(wxml, /查看剩余奶量/);
  assert.match(wxml, /bindtap="navigateToGoalPlanner"/);
  assert.doesNotMatch(wxml, /按 v2/);
  assert.match(wxml, /wx:for="\{\{milkEntries\}\}"/);
  assert.match(wxml, /class="page v2-page"/);
  assert.match(wxml, /info-card/);
  assert.match(wxml, /panel-header/);
  assert.match(wxml, /primary-card mix-card/);
  assert.match(wxml, /选择奶粉/);
  assert.match(wxml, /dual-field-group/);
  assert.match(wxml, /link-arrow/);
  assert.match(wxml, /footer-bar/);
  assert.doesNotMatch(wxml, /hero-card/);
  assert.doesNotMatch(wxml, /class="add-milk-panel"/);
  assert.doesNotMatch(wxml, /add-milk-dialog-actions/);
  assert.doesNotMatch(wxml, /dialog-action-btn/);
  assert.doesNotMatch(wxml, /confirmAddMilkEntries/);
  assert.doesNotMatch(wxml, /<text class="add-milk-confirm"/);

  assert.match(wxss, /\.v2-page/);
  assert.match(wxss, /\.page/);
  assert.match(wxss, /\.primary-card/);
  assert.match(wxss, /\.secondary-card/);
  assert.match(wxss, /\.panel-header/);
  assert.match(wxss, /\.milk-entry-card/);
  assert.match(wxss, /\.add-milk-button/);
  assert.match(wxss, /\.add-milk-dialog-mask/);
  assert.match(wxss, /\.add-milk-dialog-panel/);
  assert.match(wxss, /\.add-milk-dialog-header/);
  assert.match(wxss, /\.add-milk-dialog-close/);
  assert.doesNotMatch(wxss, /\.dialog-action-btn/);
  assert.match(wxss, /\.add-milk-option/);
  assert.match(wxss, /\.milk-fly-ghost/);
  assert.match(wxss, /\.milk-fly-content/);
  assert.doesNotMatch(wxss, /@keyframes\s+milkFlyPath/);
  assert.doesNotMatch(wxss, /@keyframes\s+milkFlyScale/);
  assert.doesNotMatch(wxss, /scale\(/);
  assert.doesNotMatch(wxss, /@keyframes\s+milkFlyToList/);
  assert.match(wxss, /@keyframes\s+milkRowArrive/);
  assert.match(wxss, /prefers-reduced-motion/);
  assert.match(wxss, /\.dual-field-row/);
  assert.match(wxss, /\.footer-bar/);
  assert.match(wxss, /\.preview-grid\s*\{[^}]*display:\s*grid/);
  assert.match(wxss, /\.preview-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(wxss, /\.v2-page\s*\{[^}]*width:\s*100%/);
  assert.match(wxss, /\.v2-page\s*\{[^}]*display:\s*block/);
  assert.doesNotMatch(wxss, /\.category-badge\.regular\s*\{/);
  assert.doesNotMatch(wxss, /\.category-badge\.special\s*\{/);
  assert.doesNotMatch(wxss, /\.category-badge\.energy\s*\{/);
});

test('onLoad reads active formula powders and basic info for v2 only', async () => {
  let profileOptions = null;
  let basicInfoOptions = null;
  const { pageConfig } = loadV2Page({
    getNutritionProfileSettings: async (babyUid, options) => {
      profileOptions = options;
      return {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      formulaPowders: [
        { id: 'archived', name: '停用粉', status: 'archived', category: 'regular_formula' },
        {
          id: 'energy-a',
          name: '无蛋白能量粉',
          status: 'active',
          category: 'energy_supplement',
          proteinRole: 'none',
          nutritionPer100g: { protein: 0, calories: 400 },
          mixRatio: { powder: 3, water: 20 }
        }
      ]
      };
    },
    resolveBasicInfoSnapshot: async (babyUid, date, options) => {
      basicInfoOptions = options;
      return {
        weight: 5.2,
        height: 58,
        naturalProteinCoefficient: 1.2,
        specialProteinCoefficient: '',
        calorieCoefficient: 100,
        source: 'v2_record'
      };
    }
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ date: '2026-05-20' });

  assert.equal(page.data.formulaPowders.length, 1);
  assert.equal(page.data.formulaPowders[0].id, 'energy-a');
  assert.equal(page.data.formulaPowders[0].categoryShortLabel, '能');
  assert.equal(page.data.weight, '5.2');
  assert.equal(page.data.calorieCoefficientInput, '100');
  assert.deepEqual(page.data.milkEntries, []);
  assert.deepEqual(profileOptions, { includeLegacyFallback: false });
  assert.deepEqual(basicInfoOptions, { includeFallbacks: false, includeProfileInitial: true, carryForwardMissing: true });
});

test('onLoad sets the navigation title from create or edit mode', async () => {
  const createContext = loadV2Page();
  const createPage = createPageInstance(createContext.pageConfig);
  await createPage.onLoad({ date: '2026-05-20' });
  assert.deepEqual(createContext.calls.titles[0], { title: '添加喂奶' });

  const editContext = loadV2Page({
    getRecordsByDate: async () => [
      {
        _id: 'v2-record-existing',
        date: '2026-05-20',
        startTime: '08:45',
        formulaComponents: [{ kind: 'breast_milk', volume: 70 }]
      }
    ]
  });
  const editPage = createPageInstance(editContext.pageConfig);
  await editPage.onLoad({ mode: 'edit', recordId: 'v2-record-existing', date: '2026-05-20' });
  assert.deepEqual(editContext.calls.titles[0], { title: '编辑喂奶' });
});

test('add milk dialog exposes a guide entry at the top-right under the close button', () => {
  const wxml = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.wxss', 'utf8');

  // 右上角“关闭”下一行的“去配奶粉”入口
  assert.match(wxml, /class="add-milk-dialog-manage"\s+bindtap="goToManagePowders"/);
  assert.match(wxml, /去配奶粉/);
  assert.match(wxss, /\.add-milk-dialog-corner\b/);
  assert.match(wxss, /\.add-milk-dialog-manage\b/);
  // 不再使用此前“+ 添加奶”下方的常驻入口与弹窗底部入口
  assert.doesNotMatch(wxml, /manage-powder-entry/);
  assert.doesNotMatch(wxml, /class="add-milk-manage"/);
});

test('goToManagePowders opens nutrition profile settings on the powders view', () => {
  const { pageConfig, calls } = loadV2Page();
  const page = createPageInstance(pageConfig);

  page.goToManagePowders();

  assert.equal(calls.navigatedUrl, '/pkg-milk/nutrition-profile-settings/index?view=powders');
  assert.equal(page._pendingPowderRefresh, true);
});

test('onShow refreshes formula powders without wiping the current milk entries', async () => {
  const { pageConfig } = loadV2Page({
    getNutritionProfileSettings: async () => ({
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      formulaPowders: [
        {
          id: 'special-a',
          name: '特奶 A',
          status: 'active',
          category: 'special_formula',
          proteinRole: 'special',
          nutritionPer100g: { protein: 12, calories: 400 },
          mixRatio: { powder: 6, water: 40 }
        }
      ]
    })
  });
  const page = createPageInstance(pageConfig, {
    babyUid: 'baby-1',
    formulaPowders: [],
    milkEntries: [{ localId: 'breast-1', kind: 'breast_milk', volume: '60' }]
  });
  page._pendingPowderRefresh = true;

  await page.onShow();

  assert.equal(page._pendingPowderRefresh, false);
  assert.equal(page.data.formulaPowders.length, 1);
  assert.equal(page.data.formulaPowders[0].id, 'special-a');
  assert.equal(page.data.milkEntries.length, 1);
  assert.equal(page.data.milkEntries[0].volume, '60');
});

test('navigateToGoalPlanner opens the standalone planner with date and edit context', () => {
  const { pageConfig, calls } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    selectedDate: '2026-05-20',
    editorMode: 'edit',
    editingRecordId: 'v2-record-existing'
  });
  page.navigateToGoalPlanner();

  assert.match(calls.navigatedUrl, /^\/pkg-milk\/milk-goal-planner-v2\/index\?/);
  assert.match(calls.navigatedUrl, /date=2026-05-20/);
  assert.match(calls.navigatedUrl, /recordId=v2-record-existing/);
});

test('standard editable formula row links water and powder by selected powder ratio', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    formulaPowders: [
      {
        id: 'regular-a',
        name: '普奶 A',
        category: 'regular_formula',
        proteinRole: 'natural',
        nutritionPer100g: {
          protein: 10,
          calories: 500
        },
        mixRatio: {
          powder: 5,
          water: 30
        }
      }
    ],
    milkEntries: [
      {
        localId: 'entry-1',
        kind: 'formula_powder',
        powderId: 'regular-a',
        waterVolume: '',
        powderWeight: '',
        ratioMode: 'standard',
        powderPickerIndex: 0
      }
    ]
  });

  page.onMilkEntryInput({
    currentTarget: {
      dataset: {
        index: 0,
        field: 'waterVolume'
      }
    },
    detail: {
      value: '60'
    }
  });

  assert.equal(page.data.milkEntries[0].waterVolume, '60');
  assert.equal(page.data.milkEntries[0].powderWeight, '10');

  page.onMilkEntryInput({
    currentTarget: {
      dataset: {
        index: 0,
        field: 'powderWeight'
      }
    },
    detail: {
      value: '5'
    }
  });

  assert.equal(page.data.milkEntries[0].powderWeight, '5');
  assert.equal(page.data.milkEntries[0].waterVolume, '30');
});

test('fly milk animation style starts at the selected option and translates directly to the item area', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig);

  const startStyle = page.buildFlyMilkStyle({
    fromX: 24,
    fromY: 120,
    toX: 224,
    toY: 40
  }, false);
  const movingStyle = page.buildFlyMilkStyle({
    fromX: 24,
    fromY: 120,
    toX: 224,
    toY: 40
  }, true);

  assert.match(startStyle, /left:\s*24px/);
  assert.match(startStyle, /top:\s*120px/);
  assert.match(startStyle, /transition:\s*none/);
  assert.match(startStyle, /opacity:\s*1/);
  assert.match(startStyle, /translate3d\(0px,\s*0px,\s*0\)/);
  assert.match(movingStyle, /translate3d\(200px,\s*-80px,\s*0\)/);
  assert.match(movingStyle, /opacity:\s*0/);
  assert.match(movingStyle, /transition:\s*transform 760ms cubic-bezier\(0\.55,\s*0,\s*1,\s*0\.45\), opacity 260ms ease-out 500ms/);
  assert.doesNotMatch(movingStyle, /scale\(/);
});

test('addMilkEntry opens the add milk dialog and immediately adds the selected formula powder', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    formulaPowders: [
      {
        id: 'regular-a',
        name: '普奶 A',
        category: 'regular_formula',
        categoryShortLabel: '普',
        categoryBadgeClass: 'regular',
        proteinRole: 'natural',
        nutritionPer100g: {
          protein: 10,
          calories: 500
        },
        mixRatio: {
          powder: 5,
          water: 30
        }
      }
    ]
  });

  page.addMilkEntry();

  assert.equal(page.data.showAddMilkPanel, true);
  assert.equal(page.data.milkEntries.length, 0);

  page.toggleAddMilkOption({
    currentTarget: {
      dataset: {
        key: 'powder:regular-a'
      }
    }
  });

  page.onMilkEntryInput({
    currentTarget: {
      dataset: {
        index: 0,
        field: 'waterVolume'
      }
    },
    detail: {
      value: '30'
    }
  });

  assert.equal(page.data.milkEntries.length, 1);
  assert.equal(page.data.milkEntries[0].powderId, 'regular-a');
  assert.equal(page.data.addMilkOptions[1].selected, true);
  assert.equal(page.data.showAddMilkPanel, true);
  assert.equal(page.data.flyMilkAnimation.active, true);
  assert.equal(page.data.flyMilkAnimation.badge, '普');
  assert.equal(page.data.flyMilkAnimation.label, '普奶 A');
  assert.equal(page.data.nutritionPreview.calories, 25);
  assert.equal(page.data.nutritionPreview.naturalProtein, 0.5);
});

test('addMilkEntry toggles milk choices directly in the dialog when there are multiple choices', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    formulaPowders: [
      {
        id: 'regular-a',
        name: '普奶 A',
        category: 'regular_formula',
        categoryShortLabel: '普',
        categoryBadgeClass: 'regular',
        proteinRole: 'natural',
        nutritionPer100g: { protein: 10, calories: 500 },
        mixRatio: { powder: 5, water: 30 }
      },
      {
        id: 'energy-a',
        name: '能量粉',
        category: 'energy_supplement',
        categoryShortLabel: '能',
        categoryBadgeClass: 'energy',
        proteinRole: 'none',
        nutritionPer100g: { protein: 0, calories: 300 },
        mixRatio: { powder: 3, water: 20 }
      }
    ],
    milkEntries: []
  });

  page.addMilkEntry({
    currentTarget: {
      dataset: {}
    }
  });

  assert.equal(page.data.milkEntries.length, 0);
  assert.equal(page.data.showAddMilkPanel, true);
  assert.equal(page.data.addMilkOptions.length, 3);

  page.toggleAddMilkOption({
    currentTarget: {
      dataset: {
        key: 'breast_milk'
      }
    }
  });
  page.toggleAddMilkOption({
    currentTarget: {
      dataset: {
        key: 'powder:energy-a'
      }
    }
  });

  assert.equal(page.data.showAddMilkPanel, true);
  assert.equal(page.data.milkEntries.length, 2);
  assert.equal(page.data.milkEntries[0].kind, 'breast_milk');
  assert.equal(page.data.milkEntries[1].powderId, 'energy-a');
  assert.equal(page.data.flyMilkAnimation.active, true);
  assert.equal(page.data.flyMilkAnimation.badge, '能');
  assert.equal(page.data.flyMilkAnimation.label, '能量粉');
  assert.equal(page.data.milkEntries[0].justAdded, true);

  page.toggleAddMilkOption({
    currentTarget: {
      dataset: {
        key: 'breast_milk'
      }
    }
  });

  assert.equal(page.data.milkEntries.length, 1);
  assert.equal(page.data.milkEntries[0].powderId, 'energy-a');
  assert.equal(page.data.addMilkOptions[0].selected, false);
});

test('add milk dialog orders formula choices by category', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    formulaPowders: [
      {
        id: 'energy-a',
        name: '能量粉',
        category: 'energy_supplement',
        categoryShortLabel: '能',
        categoryBadgeClass: 'energy',
        proteinRole: 'none',
        nutritionPer100g: { protein: 0, calories: 300 },
        mixRatio: { powder: 3, water: 20 }
      },
      {
        id: 'special-a',
        name: '特奶',
        category: 'special_formula',
        categoryShortLabel: '特',
        categoryBadgeClass: 'special',
        proteinRole: 'special',
        nutritionPer100g: { protein: 12, calories: 500 },
        mixRatio: { powder: 13.5, water: 90 }
      },
      {
        id: 'regular-a',
        name: '普奶 A',
        category: 'regular_formula',
        categoryShortLabel: '普',
        categoryBadgeClass: 'regular',
        proteinRole: 'natural',
        nutritionPer100g: { protein: 10, calories: 500 },
        mixRatio: { powder: 5, water: 30 }
      }
    ],
    milkEntries: []
  });

  page.addMilkEntry();

  assert.deepEqual(
    page.data.addMilkOptions.map((option) => option.key),
    ['breast_milk', 'powder:regular-a', 'powder:special-a', 'powder:energy-a']
  );
});

test('breast milk is optional and only contributes when added as a row', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67
    },
    milkEntries: []
  });

  assert.equal(page.buildCurrentComponents().length, 0);

  page.openAddMilkPanel();
  page.toggleAddMilkOption({
    currentTarget: {
      dataset: {
        key: 'breast_milk'
      }
    }
  });
  page.onBreastMilkEntryInput({
    currentTarget: {
      dataset: {
        index: 0
      }
    },
    detail: {
      value: '60'
    }
  });

  assert.equal(page.data.milkEntries[0].volume, '60');
  assert.equal(page.buildCurrentComponents().length, 1);
});

test('energy powder can be selected from the unified formula powder picker', () => {
  const { pageConfig } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    formulaPowders: [
      {
        powderId: 'regular-a',
        id: 'regular-a',
        name: '普奶 A',
        category: 'regular_formula',
        categoryShortLabel: '普',
        categoryBadgeClass: 'regular',
        proteinRole: 'natural',
        mixRatio: { powder: 5, water: 30 },
        nutritionPer100g: { protein: 10, calories: 500 }
      },
      {
        id: 'energy-a',
        name: '能量粉',
        category: 'energy_supplement',
        categoryShortLabel: '能',
        categoryBadgeClass: 'energy',
        proteinRole: 'none',
        mixRatio: { powder: 3, water: 20 },
        nutritionPer100g: { protein: 0, calories: 300 }
      }
    ],
    milkEntries: [
      {
        localId: 'entry-1',
        kind: 'formula_powder',
        powderId: 'regular-a',
        waterVolume: '20',
        powderWeight: '',
        ratioMode: 'standard',
        powderPickerIndex: 0
      }
    ]
  });

  page.onMilkEntryPickerChange({
    currentTarget: {
      dataset: {
        index: 0
      }
    },
    detail: {
      value: '1'
    }
  });

  assert.equal(page.data.milkEntries[0].powderId, 'energy-a');
  assert.equal(page.data.milkEntries[0].powderWeight, '3');
});

test('saveFeedingRecord validates at least one component before saving', async () => {
  const { pageConfig, calls } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    startTime: '08:30',
    milkEntries: []
  });

  await page.saveFeedingRecord();

  assert.equal(calls.saved, null);
  assert.match(calls.toasts[0].title, /至少记录一种奶/);
});

test('saveFeedingRecord writes nutrition snapshots to feeding_records_v2 model', async () => {
  const { pageConfig, calls } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    babyUid: 'baby-1',
    selectedDate: '2026-05-20',
    startTime: '08:30',
    endTime: '',
    weight: '5.2',
    height: '58',
    calorieCoefficientInput: '100',
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      natural_milk_fat: 4,
      natural_milk_carbs: 6.8
    },
    formulaPowders: [
      {
        id: 'energy-a',
        name: '无蛋白能量粉',
        category: 'energy_supplement',
        categoryShortLabel: '能',
        categoryBadgeClass: 'energy',
        proteinRole: 'none',
        mixRatio: { powder: 3, water: 20 },
        nutritionPer100g: { protein: 0, calories: 300, carbs: 75, fat: 0, fiber: 0 }
      }
    ],
    milkEntries: [
      {
        localId: 'breast-1',
        kind: 'breast_milk',
        volume: '60'
      },
      {
        localId: 'energy-a-1',
        kind: 'formula_powder',
        powderId: 'energy-a',
        waterVolume: 20,
        powderWeight: 3,
        ratioMode: 'standard',
        powderPickerIndex: 0
      }
    ]
  });

  await page.saveFeedingRecord();

  assert.equal(calls.saved.date, '2026-05-20');
  assert.equal(calls.saved.startTime, '08:30');
  assert.equal(calls.saved.formulaComponents.length, 2);
  assert.equal(calls.saved.formulaComponents[0].kind, 'breast_milk');
  assert.equal(calls.saved.formulaComponents[1].categoryShortLabel, '能');
  assert.equal(calls.saved.nutritionSummary.totalVolume, 80);
  assert.equal(calls.saved.nutritionSummary.zeroProteinCalories, 9);
  assert.equal(calls.saved.basicInfoSnapshot.weight, 5.2);
  assert.equal(calls.saved.basicInfoSnapshot.calorieCoefficient, 100);
  assert.deepEqual(calls.dirty, { babyUid: 'baby-1', date: '2026-05-20' });
});

test('saveFeedingRecord updates the selected v2 record in edit mode', async () => {
  const { pageConfig, calls } = loadV2Page();
  const page = createPageInstance(pageConfig, {
    babyUid: 'baby-1',
    selectedDate: '2026-05-20',
    startTime: '08:45',
    editorMode: 'edit',
    editingRecordId: 'v2-record-existing',
    nutritionSettings: {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      natural_milk_fat: 4,
      natural_milk_carbs: 6.8
    },
    milkEntries: [
      {
        localId: 'breast-1',
        kind: 'breast_milk',
        volume: '70'
      }
    ]
  });

  await page.saveFeedingRecord();

  assert.equal(calls.saved, null);
  assert.equal(calls.updated.recordId, 'v2-record-existing');
  assert.equal(calls.updated.data.date, '2026-05-20');
  assert.equal(calls.updated.data.startTime, '08:45');
  assert.equal(calls.updated.data.formulaComponents.length, 1);
  assert.equal(calls.updated.data.formulaComponents[0].kind, 'breast_milk');
  assert.equal(calls.updated.data.nutritionSummary.totalVolume, 70);
  assert.deepEqual(calls.dirty, { babyUid: 'baby-1', date: '2026-05-20' });
});

test('onLoad in edit mode loads the selected v2 record instead of recent defaults', async () => {
  const { pageConfig } = loadV2Page({
    getRecordsByDate: async () => [
      {
        _id: 'v2-record-existing',
        date: '2026-05-20',
        startTime: '08:45',
        endTime: '08:55',
        notes: '编辑这条',
        formulaComponents: [
          { kind: 'breast_milk', volume: 70 }
        ],
        basicInfoSnapshot: {
          weight: 5.4,
          height: 59,
          calorieCoefficient: 101
        },
        nutritionSummary: { calories: 47 },
        status: 'active'
      }
    ],
    getRecentRecord: async () => ({
      _id: 'recent-record',
      startTime: '07:00',
      formulaComponents: [
        { kind: 'breast_milk', volume: 30 }
      ]
    })
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ mode: 'edit', recordId: 'v2-record-existing', date: '2026-05-20' });

  assert.equal(page.data.editorMode, 'edit');
  assert.equal(page.data.editingRecordId, 'v2-record-existing');
  assert.equal(page.data.startTime, '08:45');
  assert.equal(page.data.endTime, '08:55');
  assert.equal(page.data.notes, '编辑这条');
  assert.equal(page.data.weight, '5.4');
  assert.equal(page.data.height, '59');
  assert.equal(page.data.calorieCoefficientInput, '101');
  assert.equal(page.data.milkEntries.length, 1);
  assert.equal(page.data.milkEntries[0].volume, '70');
  assert.equal(page.data.recentDefaultsLoaded, false);
});

test('onLoad keeps create mode blank even when the selected date has v2 records', async () => {
  const { pageConfig } = loadV2Page({
    getNutritionProfileSettings: async () => ({
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      formulaPowders: [
        {
          id: 'regular-a',
          name: '普奶 A',
          status: 'active',
          category: 'regular_formula',
          proteinRole: 'natural',
          nutritionPer100g: { protein: 10, calories: 500 },
          mixRatio: { powder: 5, water: 30 }
        },
        {
          id: 'special-a',
          name: '特奶 A',
          status: 'active',
          category: 'special_formula',
          proteinRole: 'special',
          nutritionPer100g: { protein: 12, calories: 400 },
          mixRatio: { powder: 6, water: 40 }
        }
      ]
    }),
    getRecordsByDate: async () => [
      {
        startTime: '07:20',
        formulaComponents: [
          { kind: 'breast_milk', volume: 55 },
          {
            kind: 'formula_powder',
            powderId: 'special-a',
            powderName: '特奶 A',
            category: 'special_formula',
            categoryShortLabel: '特',
            categoryBadgeClass: 'special',
            proteinRole: 'special',
            waterVolume: 40,
            powderWeight: 6,
            ratioMode: 'standard',
            mixRatioSnapshot: { powder: 6, water: 40 },
            nutritionSnapshot: { protein: 12, calories: 400 }
          }
        ],
        nutritionSummary: { calories: 60 },
        status: 'active'
      }
    ]
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ date: '2026-05-20' });

  assert.equal(page.data.recentDefaultsLoaded, false);
  assert.equal(page.data.recentDefaultText, '');
  assert.equal(page.data.milkEntries.length, 0);
});

test('onLoad does not fetch the latest previous v2 record as create-mode defaults', async () => {
  let recentRecordCalls = 0;
  const { pageConfig } = loadV2Page({
    getNutritionProfileSettings: async () => ({
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      formulaPowders: [
        {
          id: 'regular-a',
          name: '普奶 A',
          status: 'active',
          category: 'regular_formula',
          proteinRole: 'natural',
          nutritionPer100g: { protein: 10, calories: 500 },
          mixRatio: { powder: 5, water: 30 }
        }
      ]
    }),
    getRecordsByDate: async () => [],
    getRecentRecord: async () => {
      recentRecordCalls += 1;
      return {
        date: '2026-05-19',
        startTime: '22:10',
        formulaComponents: [
          {
            kind: 'formula_powder',
            powderId: 'regular-a',
            powderName: '普奶 A',
            category: 'regular_formula',
            categoryShortLabel: '普',
            categoryBadgeClass: 'regular',
            proteinRole: 'natural',
            waterVolume: 60,
            powderWeight: 10,
            ratioMode: 'standard',
            mixRatioSnapshot: { powder: 5, water: 30 },
            nutritionSnapshot: { protein: 10, calories: 500 }
          }
        ],
        nutritionSummary: { calories: 50 },
        status: 'active'
      };
    }
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ date: '2026-05-20' });

  assert.equal(recentRecordCalls, 0);
  assert.equal(page.data.recentDefaultsLoaded, false);
  assert.equal(page.data.recentDefaultText, '');
  assert.equal(page.data.milkEntries.length, 0);
});
