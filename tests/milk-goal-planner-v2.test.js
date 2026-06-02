const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function appConfigHasPage(appConfig, pagePath) {
  if ((appConfig.pages || []).includes(pagePath)) return true;
  return (appConfig.subPackages || appConfig.subpackages || []).some((pkg) => (
    (pkg.pages || []).some((page) => `${pkg.root}/${page}` === pagePath)
  ));
}

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

function createPageInstance(page, overrides = {}) {
  return {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data || {})),
      ...overrides
    },
    setData(patch, callback) {
      const nextData = { ...this.data };
      Object.entries(patch || {}).forEach(([key, value]) => {
        applyPath(nextData, key, value);
      });
      this.data = nextData;
      if (callback) callback();
    }
  };
}

function loadPlannerPage(options = {}) {
  const pagePath = require.resolve('../miniprogram/pkg-milk/milk-goal-planner-v2/index.js');
  const profilePath = require.resolve('../miniprogram/models/nutritionProfile.js');
  const modelPath = require.resolve('../miniprogram/models/feedingRecordV2.js');
  const utilsPath = require.resolve('../miniprogram/utils/index.js');
  delete require.cache[pagePath];
  delete require.cache[profilePath];
  delete require.cache[modelPath];
  delete require.cache[utilsPath];

  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  const previousGetCurrentPages = global.getCurrentPages;
  const storage = { ...(options.storage || {}) };
  const calls = {
    titles: [],
    toasts: [],
    modals: [],
    modalConfirm: options.modalConfirm !== false,
    navigatedBack: 0,
    growthUpserts: [],
    storage
  };

  global.wx = {
    getStorageSync(key) {
      return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : '';
    },
    setStorageSync(key, value) {
      storage[key] = value;
    },
    removeStorageSync(key) {
      delete storage[key];
    },
    cloud: {
      database() {
        return {
          command: { lt: (value) => ({ $lt: value }) },
          serverDate: () => new Date('2026-05-28T00:00:00Z'),
          collection() {
            return {
              where() { return this; },
              orderBy() { return this; },
              limit() { return this; },
              doc() { return this; },
              get: async () => ({ data: [] }),
              add: async () => ({ _id: 'created' }),
              update: async () => ({}),
              remove: async () => ({})
            };
          }
        };
      }
    },
    setNavigationBarTitle(payload) {
      calls.titles.push(payload);
    },
    showToast(payload) {
      calls.toasts.push(payload);
    },
    showModal(payload) {
      calls.modals.push(payload);
      if (payload && typeof payload.success === 'function') {
        payload.success({ confirm: calls.modalConfirm, cancel: !calls.modalConfirm });
      }
    },
    navigateBack() {
      calls.navigatedBack += 1;
    }
  };
  global.getApp = () => ({ globalData: { babyUid: 'baby-1', openid: 'openid-1' } });
  global.getCurrentPages = options.getCurrentPages || (() => [
    { route: 'pages/daily-feeding/index' },
    { route: 'pkg-milk/milk-goal-planner-v2/index' }
  ]);

  const dailySummaryModelPath = require.resolve('../miniprogram/models/dailySummaryV2.js');
  const dailyServicePath = require.resolve('../miniprogram/utils/dailyRecordV2Service.js');
  const treatmentModelPath = require.resolve('../miniprogram/models/treatmentRecord.js');
  const profileModel = require(profilePath);
  const feedingRecordV2Model = require(modelPath);
  const dailySummaryModel = require(dailySummaryModelPath);
  const dailyService = require(dailyServicePath);
  const treatmentModel = require(treatmentModelPath);
  const utilsModule = require(utilsPath);
  const previousGetNutritionProfileSettings = profileModel.getNutritionProfileSettings;
  const previousGetRecordsByDate = feedingRecordV2Model.getRecordsByDate;
  const previousGetRecentDayMealCount = feedingRecordV2Model.getRecentDayMealCount;
  const previousResolveBasicInfoSnapshot = feedingRecordV2Model.resolveBasicInfoSnapshot;
  const previousUpsertGrowthRecordForDate = feedingRecordV2Model.upsertGrowthRecordForDate;
  const previousMarkDirty = dailySummaryModel.markDirty;
  const previousLoadLegacyFood = dailyService.loadLegacyFoodIntakes;
  const previousFindTreatmentByDate = treatmentModel.findByDate;
  const previousGetBabyUid = utilsModule.getBabyUid;
  calls.summaryDirtyMarks = [];
  dailySummaryModel.markDirty = options.markDirty || (async (babyUid, date) => {
    calls.summaryDirtyMarks.push({ babyUid, date });
    return true;
  });

  profileModel.getNutritionProfileSettings = options.getNutritionProfileSettings || (async () => ({ formulaPowders: [] }));
  feedingRecordV2Model.getRecordsByDate = options.getRecordsByDate || (async () => []);
  feedingRecordV2Model.getRecentDayMealCount = options.getRecentDayMealCount || (async () => 0);
  feedingRecordV2Model.resolveBasicInfoSnapshot = options.resolveBasicInfoSnapshot || (async () => ({
    weight: 5,
    naturalProteinCoefficient: 1,
    specialProteinCoefficient: 0.5,
    calorieCoefficient: 100
  }));
  feedingRecordV2Model.upsertGrowthRecordForDate = options.upsertGrowthRecordForDate || (async (babyUid, date, growthData) => {
    calls.growthUpserts.push({ babyUid, date, growthData });
    return { recordId: 'growth-created' };
  });
  dailyService.loadLegacyFoodIntakes = options.findFoodByDate || (async () => []);
  treatmentModel.findByDate = options.findTreatmentByDate || (async () => ({ success: true, data: [] }));
  utilsModule.getBabyUid = options.getBabyUid || (() => 'baby-1');

  let pageConfig = null;
  global.Page = (config) => {
    pageConfig = config;
  };
  require(pagePath);

  profileModel.getNutritionProfileSettings = previousGetNutritionProfileSettings;
  feedingRecordV2Model.getRecordsByDate = previousGetRecordsByDate;
  feedingRecordV2Model.getRecentDayMealCount = previousGetRecentDayMealCount;
  feedingRecordV2Model.resolveBasicInfoSnapshot = previousResolveBasicInfoSnapshot;
  feedingRecordV2Model.upsertGrowthRecordForDate = previousUpsertGrowthRecordForDate;
  dailySummaryModel.markDirty = previousMarkDirty;
  dailyService.loadLegacyFoodIntakes = previousLoadLegacyFood;
  treatmentModel.findByDate = previousFindTreatmentByDate;
  utilsModule.getBabyUid = previousGetBabyUid;
  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;
  global.getCurrentPages = previousGetCurrentPages;

  return { pageConfig, calls };
}

function createPowders() {
  return [
    {
      id: 'regular-a',
      name: '普奶 A',
      category: 'regular_formula',
      proteinRole: 'natural',
      status: 'active',
      nutritionPer100g: { protein: 10, calories: 500, fat: 20, carbs: 55 },
      mixRatio: { powder: 5, water: 30 }
    },
    {
      id: 'special-a',
      name: '特奶 A',
      category: 'special_formula',
      proteinRole: 'special',
      status: 'active',
      nutritionPer100g: { protein: 20, calories: 400, fat: 12, carbs: 50 },
      mixRatio: { powder: 10, water: 100 }
    },
    {
      id: 'special-b',
      name: '特奶 B',
      category: 'special_formula',
      proteinRole: 'special',
      status: 'active',
      nutritionPer100g: { protein: 20, calories: 400, fat: 12, carbs: 50 },
      mixRatio: { powder: 10, water: 100 }
    },
    {
      id: 'energy-a',
      name: '能量粉',
      category: 'energy_supplement',
      proteinRole: 'none',
      status: 'active',
      nutritionPer100g: { protein: 0, calories: 400, fat: 0, carbs: 95 },
      mixRatio: { powder: 3, water: 20 }
    }
  ];
}

function breastSettings(overrides = {}) {
  return {
    natural_milk_protein: 1,
    natural_milk_calories: 100,
    ...overrides
  };
}

function plannerData(pageConfig, overrides = {}) {
  return {
    babyUid: 'baby-1',
    selectedDate: '2026-05-28',
    nutritionSettings: breastSettings(),
    formulaPowders: pageConfig.enrichPlannerPowders(createPowders()),
    existingRecords: [],
    fedMeals: 0,
    plannedMeals: 8,
    ...overrides
  };
}

test('app registers milk goal planner v2 page', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  assert.ok(appConfigHasPage(appConfig, 'pkg-milk/milk-goal-planner-v2/index'));
});

test('milk goal planner v2 renders a simple elderly-friendly recommendation page', () => {
  const wxml = fs.readFileSync('miniprogram/pkg-milk/milk-goal-planner-v2/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pkg-milk/milk-goal-planner-v2/index.wxss', 'utf8');
  const json = JSON.parse(fs.readFileSync('miniprogram/pkg-milk/milk-goal-planner-v2/index.json', 'utf8'));

  assert.equal(json.navigationBarTitleText, '剩余奶量推荐');
  assert.match(wxml, /今天还需补充/);
  assert.match(wxml, /按蛋白算/);
  assert.match(wxml, /按热量算/);
  assert.match(wxml, /分顿建议/);
  assert.match(wxml, /计算依据/);
  assert.match(wxml, /奶粉来源/);
  assert.match(wxml, /换一种/);
  // 顶部“更换奶粉”入口 + 奶粉选择弹窗，避免选择项埋在页面最下方
  assert.match(wxml, /更换奶粉/);
  assert.match(wxml, /openSourcePopup/);
  assert.match(wxml, /source-popup/);
  // 不再是“应用回写 + 分配占比 + 多选小队”的复杂模型
  assert.doesNotMatch(wxml, /应用到本次喂奶/);
  assert.doesNotMatch(wxml, /分配占比/);
  assert.doesNotMatch(wxml, /wx:for="\{\{planGroups\}\}"/);
  assert.match(wxss, /result-card/);
  assert.match(wxss, /mode-switch/);
});

test('protein mode splits natural and special gaps into milk volumes', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();

  assert.equal(page.data.result.ready, true);
  assert.equal(page.data.result.done, false);
  const breast = page.data.result.rows.find((row) => row.key === 'breast_milk');
  const special = page.data.result.rows.find((row) => row.key === 'powder:special-a');
  assert.equal(breast.volume, 500);
  assert.equal(special.volume, 125);
  assert.equal(special.powderWeight, 12.5);
  assert.equal(page.data.result.totalVolume, 625);
});

test('protein mode reports the resulting calorie coefficient of the plan', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();

  // 母乳 500ml=500kcal + 特奶 12.5g 粉=50kcal => 全天 550kcal，体重 5kg => 110 kcal/kg
  assert.ok(page.data.result.calorieEstimate);
  assert.equal(page.data.result.calorieEstimate.coefText, '110');
  assert.equal(page.data.result.calorieEstimate.totalText, '550 kcal');
  // 蛋白模式不反推蛋白系数
  assert.equal(page.data.result.proteinEstimate, null);
});

test('calorie mode reports the resulting natural and special protein coefficients', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '200',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();

  // 母乳 500ml=天然蛋白 5g；特奶 125g 粉=特殊蛋白 25g；体重 5kg
  assert.ok(page.data.result.proteinEstimate);
  assert.equal(page.data.result.proteinEstimate.naturalCoefText, '1');
  assert.equal(page.data.result.proteinEstimate.specialCoefText, '5');
  assert.equal(page.data.result.proteinEstimate.naturalText, '5 g');
  assert.equal(page.data.result.proteinEstimate.specialText, '25 g');
  // 热量模式不反推热量系数（热量系数本身是输入）
  assert.equal(page.data.result.calorieEstimate, null);
});

test('calorie mode keeps natural protein fixed then fills remaining calories with special', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '200',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();

  const breast = page.data.result.rows.find((row) => row.key === 'breast_milk');
  const special = page.data.result.rows.find((row) => row.key === 'powder:special-a');
  assert.equal(breast.volume, 500);
  assert.equal(breast.calories, 500);
  assert.equal(special.volume, 1250);
  assert.equal(special.powderWeight, 125);
});

test('calorie mode with special-first fixes special protein then fills remaining calories with breast milk', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    caloriePriority: 'special',
    weight: '5',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '1',
    calorieCoefficientInput: '200',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();

  const special = page.data.result.rows.find((row) => row.key === 'powder:special-a');
  const breast = page.data.result.rows.find((row) => row.key === 'breast_milk');
  // 特殊蛋白目标 5g：特奶 protein/100g=20 => 粉 25g（calories 400/100*25=100kcal），冲水 250ml
  assert.equal(special.powderWeight, 25);
  assert.equal(special.volume, 250);
  // 剩余热量 1000-100=900kcal，由母乳补：calories/100ml=100 => 900ml
  assert.equal(breast.volume, 900);
  assert.equal(breast.calories, 900);
});

test('calorie mode always lists 天然/特殊/能量 groups in order regardless of priority', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    caloriePriority: 'natural',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.6',
    calorieCoefficientInput: '200'
  }));
  page.rebuild();

  assert.deepEqual(page.data.sourceGroups.map((group) => group.key), ['natural', 'special', 'energy']);
  assert.deepEqual(page.data.sourceGroups.map((group) => group.label), ['天然蛋白来源', '特殊蛋白来源', '能量补充来源']);
  // 能量补充组默认是可选的
  assert.equal(page.data.sourceGroups.find((group) => group.key === 'energy').optional, true);

  page.switchCaloriePriority({ currentTarget: { dataset: { priority: 'special' } } });

  assert.equal(page.data.caloriePriority, 'special');
  // 切换优先级后分组顺序保持不变
  assert.deepEqual(page.data.sourceGroups.map((group) => group.key), ['natural', 'special', 'energy']);
  // 特殊优先下计算依据的次卡应是“特殊蛋白”
  assert.equal(page.data.detailCards[1].title, '特殊蛋白');
});

test('energy supplement group is not selected by default but the user can add and remove it', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    caloriePriority: 'natural',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '200',
    recentSourceKeys: ['powder:energy-a', 'breast_milk', 'powder:special-a']
  }));

  // 即便最近用过能量粉，默认也不选它。
  page.setDefaultSelections();
  assert.ok(!page.data.selectedKeys.includes('powder:energy-a'), 'energy should default to unselected');

  // 用户手动添加能量粉。
  page.tapSource({ currentTarget: { dataset: { key: 'powder:energy-a', group: 'energy' } } });
  assert.ok(page.data.selectedKeys.includes('powder:energy-a'), 'user can add energy');

  // 再次点击可取消（可选组允许清空）。
  page.tapSource({ currentTarget: { dataset: { key: 'powder:energy-a', group: 'energy' } } });
  assert.ok(!page.data.selectedKeys.includes('powder:energy-a'), 'user can remove energy back to none');
});

test('calculation basis counts food and treatment intake, not just milk', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '2',
    specialProteinCoefficientInput: '2',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a'],
    existingRecords: [
      { _id: 'm1', nutritionSummary: { naturalProtein: 3, specialProtein: 3, calories: 100 } }
    ],
    otherIntake: { naturalProtein: 2, specialProtein: 1, calories: 50 }
  }));

  const goal = page.computeGoalState();
  // 已摄入 = 奶 + 食物/治疗
  assert.equal(goal.consumed.naturalProtein, 5);
  assert.equal(goal.consumed.specialProtein, 4);
  assert.equal(goal.consumed.calories, 150);
  // 目标 5kg*2 = 10g，剩余应扣掉食物/治疗
  assert.equal(goal.remaining.naturalProtein, 5);
  assert.equal(goal.remaining.specialProtein, 6);
});

test('detail cards expose a milk/food/treatment breakdown of consumed intake', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '2',
    specialProteinCoefficientInput: '2',
    calorieCoefficientInput: '',
    existingRecords: [
      { _id: 'm1', nutritionSummary: { naturalProtein: 3, specialProtein: 3, calories: 100 } }
    ],
    otherIntake: {
      naturalProtein: 2,
      specialProtein: 1,
      calories: 80,
      food: { naturalProtein: 2, specialProtein: 1, calories: 30 },
      treatment: { naturalProtein: 0, specialProtein: 0, calories: 50 }
    }
  }));

  const cards = page.buildDetailCards();
  const naturalCard = cards.find((card) => card.key === 'natural');
  // 天然蛋白来自奶(3) + 食物(2)，无治疗蛋白，所以只列奶/食物
  assert.equal(naturalCard.consumedText, '5g');
  assert.equal(naturalCard.consumedBreakdownText, '奶 3g · 食物 2g');
});

test('calorie breakdown surfaces milk, food and treatment together', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '100',
    existingRecords: [
      { _id: 'm1', nutritionSummary: { naturalProtein: 0, specialProtein: 0, calories: 100 } }
    ],
    otherIntake: {
      naturalProtein: 0,
      specialProtein: 0,
      calories: 80,
      food: { naturalProtein: 0, specialProtein: 0, calories: 30 },
      treatment: { naturalProtein: 0, specialProtein: 0, calories: 50 }
    }
  }));

  const cards = page.buildDetailCards();
  const energyCard = cards.find((card) => card.key === 'energy');
  assert.equal(energyCard.consumedText, '180kcal');
  assert.equal(energyCard.consumedBreakdownText, '奶 100kcal · 食物 30kcal · 治疗 50kcal');
});

test('intake breakdown lists calories and protein per source for food and treatment', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '2',
    specialProteinCoefficientInput: '1',
    calorieCoefficientInput: '',
    existingRecords: [
      { _id: 'm1', nutritionSummary: { naturalProtein: 1.8, specialProtein: 0, protein: 1.8, calories: 70 } }
    ],
    otherIntake: {
      naturalProtein: 2,
      specialProtein: 0,
      calories: 80,
      food: { naturalProtein: 2, specialProtein: 0, protein: 2, calories: 30 },
      treatment: { naturalProtein: 0, specialProtein: 0, protein: 0.5, calories: 50 }
    }
  }));

  const breakdown = page.buildIntakeBreakdown();
  const food = breakdown.find((item) => item.label === '食物');
  const treatment = breakdown.find((item) => item.label === '治疗');
  const milk = breakdown.find((item) => item.label === '奶');

  assert.equal(milk.caloriesText, '70 kcal');
  assert.equal(milk.proteinText, '1.8 g');
  assert.equal(food.caloriesText, '30 kcal');
  assert.equal(food.proteinText, '2 g');
  assert.equal(treatment.caloriesText, '50 kcal');
  assert.equal(treatment.proteinText, '0.5 g');
});

test('intake breakdown omits sources with no calories and no protein', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '2',
    specialProteinCoefficientInput: '1',
    existingRecords: [
      { _id: 'm1', nutritionSummary: { naturalProtein: 1.8, specialProtein: 0, protein: 1.8, calories: 70 } }
    ],
    otherIntake: { naturalProtein: 0, specialProtein: 0, calories: 0 }
  }));

  const breakdown = page.buildIntakeBreakdown();
  assert.deepEqual(breakdown.map((item) => item.label), ['奶']);
});

test('change-powder popup opens and closes', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {}));

  assert.equal(page.data.showSourcePopup, false);
  page.openSourcePopup();
  assert.equal(page.data.showSourcePopup, true);
  page.closeSourcePopup();
  assert.equal(page.data.showSourcePopup, false);
});

test('rebuild exposes the currently selected source names for the change-powder entry', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();
  assert.match(page.data.selectedSourcesText, /母乳/);
  assert.match(page.data.selectedSourcesText, /特奶 A/);
});

test('loadPageData folds food and treatment intake into the consumed basis', async () => {
  const { pageConfig } = loadPlannerPage({
    findFoodByDate: async () => [
      { nutrition: { protein: 2, calories: 30 } }
    ],
    findTreatmentByDate: async () => ({
      success: true,
      data: [{ summary: { totalCalories: 25 } }]
    })
  });
  const page = createPageInstance(pageConfig, {});

  await page.onLoad({ date: '2026-05-28' });

  assert.equal(page.data.otherIntake.naturalProtein, 2);
  assert.equal(page.data.otherIntake.specialProtein, 0);
  assert.equal(page.data.otherIntake.calories, 55);

  const goal = page.computeGoalState();
  assert.equal(goal.consumed.naturalProtein, 2);
  assert.equal(goal.consumed.calories, 55);
});

test('reads food copied into legacy feeding_records.intakes (copy-to-today scenario)', async () => {
  // 模拟“从周日复制到周一”：食物落在旧 feeding_records.intakes，
  // 计算页必须读到它，否则已摄入蛋白会是 0。
  let askedFood = null;
  const { pageConfig } = loadPlannerPage({
    findFoodByDate: async (babyUid, date) => {
      askedFood = { babyUid, date };
      return [
        { type: 'food', nutrition: { protein: 3, naturalProtein: 3, specialProtein: 0, calories: 60 } }
      ];
    },
    getRecordsByDate: async () => [],
    resolveBasicInfoSnapshot: async () => ({
      weight: 5,
      naturalProteinCoefficient: 2,
      specialProteinCoefficient: 0,
      calorieCoefficient: ''
    })
  });
  const page = createPageInstance(pageConfig, {});

  await page.onLoad({ date: '2026-06-01' });

  // 按 (babyUid, date) 顺序查询旧版食物
  assert.deepEqual(askedFood, { babyUid: 'baby-1', date: '2026-06-01' });
  assert.equal(page.data.otherIntake.naturalProtein, 3);

  const goal = page.computeGoalState();
  assert.equal(goal.consumed.naturalProtein, 3);
  assert.equal(goal.targets.naturalProtein, 10);
  assert.equal(goal.remaining.naturalProtein, 7);
});

test('default planned meals follows the most recent day meal count', async () => {
  const { pageConfig } = loadPlannerPage({
    getRecentDayMealCount: async () => 7,
    getRecordsByDate: async () => []
  });
  const page = createPageInstance(pageConfig, {});

  await page.onLoad({ date: '2026-06-01' });

  assert.equal(page.data.plannedMeals, 7);
});

test('default planned meals clamps an unusually high recent count', async () => {
  const { pageConfig } = loadPlannerPage({
    getRecentDayMealCount: async () => 99,
    getRecordsByDate: async () => []
  });
  const page = createPageInstance(pageConfig, {});

  await page.onLoad({ date: '2026-06-01' });

  assert.equal(page.data.plannedMeals, 14);
});

test('default planned meals falls back to 8 when there is no feeding history', async () => {
  const { pageConfig } = loadPlannerPage({
    getRecentDayMealCount: async () => 0,
    getRecordsByDate: async () => []
  });
  const page = createPageInstance(pageConfig, {});

  await page.onLoad({ date: '2026-06-01' });

  assert.equal(page.data.plannedMeals, 8);
});

test('reaching the target shows a done state and no remaining volume', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a'],
    existingRecords: [{ nutritionSummary: { naturalProtein: 5, specialProtein: 2.5, calories: 0 } }]
  }));

  page.rebuild();

  assert.equal(page.data.result.done, true);
  assert.equal(page.data.result.rows.length, 0);
});

test('per-meal suggestion divides remaining volume by remaining meals', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a'],
    fedMeals: 0,
    plannedMeals: 8
  }));

  page.rebuild();

  assert.equal(page.data.perMeal.hasRemaining, true);
  assert.equal(page.data.perMeal.remainingMeals, 8);
  const breastMeal = page.data.perMeal.rows.find((row) => row.key === 'breast_milk');
  assert.equal(breastMeal.perVolumeText, '63 ml');
});

test('per-meal suggestion subtracts already-fed meals from planned meals', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a'],
    fedMeals: 3,
    plannedMeals: 8
  }));

  page.rebuild();

  assert.equal(page.data.perMeal.remainingMeals, 5);
});

test('changing planned meals updates the per-meal plan', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.rebuild();
  page.changePlannedMeals({ currentTarget: { dataset: { step: 1 } } });

  assert.equal(page.data.plannedMeals, 9);
  assert.equal(page.data.perMeal.remainingMeals, 9);
});

test('tapping a source replaces the selection in its group by default (single-select)', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.tapSource({ currentTarget: { dataset: { key: 'powder:special-b', group: 'special' } } });

  assert.ok(page.data.selectedKeys.includes('powder:special-b'));
  assert.ok(!page.data.selectedKeys.includes('powder:special-a'));
  assert.ok(page.data.selectedKeys.includes('breast_milk'));
});

test('multi-select keeps multiple sources in one group and splits the gap evenly', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    multiSelect: true,
    selectedKeys: ['breast_milk', 'powder:special-a']
  }));

  page.tapSource({ currentTarget: { dataset: { key: 'powder:special-b', group: 'special' } } });
  page.rebuild();

  const specialA = page.data.result.rows.find((row) => row.key === 'powder:special-a');
  const specialB = page.data.result.rows.find((row) => row.key === 'powder:special-b');
  assert.ok(specialA && specialB);
  assert.equal(specialA.powderWeight, 6.3);
  assert.equal(specialB.powderWeight, 6.3);
});

test('sources are always displayed in 母乳 → 普奶 → 特奶 → 能量粉 order regardless of stored order', () => {
  const { pageConfig } = loadPlannerPage();
  // 故意打乱：能量粉、特奶、普奶
  const scrambled = pageConfig.enrichPlannerPowders([
    { id: 'energy-a', name: '能量粉', category: 'energy_supplement', proteinRole: 'none', status: 'active', nutritionPer100g: { protein: 0, calories: 400 }, mixRatio: { powder: 3, water: 20 } },
    { id: 'special-a', name: '特奶 A', category: 'special_formula', proteinRole: 'special', status: 'active', nutritionPer100g: { protein: 20, calories: 400 }, mixRatio: { powder: 10, water: 100 } },
    { id: 'regular-a', name: '普奶 A', category: 'regular_formula', proteinRole: 'natural', status: 'active', nutritionPer100g: { protein: 10, calories: 500 }, mixRatio: { powder: 5, water: 30 } }
  ]);
  const page = createPageInstance(pageConfig, plannerData(pageConfig, { formulaPowders: scrambled }));

  const orderedKeys = page.getPlannerSources().map((source) => source.key);

  assert.deepEqual(orderedKeys, ['breast_milk', 'powder:regular-a', 'powder:special-a', 'powder:energy-a']);
});

test('calorie special-first result rows still display in 母乳 → 普奶 → 特奶 → 能量粉 order', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'calorie',
    caloriePriority: 'special',
    weight: '5',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '100',
    selectedKeys: ['breast_milk', 'powder:regular-a', 'powder:special-a', 'powder:energy-a']
  }));

  page.rebuild();

  // 即使「特殊优先」先按特奶定量，展示仍按统一顺序排列。
  const keys = page.data.result.rows.map((row) => row.key);
  assert.deepEqual(keys, ['breast_milk', 'powder:regular-a', 'powder:special-a', 'powder:energy-a']);
});

test('milk goal planner seeds goals from previous editor and recommends a regular formula by default', async () => {
  const powders = createPowders();
  const { pageConfig } = loadPlannerPage({
    getNutritionProfileSettings: async () => ({
      formulaPowders: powders,
      natural_milk_protein: '',
      natural_milk_calories: ''
    }),
    resolveBasicInfoSnapshot: async () => ({
      weight: '',
      naturalProteinCoefficient: '',
      specialProteinCoefficient: '',
      calorieCoefficient: ''
    }),
    getCurrentPages: () => [
      {
        route: 'pkg-milk/milk-feeding-editor-v2/index',
        data: {
          weight: '5',
          naturalProteinCoefficientInput: '1',
          specialProteinCoefficientInput: '0.5',
          calorieCoefficientInput: '100'
        }
      },
      { route: 'pkg-milk/milk-goal-planner-v2/index' }
    ]
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ date: '2026-05-28' });

  const recommended = page.data.result.rows.find((row) => row.key === 'powder:regular-a');
  assert.ok(recommended, 'should choose a positive regular formula by default');
  assert.equal(recommended.powderWeight, 50);
  assert.equal(recommended.volume, 300);
});

test('editing the weight confirms before syncing to the growth record', async () => {
  const { pageConfig, calls } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: ''
  }));

  page.beginEditWeight();
  page.onWeightDraftInput({ detail: { value: '6' } });
  await page.confirmWeightEdit();

  assert.equal(page.data.weight, '6');
  assert.equal(page.data.weightEditing, false);
  assert.equal(calls.modals.length, 1);
  assert.equal(calls.growthUpserts.length, 1);
  assert.equal(calls.growthUpserts[0].growthData.weight, 6);
});

test('cancelling the weight confirmation keeps the original weight and does not sync', async () => {
  const { pageConfig, calls } = loadPlannerPage({ modalConfirm: false });
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: ''
  }));

  page.beginEditWeight();
  page.onWeightDraftInput({ detail: { value: '6' } });
  await page.confirmWeightEdit();

  assert.equal(page.data.weight, '5');
  assert.equal(calls.growthUpserts.length, 0);
});

test('defaults to the most recently used source in each group instead of breast milk', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    recentSourceKeys: ['powder:special-b', 'powder:regular-a']
  }));

  page.setDefaultSelections();

  assert.ok(page.data.selectedKeys.includes('powder:regular-a'));
  assert.ok(page.data.selectedKeys.includes('powder:special-b'));
  assert.ok(!page.data.selectedKeys.includes('powder:special-a'));
  assert.ok(!page.data.selectedKeys.includes('breast_milk'));
});

test('a brand-new user with multiple sources and no history must choose manually', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    recentSourceKeys: []
  }));

  page.setDefaultSelections();

  assert.equal(page.data.selectedKeys.length, 0);
  assert.equal(page.data.result.hint, '请点右上角「更换奶粉」选择来源');
  assert.equal(page.data.expandedSourceGroup, 'natural');
});

test('collects recent source keys from existing records newest-first on load', async () => {
  const powders = createPowders();
  const { pageConfig } = loadPlannerPage({
    getNutritionProfileSettings: async () => ({ formulaPowders: powders, natural_milk_protein: 1, natural_milk_calories: 100 }),
    resolveBasicInfoSnapshot: async () => ({ weight: 5, naturalProteinCoefficient: 1, specialProteinCoefficient: 0.5, calorieCoefficient: 100 }),
    getRecordsByDate: async () => [
      { id: 'r2', formulaComponents: [{ kind: 'formula_powder', powderId: 'special-b' }], nutritionSummary: { naturalProtein: 0, specialProtein: 1, calories: 0 } },
      { id: 'r1', formulaComponents: [{ kind: 'breast_milk', volume: 60 }], nutritionSummary: { naturalProtein: 0.6, specialProtein: 0, calories: 0 } }
    ]
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ date: '2026-05-28' });

  assert.deepEqual(page.data.recentSourceKeys, ['powder:special-b', 'breast_milk']);
  assert.ok(page.data.selectedKeys.includes('powder:special-b'));
  assert.ok(page.data.selectedKeys.includes('breast_milk'));
});

test('editing a target coefficient saves locally and never writes the growth record', () => {
  const { pageConfig, calls } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1.3',
    specialProteinCoefficientInput: '0.6',
    calorieCoefficientInput: '110'
  }));

  page.onCoefficientBlur();

  assert.equal(calls.growthUpserts.length, 0);
  const saved = calls.storage['milk_goal_target_coef_baby-1'];
  assert.ok(saved, 'target coefficients should be persisted to local storage');
  assert.equal(saved.naturalProteinCoefficient, '1.3');
  assert.equal(saved.specialProteinCoefficient, '0.6');
  assert.equal(saved.calorieCoefficient, '110');
});

test('weight sync writes only the weight and no coefficient fields to the growth record', async () => {
  const { pageConfig, calls } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1.3',
    specialProteinCoefficientInput: '0.6',
    calorieCoefficientInput: '110'
  }));

  page.beginEditWeight();
  page.onWeightDraftInput({ detail: { value: '6' } });
  await page.confirmWeightEdit();

  assert.equal(calls.growthUpserts.length, 1);
  const growthData = calls.growthUpserts[0].growthData;
  assert.equal(growthData.weight, 6);
  assert.ok(!('naturalProteinCoefficient' in growthData));
  assert.ok(!('specialProteinCoefficient' in growthData));
  assert.ok(!('calorieCoefficient' in growthData));
});

test('changing weight marks the daily summary dirty so the records page rebuilds its cache', async () => {
  const { pageConfig, calls } = loadPlannerPage();
  const page = createPageInstance(pageConfig, plannerData(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: ''
  }));

  page.beginEditWeight();
  page.onWeightDraftInput({ detail: { value: '6' } });
  await page.confirmWeightEdit();

  assert.equal(calls.summaryDirtyMarks.length, 1);
  assert.equal(calls.summaryDirtyMarks[0].babyUid, 'baby-1');
  assert.equal(calls.summaryDirtyMarks[0].date, '2026-05-28');
});

test('locally saved target coefficients take precedence over the snapshot on load', async () => {
  const powders = createPowders();
  const { pageConfig } = loadPlannerPage({
    storage: {
      'milk_goal_target_coef_baby-1': {
        naturalProteinCoefficient: '1.4',
        specialProteinCoefficient: '0.7',
        calorieCoefficient: '120'
      }
    },
    getNutritionProfileSettings: async () => ({ formulaPowders: powders, natural_milk_protein: 1, natural_milk_calories: 100 }),
    resolveBasicInfoSnapshot: async () => ({ weight: 5, naturalProteinCoefficient: 1, specialProteinCoefficient: 0.5, calorieCoefficient: 100 })
  });
  const page = createPageInstance(pageConfig);

  await page.onLoad({ date: '2026-05-28' });

  assert.equal(page.data.naturalProteinCoefficientInput, '1.4');
  assert.equal(page.data.specialProteinCoefficientInput, '0.7');
  assert.equal(page.data.calorieCoefficientInput, '120');
});
