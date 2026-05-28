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
  const calls = {
    titles: [],
    toasts: [],
    navigatedBack: 0,
    applied: null
  };

  global.wx = {
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
    navigateBack() {
      calls.navigatedBack += 1;
    }
  };
  global.getApp = () => ({ globalData: { babyUid: 'baby-1' } });
  global.getCurrentPages = options.getCurrentPages || (() => [
    {
      route: 'pkg-milk/milk-feeding-editor-v2/index',
      applyGoalPlannerEntries(entries) {
        calls.applied = entries;
      }
    },
    { route: 'pkg-milk/milk-goal-planner-v2/index' }
  ]);

  const profileModel = require(profilePath);
  const feedingRecordV2Model = require(modelPath);
  const utilsModule = require(utilsPath);
  const previousGetNutritionProfileSettings = profileModel.getNutritionProfileSettings;
  const previousGetRecordsByDate = feedingRecordV2Model.getRecordsByDate;
  const previousResolveBasicInfoSnapshot = feedingRecordV2Model.resolveBasicInfoSnapshot;
  const previousGetBabyUid = utilsModule.getBabyUid;

  profileModel.getNutritionProfileSettings = options.getNutritionProfileSettings || (async () => ({ formulaPowders: [] }));
  feedingRecordV2Model.getRecordsByDate = options.getRecordsByDate || (async () => []);
  feedingRecordV2Model.resolveBasicInfoSnapshot = options.resolveBasicInfoSnapshot || (async () => ({
    weight: 5,
    naturalProteinCoefficient: 1,
    specialProteinCoefficient: 0.5,
    calorieCoefficient: 100
  }));
  utilsModule.getBabyUid = options.getBabyUid || (() => 'baby-1');

  let pageConfig = null;
  global.Page = (config) => {
    pageConfig = config;
  };
  require(pagePath);

  profileModel.getNutritionProfileSettings = previousGetNutritionProfileSettings;
  feedingRecordV2Model.getRecordsByDate = previousGetRecordsByDate;
  feedingRecordV2Model.resolveBasicInfoSnapshot = previousResolveBasicInfoSnapshot;
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
      id: 'regular-b',
      name: '普奶 B',
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

test('app registers milk goal planner v2 page', () => {
  const appConfig = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
  assert.ok(appConfigHasPage(appConfig, 'pkg-milk/milk-goal-planner-v2/index'));
});

test('milk goal planner v2 renders as a standalone cute planning page', () => {
  const wxml = fs.readFileSync('miniprogram/pkg-milk/milk-goal-planner-v2/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pkg-milk/milk-goal-planner-v2/index.wxss', 'utf8');
  const json = JSON.parse(fs.readFileSync('miniprogram/pkg-milk/milk-goal-planner-v2/index.json', 'utf8'));

  assert.equal(json.navigationBarTitleText, '剩余奶量规划');
  assert.match(wxml, /推荐这一顿/);
  assert.match(wxml, /按蛋白系数计算/);
  assert.match(wxml, /按热量计算/);
  assert.match(wxml, /天然蛋白系数/);
  assert.match(wxml, /特殊蛋白系数/);
  assert.match(wxml, /热量系数/);
  assert.match(wxml, /分配占比/);
  assert.match(wxml, /天然蛋白/);
  assert.match(wxml, /特殊蛋白/);
  assert.match(wxml, /能量补充/);
  assert.match(wxml, /应用到本次喂奶/);
  assert.match(wxml, /recommend-card/);
  assert.match(wxml, /查看计算依据/);
  assert.doesNotMatch(wxml, /goal-strip/);
  assert.doesNotMatch(wxml, /wx:for="\{\{planGroups\}\}"/);
  assert.doesNotMatch(wxml, /dialog|弹窗/);
  assert.match(wxss, /lemon-orbit/);
  assert.match(wxss, /planner-hero/);
});

test('milk goal planner seeds goals from previous editor and defaults to a positive formula recommendation', async () => {
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

  const recommended = page.data.planItems.find((item) => item.key === 'powder:regular-a');
  assert.ok(recommended, 'should choose a positive regular formula by default');
  assert.equal(recommended.powderWeight, 50);
  assert.equal(recommended.waterVolume, 300);
});

test('milk goal planner allocates protein gaps by selected source percentages', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    formulaPowders: pageConfig.enrichPlannerPowders(createPowders()),
    existingRecords: [],
    selectedKeys: ['powder:regular-a', 'powder:regular-b'],
    allocationWeights: {
      'powder:regular-a': 80,
      'powder:regular-b': 20
    }
  });

  page.rebuildPlan();

  const regularA = page.data.planItems.find((item) => item.key === 'powder:regular-a');
  const regularB = page.data.planItems.find((item) => item.key === 'powder:regular-b');

  assert.equal(regularA.allocationPercent, 80);
  assert.equal(regularA.powderWeight, 40);
  assert.equal(regularA.waterVolume, 240);
  assert.equal(regularA.naturalProtein, 4);
  assert.equal(regularB.allocationPercent, 20);
  assert.equal(regularB.powderWeight, 10);
  assert.equal(regularB.waterVolume, 60);
  assert.equal(regularB.naturalProtein, 1);
});

test('milk goal planner allocates calorie gaps by selected source percentages in calorie mode', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, {
    calculationMode: 'calorie',
    weight: '5',
    naturalProteinCoefficientInput: '',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '100',
    formulaPowders: pageConfig.enrichPlannerPowders(createPowders()),
    existingRecords: [],
    selectedKeys: ['powder:regular-a', 'powder:energy-a'],
    allocationWeights: {
      'powder:regular-a': 20,
      'powder:energy-a': 80
    }
  });

  page.rebuildPlan();

  const regularA = page.data.planItems.find((item) => item.key === 'powder:regular-a');
  const energyA = page.data.planItems.find((item) => item.key === 'powder:energy-a');

  assert.equal(regularA.allocationPercent, 20);
  assert.equal(regularA.powderWeight, 20);
  assert.equal(regularA.waterVolume, 120);
  assert.equal(regularA.calories, 100);
  assert.equal(energyA.allocationPercent, 80);
  assert.equal(energyA.powderWeight, 100);
  assert.equal(energyA.waterVolume, 666.67);
  assert.equal(energyA.calories, 400);
});

test('milk goal planner evenly splits selected natural and special powders by protein gap', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '100',
    formulaPowders: pageConfig.enrichPlannerPowders(createPowders()),
    existingRecords: []
  });

  page.setData({
    selectedKeys: ['powder:regular-a', 'powder:regular-b', 'powder:special-a', 'powder:special-b', 'powder:energy-a']
  });
  page.rebuildPlan();

  const regularItems = page.data.planItems.filter((item) => item.role === 'natural' && item.kind === 'formula_powder');
  const specialItems = page.data.planItems.filter((item) => item.role === 'special');
  const energyItem = page.data.planItems.find((item) => item.role === 'energy');

  assert.deepEqual(regularItems.map((item) => item.powderWeight), [25, 25]);
  assert.deepEqual(regularItems.map((item) => item.waterVolume), [150, 150]);
  assert.deepEqual(specialItems.map((item) => item.powderWeight), [6.25, 6.25]);
  assert.deepEqual(specialItems.map((item) => item.waterVolume), [62.5, 62.5]);
  assert.equal(energyItem, undefined);
});

test('milk goal planner redistributes remaining gap after one selected powder is manually edited', () => {
  const { pageConfig } = loadPlannerPage();
  const page = createPageInstance(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '',
    formulaPowders: pageConfig.enrichPlannerPowders(createPowders()),
    existingRecords: [],
    selectedKeys: ['powder:regular-a', 'powder:regular-b']
  });

  page.rebuildPlan();
  page.onPlanInput({
    currentTarget: { dataset: { key: 'powder:regular-a', field: 'powderWeight' } },
    detail: { value: '10' }
  });

  const regularA = page.data.planItems.find((item) => item.key === 'powder:regular-a');
  const regularB = page.data.planItems.find((item) => item.key === 'powder:regular-b');

  assert.equal(regularA.manual, true);
  assert.equal(regularA.powderWeight, 10);
  assert.equal(regularA.waterVolume, 60);
  assert.equal(regularB.powderWeight, 40);
  assert.equal(regularB.waterVolume, 240);
});

test('milk goal planner applies planned entries back to the v2 feeding editor', () => {
  const { pageConfig, calls } = loadPlannerPage();
  const page = createPageInstance(pageConfig, {
    calculationMode: 'protein',
    weight: '5',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '',
    calorieCoefficientInput: '',
    formulaPowders: pageConfig.enrichPlannerPowders(createPowders()),
    existingRecords: [],
    selectedKeys: ['powder:regular-a']
  });

  page.rebuildPlan();
  page.applyPlanToEditor();

  assert.equal(calls.applied.length, 1);
  assert.deepEqual(calls.applied[0], {
    kind: 'formula_powder',
    powderId: 'regular-a',
    waterVolume: 300,
    powderWeight: 50,
    ratioMode: 'standard'
  });
  assert.equal(calls.navigatedBack, 1);
});
