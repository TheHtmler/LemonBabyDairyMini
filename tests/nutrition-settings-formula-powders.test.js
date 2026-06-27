const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createDbMock(overrides = {}) {
  const writes = {
    babyInfoUpdate: null,
    compatUpdate: null,
    compatAdd: null,
    profileUpdate: null,
    profileAdd: null
  };
  const babyInfoData = overrides.babyInfoData || [{ _id: 'baby-doc-1', babyUid: 'baby-1' }];
  const compatData = overrides.compatData || [];
  const profileData = overrides.profileData || [];

  const db = {
    command: {},
    serverDate() {
      return '__server_date__';
    },
    collection(name) {
      if (name === 'baby_info') {
        return {
          where() {
            return {
              get: async () => ({ data: babyInfoData })
            };
          },
          doc() {
            return {
              update: async ({ data }) => {
                writes.babyInfoUpdate = data;
                return {};
              }
            };
          }
        };
      }

      if (name === 'nutrition_settings') {
        return {
          where() {
            return {
              get: async () => ({ data: compatData })
            };
          },
          doc() {
            return {
              update: async ({ data }) => {
                writes.compatUpdate = data;
                return {};
              }
            };
          },
          add: async ({ data }) => {
            writes.compatAdd = data;
            return { _id: 'compat-doc-1' };
          }
        };
      }

      if (name === 'milk_nutrition_profiles') {
        return {
          where() {
            return {
              limit() {
                return this;
              },
              get: async () => ({ data: profileData })
            };
          },
          doc() {
            return {
              update: async ({ data }) => {
                writes.profileUpdate = data;
                return {};
              }
            };
          },
          add: async ({ data }) => {
            writes.profileAdd = data;
            return { _id: 'profile-doc-1' };
          }
        };
      }

      throw new Error(`unexpected collection: ${name}`);
    }
  };

  return { db, writes };
}

function loadNutritionModel(db) {
  const modulePath = require.resolve('../miniprogram/models/nutrition.js');
  const profilePath = require.resolve('../miniprogram/models/nutritionProfile.js');
  const previousWx = global.wx;
  delete require.cache[modulePath];
  delete require.cache[profilePath];
  global.wx = {
    cloud: {
      database() {
        return db;
      }
    }
  };
  const model = require(modulePath);
  global.wx = previousWx;
  return model;
}

function loadNutritionProfileSettingsPage(db) {
  const pagePath = require.resolve('../miniprogram/pkg-milk/nutrition-profile-settings/index.js');
  const nutritionPath = require.resolve('../miniprogram/models/nutrition.js');
  const profilePath = require.resolve('../miniprogram/models/nutritionProfile.js');
  delete require.cache[pagePath];
  delete require.cache[nutritionPath];
  delete require.cache[profilePath];

  const previousWx = global.wx;
  const previousGetApp = global.getApp;
  const previousPage = global.Page;
  let pageConfig = null;

  global.getApp = () => ({
    globalData: {
      babyUid: 'baby-1'
    }
  });
  global.Page = (config) => {
    pageConfig = config;
  };
  global.wx = {
    cloud: {
      database() {
        return db;
      }
    },
    getStorageSync() {
      return '';
    }
  };

  require(pagePath);

  global.wx = previousWx;
  global.getApp = previousGetApp;
  global.Page = previousPage;

  return pageConfig;
}

function createPageInstance(pageConfig) {
  return {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(update) {
      this.data = {
        ...this.data,
        ...update
      };
    }
  };
}

test('createDefaultSettings includes formula powder profile and mixing plan fields', () => {
  const { db } = createDbMock();
  const NutritionModel = loadNutritionModel(db);

  const settings = NutritionModel.createDefaultSettings();

  assert.deepEqual(settings.formulaPowders, []);
  assert.deepEqual(settings.mixingPlans, []);
  assert.equal(settings.activeMixingPlanId, '');
});

test('nutrition profile settings orders visible formula powders by category', () => {
  const { db } = createDbMock();
  const pageConfig = loadNutritionProfileSettingsPage(db);
  const page = createPageInstance(pageConfig);

  page.applySettings({
    formulaPowders: [
      {
        id: 'energy-1',
        name: '能量粉',
        category: 'energy_supplement',
        proteinRole: 'none',
        status: 'active'
      },
      {
        id: 'special-1',
        name: '特奶',
        category: 'special_formula',
        proteinRole: 'special',
        status: 'active'
      },
      {
        id: 'regular-1',
        name: '普奶 A',
        category: 'regular_formula',
        proteinRole: 'natural',
        status: 'active'
      },
      {
        id: 'regular-2',
        name: '普奶 B',
        category: 'regular_formula',
        proteinRole: 'natural',
        status: 'active'
      }
    ]
  });

  assert.deepEqual(
    page.data.visibleFormulaPowders.map((powder) => powder.id),
    ['regular-1', 'regular-2', 'special-1', 'energy-1']
  );
});

test('normalizeSettings preserves legacy fields and generates legacy formula powder profiles', () => {
  const { db } = createDbMock();
  const NutritionModel = loadNutritionModel(db);

  const settings = NutritionModel.normalizeSettings({
    formula_milk_protein: '10.6',
    formula_milk_calories: '505',
    formula_milk_ratio: {
      powder: '4.5',
      water: '30'
    },
    special_milk_protein: '12.5',
    special_milk_calories: '520',
    special_milk_ratio: {
      powder: '13.5',
      water: '90'
    }
  });

  assert.equal(settings.formula_milk_protein, '10.6');
  assert.equal(settings.special_milk_protein, '12.5');
  assert.equal(settings.formulaPowders.length, 2);
  assert.deepEqual(
    settings.formulaPowders.map((profile) => ({
      id: profile.id,
      category: profile.category,
      proteinRole: profile.proteinRole
    })),
    [
      {
        id: 'legacy_regular_formula',
        category: 'regular_formula',
        proteinRole: 'natural'
      },
      {
        id: 'legacy_special_formula',
        category: 'special_formula',
        proteinRole: 'special'
      }
    ]
  );
});

test('normalizeSettings keeps explicit formula powder profiles and normalizes mixing plans', () => {
  const { db } = createDbMock();
  const NutritionModel = loadNutritionModel(db);

  const settings = NutritionModel.normalizeSettings({
    activeMixingPlanId: 'plan-1',
    formulaPowders: [
      {
        id: 'energy-1',
        name: '无蛋白能量粉',
        category: 'energy_supplement',
        proteinRole: 'none',
        nutritionPer100g: {
          calories: '400'
        },
        mixRatio: {
          powder: '3',
          water: '20'
        }
      }
    ],
    mixingPlans: [
      {
        id: 'plan-1',
        name: '夜奶 120ml',
        components: [
          {
            kind: 'formula_powder',
            powderId: 'energy-1',
            waterVolume: '20',
            powderWeight: '3'
          },
          {
            kind: 'formula_powder',
            powderId: 'missing',
            waterVolume: '20',
            powderWeight: '3'
          }
        ]
      }
    ]
  });

  assert.equal(settings.activeMixingPlanId, 'plan-1');
  assert.equal(settings.formulaPowders.length, 1);
  assert.equal(settings.formulaPowders[0].proteinRole, 'none');
  assert.equal(settings.mixingPlans.length, 1);
  assert.equal(settings.mixingPlans[0].components.length, 1);
  assert.equal(settings.mixingPlans[0].components[0].powderId, 'energy-1');
});

test('nutrition profile settings v2 page exposes formula powder profiles without mixing plan UI', () => {
  const source = fs.readFileSync('miniprogram/pkg-milk/nutrition-profile-settings/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pkg-milk/nutrition-profile-settings/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pkg-milk/nutrition-profile-settings/index.wxss', 'utf8');

  assert.match(source, /activeView:\s*'mother'/);
  assert.match(source, /require\('\.\.\/\.\.\/models\/nutritionProfile'\)/);
  assert.match(source, /getNutritionProfileSettings\(babyUid,\s*\{\s*includeLegacyFallback:\s*false/s);
  assert.match(source, /updateNutritionProfileSettings\(babyUid,\s*newSettings\)/);
  assert.match(source, /POWDER_CATEGORY_META/);
  assert.doesNotMatch(source, /getNutritionSettings\(babyUid\)/);
  assert.doesNotMatch(source, /updateNutritionSettings\(babyUid,\s*newSettings\)/);
  assert.match(source, /showMotherSettings\(/);
  assert.match(source, /showPowderList\(/);
  assert.match(source, /showPowderModal:\s*false/);
  assert.match(source, /visibleFormulaPowders:\s*\[\]/);
  assert.match(source, /powderTypeIndex:\s*0/);
  assert.match(source, /onPowderTypePickerChange\(/);
  assert.match(source, /startAddPowder\(/);
  assert.match(source, /async\s+savePowderDraft\(/);
  assert.match(source, /validatePowderDraftRequired\(/);
  assert.match(source, /field:\s*'protein'/);
  assert.match(source, /field:\s*'calories'/);
  assert.match(source, /field:\s*'fat'/);
  assert.match(source, /field:\s*'carbs'/);
  assert.match(source, /field:\s*'ratioPowder'/);
  assert.match(source, /field:\s*'ratioWater'/);
  assert.match(source, /await\s+this\.saveSettings\(settings,\s*\{\s*stayOnPage:\s*true/);
  assert.match(source, /saveSettings\(newSettings,\s*options\s*=\s*\{\}\)/);
  assert.match(source, /cancelPowderDraft\(/);
  assert.match(source, /async\s+deletePowder\(/);
  assert.match(source, /wx\.showModal\(/);
  assert.match(source, /title:\s*'删除这个配方粉？'/);
  assert.match(source, /以后记录喂奶时，就不能再选择它了/);
  assert.match(source, /以前已经保存的喂奶记录还会保留/);
  assert.doesNotMatch(source, /营养快照/);
  assert.doesNotMatch(source, /回算/);
  assert.match(source, /confirmText:\s*'删除'/);
  assert.match(source, /toastTitle:\s*'配方粉已删除'/);
  assert.match(source, /status:\s*POWDER_STATUSES\.ARCHIVED/);
  assert.match(source, /status:\s*POWDER_STATUSES\.ACTIVE/);
  assert.match(source, /createdAt:\s*current\.createdAt\s*\|\|\s*now/);
  assert.match(source, /updatedAt:\s*now/);
  assert.match(source, /deletedAt:\s*null/);
  assert.match(source, /deletedAt:\s*now/);
  assert.match(source, /sortFormulaPowdersByCategory/);
  assert.match(source, /visibleFormulaPowders:\s*sortFormulaPowdersByCategory\(\s*powders\.filter\(\(powder\)\s*=>\s*powder\.status\s*===\s*POWDER_STATUSES\.ACTIVE\)/);
  assert.doesNotMatch(source, /enabled:\s*false/);
  assert.doesNotMatch(source, /enabled:\s*true/);
  assert.doesNotMatch(source, /settings\.formulaPowders\s*=\s*\(settings\.formulaPowders\s*\|\|\s*\)\.filter\(\(powder\)\s*=>\s*powder\.id\s*!==\s*id\)/);
  assert.doesNotMatch(source, /selectedPowderCategory/);
  assert.doesNotMatch(source, /onPowderCategoryFilter\(/);
  assert.doesNotMatch(source, /onPowderCategoryChange\(/);
  assert.doesNotMatch(source, /onPowderProteinRoleChange\(/);
  assert.doesNotMatch(source, /startAddPlan\(/);
  assert.doesNotMatch(source, /savePlanDraft\(/);
  assert.doesNotMatch(source, /showPlanEditor\(/);
  assert.doesNotMatch(source, /saveMotherSettings\(/);
  assert.doesNotMatch(source, /saveAllSettings\(/);

  assert.match(wxml, /配方粉档案/);
  assert.match(wxml, /wx:for="\{\{visibleFormulaPowders\}\}"/);
  assert.doesNotMatch(wxml, /wx:for="\{\{settings\.formulaPowders\}\}"/);
  assert.match(wxml, /class="tab-text">母乳<\/text>/);
  assert.match(wxml, /class="tab-text">配方粉<\/text>/);
  assert.match(wxml, /class="tab-panel" wx:if="\{\{activeView === 'mother'\}\}"/);
  assert.match(wxml, /class="tab-panel" wx:if="\{\{activeView === 'powders'\}\}"/);
  assert.match(wxml, /母乳参数/);
  assert.match(wxml, /母乳蛋白质浓度/);
  assert.match(wxml, /母乳脂肪/);
  assert.match(wxml, /母乳碳水/);
  assert.match(wxml, /母乳膳食纤维/);
  assert.match(wxml, /母乳热量/);
  assert.match(wxml, /natural_milk_fiber/);
  assert.match(wxml, /\+ 新增配方粉/);
  assert.match(wxml, /class="powder-modal"\s+wx:if="\{\{showPowderModal\}\}"/);
  assert.match(wxml, /modal-mask/);
  assert.match(wxml, /modal-panel/);
  assert.match(wxml, /modal-header/);
  assert.match(wxml, /modal-body/);
  assert.match(wxml, /modal-footer/);
  assert.match(wxml, /mode="selector"/);
  assert.match(wxml, /range="\{\{powderTypeOptions\}\}"/);
  assert.match(wxml, /range-key="label"/);
  assert.match(wxml, /bindchange="onPowderTypePickerChange"/);
  assert.match(wxml, /picker-field/);
  assert.match(wxml, /picker-value/);
  assert.match(wxml, /picker-desc/);
  assert.match(wxml, /field-label/);
  assert.match(wxml, /label-text/);
  assert.match(wxml, /required-star/);
  assert.match(wxml, /<text class="label-text">分类<\/text>/);
  assert.match(wxml, /选择分类后会自动匹配蛋白角色/);
  assert.doesNotMatch(wxml, /<text class="label-text">粉类<\/text>/);
  assert.doesNotMatch(wxml, /选择粉类后会自动匹配蛋白角色/);
  assert.match(wxml, /<text class="label-text">脂肪 g\/100g<\/text>\s*<text class="required-star">\*<\/text>/);
  assert.match(wxml, /<text class="label-text">碳水 g\/100g<\/text>\s*<text class="required-star">\*<\/text>/);
  assert.match(wxml, /placeholder-class="input-placeholder"/);
  assert.match(wxml, /placeholder="例如 10\.6"/);
  assert.match(wxml, /placeholder="例如 505"/);
  assert.match(wxml, /placeholder="例如 4\.5"/);
  assert.match(wxml, /placeholder="例如 30"/);
  assert.match(wxml, /营养参数/);
  assert.match(wxml, /膳食纤维 g\/100g/);
  assert.match(wxml, /冲配比/);
  assert.match(wxml, /冲配比粉量 g/);
  assert.match(wxml, /冲配比水量 ml/);
  assert.match(wxml, /取消/);
  assert.match(wxml, /保存设置/);
  assert.match(wxml, /class="button-group bottom-actions"\s+wx:if="\{\{activeView === 'mother'\}\}"/);
  assert.doesNotMatch(wxml, /保存母乳参数/);
  assert.doesNotMatch(wxml, /保存配方粉/);
  assert.doesNotMatch(wxml, /保存全部设置/);
  assert.match(wxml, /普通配方粉/);
  assert.match(wxml, /特殊配方粉/);
  assert.match(wxml, /能量补充粉/);
  assert.match(source, /无蛋白·计热量/);
  assert.match(wxml, /powder-card/);
  assert.match(wxml, /powder-info/);
  assert.match(wxml, /powder-title-block/);
  assert.match(wxml, /powder-name-row/);
  assert.match(wxml, /category-badge \{\{item\.categoryBadgeClass\}\}/);
  assert.match(wxml, /style="\{\{item\.categoryBadgeStyle\}\}"/);
  assert.match(wxml, /\{\{item\.categoryShortLabel\}\}/);
  assert.match(wxml, /powder-action-cluster/);
  assert.match(wxml, /icon-btn/);
  assert.match(wxml, /edit\.svg/);
  assert.match(wxml, /delete\.svg/);
  assert.match(wxml, /powder-metrics/);
  assert.match(wxml, /metric-grid/);
  assert.match(wxml, /metric-item/);
  assert.match(wxml, /脂肪/);
  assert.match(wxml, /碳水/);
  assert.match(wxml, /纤维/);
  assert.match(wxml, /冲配比/);
  assert.match(wxml, /preview-label/);
  assert.match(wxml, /preview-value/);
  assert.doesNotMatch(wxml, /powder-form-card/);
  assert.doesNotMatch(wxml, /wx:for="\{\{categoryTabs\}\}"/);
  assert.doesNotMatch(wxml, /onPowderCategoryFilter/);
  assert.doesNotMatch(wxml, /onPowderCategoryChange/);
  assert.doesNotMatch(wxml, /role-row/);
  assert.doesNotMatch(wxml, /onPowderProteinRoleChange/);
  assert.doesNotMatch(wxml, /modal-close/);
  assert.doesNotMatch(wxml, />×<\/button>/);
  assert.doesNotMatch(wxml, /class="tab-text">方案<\/text>/);
  assert.doesNotMatch(wxml, /常用配奶方案/);
  assert.doesNotMatch(wxml, /当前配奶设置/);
  assert.doesNotMatch(wxml, /当前配奶方式/);
  assert.doesNotMatch(wxml, /添加组成/);
  assert.doesNotMatch(wxml, /plan-editor-card/);
  assert.doesNotMatch(wxml, /activeView === 'planEditor'/);
  assert.doesNotMatch(wxml, /<text>普奶<\/text>\s*<\/view>\s*<view class="tab-item/);

  assert.match(wxss, /\.settings-card\s*\{/);
  assert.match(wxss, /\.powder-card\s*\{/);
  assert.match(wxss, /\.powder-info\s*\{[^}]*flex:\s*1/);
  assert.match(wxss, /\.powder-title-block\s*\{[^}]*min-width:\s*0/);
  assert.match(wxss, /\.powder-name-row\s*\{/);
  assert.match(wxss, /\.category-badge\s*\{/);
  assert.doesNotMatch(wxss, /\.category-badge\.regular\s*\{/);
  assert.doesNotMatch(wxss, /\.category-badge\.special\s*\{/);
  assert.doesNotMatch(wxss, /\.category-badge\.energy\s*\{/);
  assert.match(wxss, /\.powder-action-cluster\s*\{[^}]*width:\s*128rpx/);
  assert.match(wxss, /\.icon-btn\s*\{/);
  assert.match(wxss, /\.icon-btn\s*\{[^}]*min-width:\s*0/);
  assert.match(wxss, /\.action-icon\s*\{/);
  assert.match(wxss, /\.powder-metrics\s*\{/);
  assert.match(wxss, /\.metric-grid\s*\{/);
  assert.match(wxss, /\.metric-item\s*\{/);
  assert.match(wxss, /button::after\s*\{/);
  assert.match(wxss, /\.form-group\s*\{/);
  assert.match(wxss, /\.tabs\s*\{/);
  assert.match(wxss, /\.powder-tools\s*\{/);
  assert.match(wxss, /\.powder-modal\s*\{/);
  assert.match(wxss, /\.modal-mask\s*\{/);
  assert.match(wxss, /\.modal-panel\s*\{/);
  assert.match(wxss, /\.modal-header\s*\{/);
  assert.match(wxss, /\.modal-body\s*\{/);
  assert.match(wxss, /\.modal-footer\s*\{/);
  assert.match(wxss, /\.picker-field\s*\{/);
  assert.match(wxss, /\.picker-value\s*\{/);
  assert.match(wxss, /\.picker-desc\s*\{/);
  assert.match(wxss, /\.field-label\s*\{/);
  assert.match(wxss, /\.label-text\s*\{/);
  assert.match(wxss, /\.required-star\s*\{/);
  assert.match(wxss, /\.input-placeholder\s*\{/);
  assert.match(wxss, /\.cancel-btn\s*\{/);
  assert.match(wxss, /\.secondary-btn\s*\{/);
  assert.doesNotMatch(wxss, /\.modal-close\s*\{/);
  assert.doesNotMatch(wxss, /\.type-option\s*\{/);
  assert.doesNotMatch(wxss, /\.type-name\s*\{/);
  assert.doesNotMatch(wxss, /\.type-desc\s*\{/);
  assert.match(wxss, /\.tab-text\s*\{/);
  assert.match(wxss, /\.tab-panel\s*\{[^}]*width:\s*100%/);
  assert.match(wxss, /\.container\s*\{[^}]*display:\s*block/);
  assert.match(wxss, /height:\s*64rpx/);
  assert.doesNotMatch(wxss, /display:\s*grid/);
  assert.doesNotMatch(wxss, /text:first-child/);
  assert.doesNotMatch(wxss, /\bgap\s*:/);
});
