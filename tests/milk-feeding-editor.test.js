const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadMilkFeedingEditorPage(options = {}) {
  const pagePath = require.resolve('../miniprogram/pages/milk-feeding-editor/index.js');
  const nutritionPath = require.resolve('../miniprogram/models/nutrition.js');
  const storePath = require.resolve('../miniprogram/utils/feedingRecordStore.js');
  const utilsPath = require.resolve('../miniprogram/utils/index.js');
  const {
    nutritionOverrides = {},
    storeOverrides = {},
    utilsOverrides = {},
    wx = null,
    getAppReturn = { globalData: {} }
  } = options;

  delete require.cache[pagePath];
  delete require.cache[nutritionPath];
  delete require.cache[storePath];
  delete require.cache[utilsPath];

  let pageConfig = null;
  const previousPage = global.Page;
  const previousWx = global.wx;
  const previousGetApp = global.getApp;

  const defaultWx = {
    cloud: {
      database() {
        return {
          command: {
            gte: (value) => ({ $gte: value }),
            lt: (value) => ({ $lt: value }),
            push: (value) => value
          },
          serverDate() {
            return '__server_date__';
          },
          collection() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      limit() {
                        return {
                          get: async () => ({ data: [] })
                        };
                      }
                    };
                  },
                  get: async () => ({ data: [] })
                };
              },
              doc() {
                return {
                  update: async () => ({})
                };
              },
              add: async () => ({ _id: 'record-id' })
            };
          }
        };
      }
    },
    showToast() {},
    showModal() {},
    navigateTo() {},
    showLoading() {},
    hideLoading() {},
    navigateBack() {}
  };
  global.wx = wx || defaultWx;
  global.getApp = () => getAppReturn;

  const nutritionModule = require(nutritionPath);
  const storeModule = require(storePath);
  const utilsModule = require(utilsPath);
  const previousGetNutritionSettings = nutritionModule.getNutritionSettings;
  const previousCreateDefaultSettings = nutritionModule.createDefaultSettings;
  const previousFindOrCreateDailyRecord = storeModule.findOrCreateDailyRecord;
  const previousGetBabyUid = utilsModule.getBabyUid;

  nutritionModule.getNutritionSettings = nutritionOverrides.getNutritionSettings || nutritionModule.getNutritionSettings;
  nutritionModule.createDefaultSettings = nutritionOverrides.createDefaultSettings || nutritionModule.createDefaultSettings;
  storeModule.findOrCreateDailyRecord = storeOverrides.findOrCreateDailyRecord || storeModule.findOrCreateDailyRecord;
  utilsModule.getBabyUid = utilsOverrides.getBabyUid || utilsModule.getBabyUid;
  global.Page = (config) => {
    pageConfig = config;
  };

  require(pagePath);

  nutritionModule.getNutritionSettings = previousGetNutritionSettings;
  nutritionModule.createDefaultSettings = previousCreateDefaultSettings;
  storeModule.findOrCreateDailyRecord = previousFindOrCreateDailyRecord;
  utilsModule.getBabyUid = previousGetBabyUid;
  global.Page = previousPage;
  global.wx = previousWx;
  global.getApp = previousGetApp;
  return pageConfig;
}

function createPageInstance(page, overrides = {}) {
  const instance = {
    ...page,
    data: {
      ...JSON.parse(JSON.stringify(page.data)),
      ...overrides
    },
    setData(patch, callback) {
      this.data = {
        ...this.data,
        ...patch
      };
      if (callback) {
        callback();
      }
    }
  };
  return instance;
}

test('milk feeding editor page is registered with the expected files', () => {
  const appJson = fs.readFileSync('miniprogram/app.json', 'utf8');
  const pageJson = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.json', 'utf8');

  assert.match(appJson, /"pages\/milk-feeding-editor\/index"/);
  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor/index.js'));
  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor/index.wxml'));
  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor/index.wxss'));
  assert.ok(fs.existsSync('miniprogram/pages/milk-feeding-editor/index.json'));
  assert.match(pageJson, /"navigationBarTitleText": "添加奶"/);
});

test('milk feeding editor uses dual primary cards and unified mode copy without milk-presence toggles', () => {
  const source = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.wxss', 'utf8');

  assert.match(source, /formulaRatioMode:\s*'standard'/);
  assert.match(source, /specialRatioMode:\s*'standard'/);
  assert.match(source, /formulaLastEditedField:\s*'water'/);
  assert.match(source, /specialLastEditedField:\s*'water'/);
  assert.match(source, /breastVolumeDraft:\s*''/);
  assert.match(source, /formulaVolumeDraft:\s*''/);
  assert.match(source, /recentDefaultText:\s*''/);
  assert.match(source, /clearRecentDefaults\(/);
  assert.match(source, /onFormulaRatioModeChange\(/);
  assert.match(source, /onSpecialRatioModeChange\(/);
  assert.match(source, /calculateWaterFromPowder\(/);
  assert.doesNotMatch(source, /hasNaturalMilk:/);
  assert.doesNotMatch(source, /hasSpecialMilk:/);
  assert.doesNotMatch(source, /onNaturalToggle\(/);
  assert.doesNotMatch(source, /onSpecialToggle\(/);
  assert.doesNotMatch(source, /formulaCustomPowderEnabled/);
  assert.doesNotMatch(source, /specialCustomPowderEnabled/);

  assert.match(wxml, /primary-card/);
  assert.match(wxml, /secondary-card/);
  assert.match(wxml, /mode-segment/);
  assert.match(wxml, /mode-chip/);
  assert.match(wxml, /link-arrow/);
  assert.match(wxml, /link-arrow-text/);
  assert.match(wxml, /recent-default-row/);
  assert.match(wxml, /bindtap="clearRecentDefaults"/);
  assert.match(wxml, /class="link-arrow \{\{formulaRatioMode === 'standard' \? '' : 'link-arrow-hidden'\}\}"/);
  assert.match(wxml, /class="link-arrow \{\{specialRatioMode === 'standard' \? '' : 'link-arrow-hidden'\}\}"/);
  assert.match(wxml, /panel-title-wrap/);
  assert.match(wxml, /标准配比/);
  assert.match(wxml, /自定义配比/);
  assert.match(wxml, /天然蛋白/);
  assert.match(wxml, /母乳\/普奶/);
  assert.match(wxml, /特殊蛋白/);
  assert.match(wxml, />特奶</);
  assert.match(wxml, /\{\{nutritionPreview\.carbs \|\| 0\}\}/);
  assert.match(wxml, /碳水 g/);
  assert.match(wxml, /\{\{nutritionPreview\.fat \|\| 0\}\}/);
  assert.match(wxml, /脂肪 g/);
  assert.match(wxml, /type="number" value="\{\{naturalVolume\}\}"/);
  assert.match(wxml, /type="number" value="\{\{specialVolume\}\}"/);
  assert.match(wxml, /type="digit" value="\{\{formulaPowderWeight\}\}"/);
  assert.match(wxml, /type="digit" value="\{\{specialPowderWeight\}\}"/);
  assert.match(wxml, /bindtap="onFormulaRatioModeChange"/);
  assert.match(wxml, /bindtap="onSpecialRatioModeChange"/);
  assert.match(wxml, /dual-label-row/);
  assert.match(wxml, /dual-input-row/);
  assert.match(wxml, /dual-field-row/);
  assert.doesNotMatch(wxml, /模式/);
  assert.doesNotMatch(wxml, /自定义冲配/);
  assert.doesNotMatch(wxml, /本次有天然奶/);
  assert.doesNotMatch(wxml, /本次有特奶/);
  assert.doesNotMatch(wxml, /天然奶/);
  assert.doesNotMatch(wxml, /toggle-row/);
  assert.doesNotMatch(wxml, /radio-group/);
  assert.doesNotMatch(wxml, /手动改粉重/);
  assert.doesNotMatch(wxml, /恢复标准配比/);

  assert.match(wxss, /\.dual-input-row\s*\{[^}]*align-items:\s*center/);
  assert.match(wxss, /\.dual-label-block\s*\{[^}]*flex:\s*1/);
  assert.match(wxss, /\.link-arrow\s*\{[^}]*justify-content:\s*center/);
  assert.match(wxss, /\.link-arrow-hidden\s*\{[^}]*opacity:\s*0/);
  assert.doesNotMatch(wxss, /\.link-arrow\s*\{[^}]*align-self:\s*stretch/);
  assert.doesNotMatch(wxss, /\.link-arrow\s*\{[^}]*padding-top:\s*42rpx/);
});

test('milk feeding editor exposes a remaining-milk action above feeding cards and renders goal content in a dialog', () => {
  const source = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.js', 'utf8');
  const wxml = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.wxss', 'utf8');

  assert.match(source, /quickGoalTarget:\s*'protein'/);
  assert.match(source, /showGoalDialog:\s*false/);
  assert.match(source, /macroSummary:\s*createEmptyMacroSummary\(\)/);
  assert.match(source, /quickGoalSuggestion:\s*createEmptyGoalSuggestion\(\)/);
  assert.match(source, /naturalPowderWeight:\s*0/);
  assert.match(source, /specialPowderWeight:\s*0/);
  assert.match(source, /loadGoalContext\(/);
  assert.match(source, /updateGoalSuggestion\(/);
  assert.match(source, /openGoalDialog\(/);
  assert.match(source, /closeGoalDialog\(/);
  assert.match(source, /onGoalTargetChange\(/);
  assert.match(source, /onGoalCoefficientInput\(/);

  assert.match(wxml, /查看剩余奶量/);
  assert.match(wxml, /bindtap="openGoalDialog"/);
  assert.match(wxml, /goal-entry-card/);
  assert.match(wxml, /notes-card/);
  assert.match(wxml, /goal-dialog-mask/);
  assert.match(wxml, /goal-dialog-panel/);
  assert.match(wxml, /bindtap="closeGoalDialog"/);
  assert.match(wxml, /当前体重/);
  assert.match(wxml, /蛋白优先/);
  assert.match(wxml, /热量优先/);
  assert.match(wxml, /天然蛋白系数/);
  assert.match(wxml, /特殊蛋白系数/);
  assert.match(wxml, /热量系数/);
  assert.match(wxml, /goal-highlight-card/);
  assert.match(wxml, /goal-toolbar/);
  assert.match(wxml, /goal-weight-chip/);
  assert.match(wxml, /goal-controls-card/);
  assert.match(wxml, /goal-results-shell/);
  assert.match(wxml, /goal-plan-stack/);
  assert.match(wxml, /goal-weight-meta/);
  assert.match(wxml, /goal-highlight-main/);
  assert.match(wxml, /goal-suggestion-notes/);
  assert.match(wxml, /goal-suggestion-grid/);
  assert.match(wxml, /goal-suggestion-card/);
  assert.match(wxml, /goal-suggestion-main/);
  assert.match(wxml, /goal-suggestion-meta/);
  assert.match(wxml, /goal-plan-summary/);
  assert.match(wxml, /goal-plan-card/);
  assert.match(wxml, /goal-result-stack/);
  assert.match(wxml, /（粉重 .*g）/);
  assert.doesNotMatch(wxml, /距目标还差/);

  const infoCardIndex = wxml.indexOf('class="section-card secondary-card info-card"');
  const goalEntryIndex = wxml.indexOf('class="goal-entry-card"');
  const naturalCardIndex = wxml.indexOf('class="section-card primary-card natural-card"');
  const weightChipIndex = wxml.indexOf('class="goal-weight-chip"');
  const toolbarIndex = wxml.indexOf('class="goal-toolbar"');
  const controlsCardIndex = wxml.indexOf('class="goal-controls-card"');
  const resultShellIndex = wxml.indexOf('class="goal-results-shell"');
  assert.ok(infoCardIndex >= 0, 'info card should exist');
  assert.ok(goalEntryIndex > infoCardIndex, 'goal entry should be rendered after the info card');
  assert.ok(naturalCardIndex > goalEntryIndex, 'goal entry should be rendered before the feeding cards');
  assert.ok(weightChipIndex >= 0, 'weight chip should exist');
  assert.ok(toolbarIndex > weightChipIndex, 'weight chip should be rendered above the target switch');
  assert.ok(controlsCardIndex > toolbarIndex, 'goal controls should be rendered below the target switch');
  assert.ok(resultShellIndex > controlsCardIndex, 'goal results should be rendered below the controls');
  assert.doesNotMatch(wxml, /class="section-card secondary-card goal-card"/);

  assert.match(wxss, /\.goal-entry-card\s*\{/);
  assert.match(wxss, /\.goal-entry-button\s*\{/);
  assert.match(wxss, /\.page\s*\{[^}]*padding:\s*18rpx 18rpx 200rpx/);
  assert.match(wxss, /\.notes-card\s*\{/);
  assert.match(wxss, /\.goal-dialog-mask\s*\{/);
  assert.match(wxss, /\.goal-dialog-panel\s*\{/);
  assert.match(wxss, /\.footer-bar\s*\{[^}]*bottom:\s*36rpx/);
  assert.match(wxss, /\.footer-bar\s*\{[^}]*z-index:\s*20/);
  assert.match(wxss, /\.goal-toolbar\s*\{[^}]*width:\s*100%/);
  assert.match(wxss, /\.goal-weight-chip\s*\{[^}]*width:\s*100%/);
  assert.match(wxss, /\.goal-weight-chip\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(wxss, /\.goal-controls-card\s*\{/);
  assert.match(wxss, /\.goal-results-shell\s*\{/);
  assert.match(wxss, /\.goal-plan-stack\s*\{/);
  assert.match(wxss, /\.goal-highlight-main\s*\{/);
  assert.match(wxss, /\.goal-suggestion-notes\s*\{/);
  assert.match(wxss, /\.goal-target-switch\s*\{/);
  assert.match(wxss, /\.goal-target-option\.active\s*\{/);
  assert.match(wxss, /\.goal-highlight-card\s*\{/);
  assert.match(wxss, /\.goal-suggestion-card\s*\{/);
  assert.match(wxss, /\.goal-suggestion-main\s*\{/);
  assert.match(wxss, /\.goal-suggestion-meta\s*\{/);
  assert.match(wxss, /\.goal-plan-card\s*\{/);
  assert.doesNotMatch(wxss, /@media\s*\(max-width:\s*420px\)\s*\{[\s\S]*?\.goal-suggestion-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('milk feeding editor opens and closes the remaining-milk dialog', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    showGoalDialog: false
  });

  page.openGoalDialog.call(instance);
  assert.equal(instance.data.showGoalDialog, true);

  page.closeGoalDialog.call(instance);
  assert.equal(instance.data.showGoalDialog, false);
});

test('milk feeding editor standard formula mode syncs powder from water and water from powder', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    naturalMilkType: 'formula',
    calculation_params: {
      formula_milk_ratio: {
        powder: 5,
        water: 30
      },
      special_milk_ratio: {
        powder: 13.5,
        water: 90
      }
    },
    formulaRatioMode: 'standard',
    formulaLastEditedField: 'water',
    naturalVolume: '',
    formulaPowderWeight: ''
  });

  page.handleNaturalVolumeInput.call(instance, {
    detail: {
      value: '60'
    }
  });
  assert.equal(instance.data.naturalVolume, '60');
  assert.equal(instance.data.formulaPowderWeight, '10');
  assert.equal(instance.data.formulaLastEditedField, 'water');

  page.handleFormulaPowderInput.call(instance, {
    detail: {
      value: '7.5'
    }
  });
  assert.equal(instance.data.formulaPowderWeight, '7.5');
  assert.equal(instance.data.naturalVolume, '45');
  assert.equal(instance.data.formulaLastEditedField, 'powder');
});

test('milk feeding editor computes protein-priority goal suggestions from remaining daily gaps', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    weight: '4',
    quickGoalTarget: 'protein',
    naturalMilkType: 'breast',
    naturalProteinCoefficientInput: '1.5',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '110',
    macroSummary: {
      calories: 100,
      protein: 3,
      naturalProtein: 2,
      specialProtein: 1,
      carbs: 0,
      fat: 0
    },
    calculation_params: {
      natural_milk_protein: 1,
      natural_milk_calories: 67,
      special_milk_ratio: {
        powder: 10,
        water: 100
      },
      special_milk_protein: 10,
      special_milk_calories: 100
    }
  });

  page.updateGoalSuggestion.call(instance);

  assert.equal(instance.data.quickGoalSuggestion.ready, true);
  assert.equal(instance.data.quickGoalSuggestion.error, '');
  assert.equal(instance.data.quickGoalSuggestion.mode, 'protein');
  assert.equal(instance.data.quickGoalSuggestion.naturalProteinGap, 4);
  assert.equal(instance.data.quickGoalSuggestion.specialProteinGap, 1);
  assert.equal(instance.data.quickGoalSuggestion.naturalVolume, 400);
  assert.equal(instance.data.quickGoalSuggestion.specialVolume, 100);
  assert.equal(instance.data.quickGoalSuggestion.naturalPowderWeight, 0);
  assert.equal(instance.data.quickGoalSuggestion.specialPowderWeight, 10);
  assert.equal(instance.data.quickGoalSuggestion.predictedCalorieCoefficient, 94.5);
  assert.equal(instance.data.quickGoalSuggestion.predictedNaturalCoefficient, 1.5);
  assert.equal(instance.data.quickGoalSuggestion.predictedSpecialCoefficient, 0.5);
});

test('milk feeding editor computes formula and special powder weights for target suggestions', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    weight: '4',
    quickGoalTarget: 'protein',
    naturalMilkType: 'formula',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    macroSummary: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    },
    calculation_params: {
      formula_milk_ratio: {
        powder: 5,
        water: 30
      },
      formula_milk_protein: 10,
      formula_milk_calories: 100,
      special_milk_ratio: {
        powder: 10,
        water: 100
      },
      special_milk_protein: 10,
      special_milk_calories: 100
    }
  });

  page.updateGoalSuggestion.call(instance);

  assert.equal(instance.data.quickGoalSuggestion.naturalVolume, 240);
  assert.equal(instance.data.quickGoalSuggestion.naturalPowderWeight, 40);
  assert.equal(instance.data.quickGoalSuggestion.specialVolume, 200);
  assert.equal(instance.data.quickGoalSuggestion.specialPowderWeight, 20);
});

test('milk feeding editor computes calorie-priority plans with remaining protein target gaps', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    weight: '4',
    quickGoalTarget: 'calorie',
    naturalMilkType: 'breast',
    naturalProteinCoefficientInput: '1',
    specialProteinCoefficientInput: '0.5',
    calorieCoefficientInput: '100',
    macroSummary: {
      calories: 0,
      protein: 0,
      naturalProtein: 0,
      specialProtein: 0,
      carbs: 0,
      fat: 0
    },
    calculation_params: {
      natural_milk_protein: 1,
      natural_milk_calories: 100,
      special_milk_ratio: {
        powder: 10,
        water: 100
      },
      special_milk_protein: 10,
      special_milk_calories: 1000
    }
  });

  page.updateGoalSuggestion.call(instance);

  assert.equal(instance.data.quickGoalSuggestion.mode, 'calorie');
  assert.equal(instance.data.quickGoalSuggestion.calorieGap, 400);
  assert.equal(instance.data.quickGoalSuggestion.naturalPriorityPlan.naturalVolume, 400);
  assert.equal(instance.data.quickGoalSuggestion.naturalPriorityPlan.specialVolume, 0);
  assert.equal(instance.data.quickGoalSuggestion.naturalPriorityPlan.predictedNaturalCoefficient, 1);
  assert.equal(instance.data.quickGoalSuggestion.naturalPriorityPlan.predictedSpecialCoefficient, 0);
  assert.equal(instance.data.quickGoalSuggestion.naturalPriorityPlan.remainingNaturalCoefficientGap, 0);
  assert.equal(instance.data.quickGoalSuggestion.naturalPriorityPlan.remainingSpecialCoefficientGap, 0.5);
  assert.equal(instance.data.quickGoalSuggestion.specialPriorityPlan.naturalVolume, 200);
  assert.equal(instance.data.quickGoalSuggestion.specialPriorityPlan.specialVolume, 200);
  assert.equal(instance.data.quickGoalSuggestion.specialPriorityPlan.predictedNaturalCoefficient, 0.5);
  assert.equal(instance.data.quickGoalSuggestion.specialPriorityPlan.predictedSpecialCoefficient, 0.5);
  assert.equal(instance.data.quickGoalSuggestion.specialPriorityPlan.remainingNaturalCoefficientGap, 0.5);
  assert.equal(instance.data.quickGoalSuggestion.specialPriorityPlan.remainingSpecialCoefficientGap, 0);
});

test('milk feeding editor custom formula mode keeps water and powder independent and switching back to standard uses powder as the source of truth', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    naturalMilkType: 'formula',
    calculation_params: {
      formula_milk_ratio: {
        powder: 5,
        water: 30
      },
      special_milk_ratio: {
        powder: 13.5,
        water: 90
      }
    },
    formulaRatioMode: 'custom',
    formulaLastEditedField: 'water',
    naturalVolume: '40',
    formulaPowderWeight: '5'
  });

  page.handleNaturalVolumeInput.call(instance, {
    detail: {
      value: '50'
    }
  });
  assert.equal(instance.data.naturalVolume, '50');
  assert.equal(instance.data.formulaPowderWeight, '5');

  page.handleFormulaPowderInput.call(instance, {
    detail: {
      value: '6'
    }
  });
  assert.equal(instance.data.formulaPowderWeight, '6');
  assert.equal(instance.data.naturalVolume, '50');

  page.onFormulaRatioModeChange.call(instance, {
    detail: {
      value: 'standard'
    }
  });
  assert.equal(instance.data.formulaRatioMode, 'standard');
  assert.equal(instance.data.formulaPowderWeight, '6');
  assert.equal(instance.data.naturalVolume, '36');
  assert.equal(instance.data.formulaLastEditedField, 'powder');
});

test('milk feeding editor preserves natural breast and formula drafts when switching milk type', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    naturalMilkType: 'formula',
    naturalVolume: '50',
    breastVolumeDraft: '90',
    formulaVolumeDraft: '50',
    formulaPowderWeight: '6',
    formulaRatioMode: 'custom'
  });

  page.onNaturalMilkTypeChange.call(instance, {
    currentTarget: {
      dataset: {
        kind: 'breast'
      }
    }
  });
  assert.equal(instance.data.naturalMilkType, 'breast');
  assert.equal(instance.data.naturalVolume, '90');
  assert.equal(instance.data.formulaVolumeDraft, '50');
  assert.equal(instance.data.formulaPowderWeight, '6');

  page.handleNaturalVolumeInput.call(instance, {
    detail: {
      value: '95'
    }
  });
  assert.equal(instance.data.breastVolumeDraft, '95');

  page.onNaturalMilkTypeChange.call(instance, {
    currentTarget: {
      dataset: {
        kind: 'formula'
      }
    }
  });
  assert.equal(instance.data.naturalMilkType, 'formula');
  assert.equal(instance.data.naturalVolume, '50');
  assert.equal(instance.data.formulaPowderWeight, '6');
  assert.equal(instance.data.breastVolumeDraft, '95');
});

test('milk feeding editor normalizes decimal volume input to whole-number ml values', () => {
  const page = loadMilkFeedingEditorPage();
  const instance = createPageInstance(page, {
    naturalMilkType: 'breast',
    naturalVolume: '',
    breastVolumeDraft: ''
  });

  const naturalResult = page.handleNaturalVolumeInput.call(instance, {
    detail: {
      value: '45.5'
    }
  });
  assert.equal(naturalResult, '46');
  assert.equal(instance.data.naturalVolume, '46');
  assert.equal(instance.data.breastVolumeDraft, '46');

  const specialResult = page.handleSpecialVolumeInput.call(instance, {
    detail: {
      value: '30.25'
    }
  });
  assert.equal(specialResult, '30');
  assert.equal(instance.data.specialVolume, '30');
});

test('milk feeding editor exposes recent defaults hint and clear action resets carried-over values', async () => {
  const latestFeeding = {
    startTime: '08:30',
    naturalMilkType: 'formula',
    naturalMilkVolume: 60,
    formulaPowderWeight: 10,
    specialMilkVolume: 90,
    specialMilkPowder: 13.5,
    ratioMode: {
      natural: 'standard',
      special: 'custom'
    }
  };
  const page = loadMilkFeedingEditorPage({
    utilsOverrides: {
      getBabyUid: () => 'baby-1'
    },
    wx: {
      cloud: {
        database() {
          return {
            command: {
              gte: (value) => ({ $gte: value })
            },
            collection() {
              return {
                where() {
                  return {
                    orderBy() {
                      return {
                        limit() {
                          return {
                            get: async () => ({
                              data: [{
                                feedings: [latestFeeding]
                              }]
                            })
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      },
      showToast() {},
      showModal() {},
      navigateTo() {},
      showLoading() {},
      hideLoading() {},
      navigateBack() {}
    }
  });
  const wxMock = {
    cloud: {
      database() {
        return {
          command: {
            gte: (value) => ({ $gte: value })
          },
          collection() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      limit() {
                        return {
                          get: async () => ({
                            data: [{
                              feedings: [latestFeeding]
                            }]
                          })
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
    },
    showToast() {},
    showModal() {},
    navigateTo() {},
    showLoading() {},
    hideLoading() {},
    navigateBack() {}
  };
  const instance = createPageInstance(page, {
    calculation_params: {
      formula_milk_ratio: {
        powder: 5,
        water: 30
      },
      special_milk_ratio: {
        powder: 13.5,
        water: 90
      }
    }
  });
  const previousWx = global.wx;

  global.wx = wxMock;
  await page.loadRecentDefaults.call(instance);
  global.wx = previousWx;

  assert.equal(instance.data.recentDefaultsLoaded, true);
  assert.match(instance.data.recentDefaultText, /08:30/);
  assert.equal(instance.data.naturalMilkType, 'formula');
  assert.equal(instance.data.naturalVolume, '60');
  assert.equal(instance.data.specialVolume, '90');

  page.clearRecentDefaults.call(instance);
  assert.equal(instance.data.recentDefaultsLoaded, false);
  assert.equal(instance.data.recentDefaultText, '');
  assert.equal(instance.data.naturalMilkType, 'breast');
  assert.equal(instance.data.naturalVolume, '');
  assert.equal(instance.data.formulaPowderWeight, '');
  assert.equal(instance.data.specialVolume, '');
  assert.equal(instance.data.specialPowderWeight, '');
});

test('milk feeding editor saves whole-number milk volumes when decimal values are entered', async () => {
  let savedFeeding = null;
  const wxMock = {
    cloud: {
      database() {
        return {
          command: {
            push(value) {
              return value;
            }
          },
          serverDate() {
            return '__server_date__';
          },
          collection() {
            return {
              doc() {
                return {
                  update: async ({ data }) => {
                    savedFeeding = data.feedings;
                    return {};
                  }
                };
              }
            };
          }
        };
      }
    },
    showToast() {},
    showModal() {},
    navigateTo() {},
    showLoading() {},
    hideLoading() {},
    navigateBack() {}
  };
  const page = loadMilkFeedingEditorPage({
    storeOverrides: {
      findOrCreateDailyRecord: async () => ({ recordId: 'record-id' })
    },
    utilsOverrides: {
      getBabyUid: () => 'baby-1'
    },
    getAppReturn: {
      globalData: {
        weight: 4.2
      }
    }
  });
  const instance = createPageInstance(page, {
    recordTime: '08:15',
    naturalMilkType: 'breast',
    naturalVolume: '45.5',
    breastVolumeDraft: '45.5',
    specialVolume: '30.25',
    specialPowderWeight: '4.5',
    specialRatioMode: 'custom',
    calculation_params: {
      natural_milk_protein: 1.2,
      special_milk_protein: 10
    }
  });
  const previousWx = global.wx;

  global.wx = wxMock;
  page.handleNaturalVolumeInput.call(instance, {
    detail: {
      value: '45.5'
    }
  });
  page.handleSpecialVolumeInput.call(instance, {
    detail: {
      value: '30.25'
    }
  });
  await page.saveFeeding.call(instance);
  global.wx = previousWx;

  assert.ok(savedFeeding);
  assert.equal(savedFeeding.naturalMilkVolume, 46);
  assert.equal(savedFeeding.specialMilkVolume, 30);
  assert.equal(savedFeeding.totalVolume, 76);
});

test('milk feeding editor saves ratioMode using explicit standard/custom state per milk type', () => {
  const source = fs.readFileSync('miniprogram/pages/milk-feeding-editor/index.js', 'utf8');

  assert.match(source, /const hasFormulaMilk = this\.data\.naturalMilkType === 'formula'/);
  assert.match(source, /const hasSpecialMilk = specialVolumeNum > 0 \|\| specialPowderWeightNum > 0/);
  assert.doesNotMatch(source, /this\.data\.hasNaturalMilk/);
  assert.doesNotMatch(source, /this\.data\.hasSpecialMilk/);
  assert.match(source, /ratioMode:\s*\{/);
  assert.match(source, /this\.data\.formulaRatioMode/);
  assert.match(source, /this\.data\.specialRatioMode/);
  assert.match(source, /naturalMilkVolume:\s*\(hasBreastMilk \|\| hasFormulaMilk\) \? Math\.round\(naturalVolumeNum\) : 0/);
  assert.match(source, /formulaPowderWeight:\s*hasFormulaMilk/);
  assert.match(source, /specialMilkVolume:\s*hasSpecialMilk \? Math\.round\(specialVolumeNum\) : 0/);
  assert.match(source, /specialMilkPowder:\s*hasSpecialMilk/);
  assert.match(source, /totalVolume:\s*Math\.round\(naturalVolumeNum \+ specialVolumeNum\)/);
  assert.match(source, /findOrCreateDailyRecord/);
});
