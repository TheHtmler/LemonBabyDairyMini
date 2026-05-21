const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLegacyFormulaPowders,
  normalizeFormulaPowders,
  normalizeMixingPlans,
  calculatePowderNutrition,
  calculateMixingPlanPreview,
  createFormulaComponentsFromLegacyFeeding,
  POWDER_CATEGORY_META,
  BREAST_MILK_TAG_META,
  MILK_CATEGORY_TAG_CONFIG,
  buildCategoryBadgeStyle
} = require('../miniprogram/utils/formulaPowderUtils');

test('createLegacyFormulaPowders converts legacy regular and special milk settings into powder profiles', () => {
  const profiles = createLegacyFormulaPowders({
    formula_milk_protein: 10.6,
    formula_milk_calories: 505,
    formula_milk_fat: 26,
    formula_milk_carbs: 55,
    formula_milk_fiber: 0,
    formula_milk_ratio: {
      powder: 4.5,
      water: 30
    },
    special_milk_protein: 12.5,
    special_milk_calories: 520,
    special_milk_ratio: {
      powder: 13.5,
      water: 90
    }
  });

  assert.equal(profiles.length, 2);
  assert.deepEqual(
    profiles.map((profile) => ({
      id: profile.id,
      category: profile.category,
      proteinRole: profile.proteinRole,
      source: profile.source
    })),
    [
      {
        id: 'legacy_regular_formula',
        category: 'regular_formula',
        proteinRole: 'natural',
        source: 'legacy'
      },
      {
        id: 'legacy_special_formula',
        category: 'special_formula',
        proteinRole: 'special',
        source: 'legacy'
      }
    ]
  );
  assert.deepEqual(profiles[0].mixRatio, { powder: 4.5, water: 30 });
  assert.equal(profiles[1].nutritionPer100g.protein, 12.5);
});

test('normalizeFormulaPowders keeps energy supplement as zero-protein calorie powder', () => {
  const profiles = normalizeFormulaPowders([
    {
      id: 'energy-1',
      name: '无蛋白能量粉',
      category: 'energy_supplement',
      proteinRole: 'none',
      nutritionPer100g: {
        protein: 0,
        calories: '400',
        carbs: '92'
      },
      mixRatio: {
        powder: '3',
        water: '20'
      }
    }
  ]);

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].category, 'energy_supplement');
  assert.equal(profiles[0].proteinRole, 'none');
  assert.equal(profiles[0].status, 'active');
  assert.equal(profiles[0].nutritionPer100g.protein, 0);
  assert.equal(profiles[0].nutritionPer100g.calories, 400);
  assert.deepEqual(profiles[0].mixRatio, { powder: 3, water: 20 });
});

test('POWDER_CATEGORY_META exposes reusable short labels for category badges', () => {
  assert.deepEqual(
    {
      regular: POWDER_CATEGORY_META.regular_formula.shortLabel,
      special: POWDER_CATEGORY_META.special_formula.shortLabel,
      energy: POWDER_CATEGORY_META.energy_supplement.shortLabel
    },
    {
      regular: '普',
      special: '特',
      energy: '能'
    }
  );
  assert.equal(POWDER_CATEGORY_META.regular_formula.badgeClass, 'regular');
  assert.equal(POWDER_CATEGORY_META.special_formula.badgeClass, 'special');
  assert.equal(POWDER_CATEGORY_META.energy_supplement.badgeClass, 'energy');
  assert.equal(BREAST_MILK_TAG_META.shortLabel, '母');
  assert.deepEqual(
    Object.keys(MILK_CATEGORY_TAG_CONFIG),
    ['breast_milk', 'regular_formula', 'special_formula', 'energy_supplement']
  );
  assert.deepEqual(POWDER_CATEGORY_META.regular_formula.colors, MILK_CATEGORY_TAG_CONFIG.regular_formula.colors);
  assert.equal(
    buildCategoryBadgeStyle(POWDER_CATEGORY_META.special_formula),
    'background: #EAF1FF; color: #4775C9; border-color: rgba(71, 117, 201, 0.24);'
  );
});

test('milk category tag config uses a mini-program compatible js module', () => {
  const source = require('node:fs').readFileSync('miniprogram/utils/formulaPowderUtils.js', 'utf8');

  assert.match(source, /require\('\.\.\/config\/milkCategoryTags'\)/);
  assert.doesNotMatch(source, /milkCategoryTags\.json/);
});

test('calculatePowderNutrition separates natural, special, and zero-protein calories', () => {
  const regular = calculatePowderNutrition(
    {
      proteinRole: 'natural',
      nutritionPer100g: {
        protein: 10,
        calories: 500,
        fat: 20,
        carbs: 50
      }
    },
    5
  );
  const special = calculatePowderNutrition(
    {
      proteinRole: 'special',
      nutritionPer100g: {
        protein: 12,
        calories: 400
      }
    },
    10
  );
  const energy = calculatePowderNutrition(
    {
      proteinRole: 'none',
      nutritionPer100g: {
        protein: 0,
        calories: 300,
        carbs: 75
      }
    },
    8
  );

  assert.equal(regular.naturalProtein, 0.5);
  assert.equal(regular.specialProtein, 0);
  assert.equal(regular.calories, 25);
  assert.equal(special.naturalProtein, 0);
  assert.equal(special.specialProtein, 1.2);
  assert.equal(energy.protein, 0);
  assert.equal(energy.zeroProteinCalories, 24);
});

test('calculateMixingPlanPreview aggregates breast milk and multiple formula powder roles', () => {
  const powders = normalizeFormulaPowders([
    {
      id: 'regular-a',
      name: '普奶A',
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
    },
    {
      id: 'special-a',
      name: '特奶',
      category: 'special_formula',
      proteinRole: 'special',
      nutritionPer100g: {
        protein: 12,
        calories: 400
      },
      mixRatio: {
        powder: 10,
        water: 100
      }
    },
    {
      id: 'energy-a',
      name: '无蛋白能量粉',
      category: 'energy_supplement',
      proteinRole: 'none',
      nutritionPer100g: {
        protein: 0,
        calories: 300
      },
      mixRatio: {
        powder: 3,
        water: 20
      }
    }
  ]);
  const preview = calculateMixingPlanPreview(
    {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67
    },
    powders,
    {
      components: [
        {
          kind: 'breast_milk',
          volume: 40
        },
        {
          kind: 'formula_powder',
          powderId: 'regular-a',
          waterVolume: 30,
          powderWeight: 5
        },
        {
          kind: 'formula_powder',
          powderId: 'special-a',
          waterVolume: 50,
          powderWeight: 5
        },
        {
          kind: 'formula_powder',
          powderId: 'energy-a',
          waterVolume: 20,
          powderWeight: 3
        }
      ]
    }
  );

  assert.equal(preview.totalVolume, 140);
  assert.equal(preview.totalPowderWeight, 13);
  assert.equal(preview.naturalProtein, 0.94);
  assert.equal(preview.specialProtein, 0.6);
  assert.equal(preview.zeroProteinCalories, 9);
  assert.equal(preview.calories, 80.8);
});

test('createFormulaComponentsFromLegacyFeeding converts old feeding fields into components', () => {
  const components = createFormulaComponentsFromLegacyFeeding(
    {
      naturalMilkType: 'formula',
      naturalMilkVolume: 60,
      formulaPowderWeight: 9,
      specialMilkVolume: 40,
      specialMilkPowder: 6
    },
    {
      formula_milk_protein: 10,
      formula_milk_calories: 500,
      formula_milk_ratio: {
        powder: 4.5,
        water: 30
      },
      special_milk_protein: 12,
      special_milk_calories: 400,
      special_milk_ratio: {
        powder: 13.5,
        water: 90
      }
    }
  );

  assert.equal(components.length, 2);
  assert.deepEqual(
    components.map((component) => ({
      kind: component.kind,
      powderName: component.powderName,
      proteinRole: component.proteinRole,
      waterVolume: component.waterVolume,
      powderWeight: component.powderWeight
    })),
    [
      {
        kind: 'formula_powder',
        powderName: '默认普通配方粉',
        proteinRole: 'natural',
        waterVolume: 60,
        powderWeight: 9
      },
      {
        kind: 'formula_powder',
        powderName: '默认特殊配方粉',
        proteinRole: 'special',
        waterVolume: 40,
        powderWeight: 6
      }
    ]
  );
});

test('normalizeMixingPlans drops components referencing unknown powder profiles', () => {
  const plans = normalizeMixingPlans(
    [
      {
        id: 'plan-1',
        name: '夜奶 120ml',
        components: [
          {
            kind: 'breast_milk',
            volume: '40'
          },
          {
            kind: 'formula_powder',
            powderId: 'known',
            waterVolume: '30',
            powderWeight: '4.5'
          },
          {
            kind: 'formula_powder',
            powderId: 'missing',
            waterVolume: '20',
            powderWeight: '3'
          }
        ]
      }
    ],
    [
      {
        id: 'known'
      }
    ]
  );

  assert.equal(plans.length, 1);
  assert.equal(plans[0].components.length, 2);
  assert.equal(plans[0].components[0].volume, 40);
  assert.equal(plans[0].components[1].powderWeight, 4.5);
});
