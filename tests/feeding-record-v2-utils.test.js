const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBreastMilkComponent,
  buildFormulaPowderComponent,
  buildNutritionSummary,
  normalizeFeedingRecordV2,
  estimatePreparedFinalVolume,
  scaleFormulaComponents,
  buildPartialIntakeSavePayload,
  formatPartialIntakeLabel
} = require('../miniprogram/utils/feedingRecordV2Utils');

test('buildBreastMilkComponent saves volume and a per-100ml nutrition snapshot', () => {
  const component = buildBreastMilkComponent(60, {
    natural_milk_protein: 1.1,
    natural_milk_calories: 67,
    natural_milk_fat: 4,
    natural_milk_carbs: 6.8,
    natural_milk_fiber: 0
  });

  assert.deepEqual(component, {
    kind: 'breast_milk',
    volume: 60,
    nutritionSnapshot: {
      protein: 1.1,
      calories: 67,
      fat: 4,
      carbs: 6.8,
      fiber: 0
    }
  });
});

test('buildFormulaPowderComponent saves formula profile, mix ratio, and category badge snapshot', () => {
  const component = buildFormulaPowderComponent(
    {
      id: 'regular-a',
      name: '普奶 A',
      category: 'regular_formula',
      proteinRole: 'natural',
      nutritionPer100g: {
        protein: 10.6,
        calories: 505,
        fat: 26,
        carbs: 55,
        fiber: 0
      },
      mixRatio: {
        powder: 4.5,
        water: 30
      }
    },
    {
      waterVolume: 30,
      powderWeight: 4.5,
      ratioMode: 'standard'
    }
  );

  assert.deepEqual(component, {
    kind: 'formula_powder',
    powderId: 'regular-a',
    powderName: '普奶 A',
    category: 'regular_formula',
    categoryShortLabel: '普',
    categoryBadgeClass: 'regular',
    categoryBadgeStyle: 'background: #EAF7D8; color: #5F8A1F; border-color: rgba(95, 138, 31, 0.24);',
    proteinRole: 'natural',
    sourceType: 'user',
    sourcePowderCode: '',
    waterVolume: 30,
    powderWeight: 4.5,
    ratioMode: 'standard',
    mixRatioSnapshot: {
      powder: 4.5,
      water: 30
    },
    nutritionSnapshot: {
      protein: 10.6,
      calories: 505,
      fat: 26,
      carbs: 55,
      fiber: 0
    }
  });
});

test('buildFormulaPowderComponent can calculate standard powder weight from water volume', () => {
  const component = buildFormulaPowderComponent(
    {
      id: 'energy-a',
      name: '无蛋白能量粉',
      category: 'energy_supplement',
      proteinRole: 'none',
      nutritionPer100g: {
        protein: 0,
        calories: 400,
        fat: 0,
        carbs: 92,
        fiber: 0
      },
      mixRatio: {
        powder: 3,
        water: 20
      }
    },
    {
      waterVolume: 40,
      ratioMode: 'standard'
    }
  );

  assert.equal(component.categoryShortLabel, '能');
  assert.equal(component.powderWeight, 6);
});

test('buildNutritionSummary aggregates breast milk, natural powder, special powder, and zero-protein calories', () => {
  const components = [
    buildBreastMilkComponent(60, {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      natural_milk_fat: 4,
      natural_milk_carbs: 6.8
    }),
    buildFormulaPowderComponent(
      {
        id: 'regular-a',
        name: '普奶 A',
        category: 'regular_formula',
        proteinRole: 'natural',
        nutritionPer100g: {
          protein: 10,
          calories: 500,
          fat: 20,
          carbs: 50
        },
        mixRatio: {
          powder: 5,
          water: 30
        }
      },
      { waterVolume: 30, powderWeight: 5 }
    ),
    buildFormulaPowderComponent(
      {
        id: 'special-a',
        name: '特奶',
        category: 'special_formula',
        proteinRole: 'special',
        nutritionPer100g: {
          protein: 12,
          calories: 400,
          fat: 10,
          carbs: 70
        },
        mixRatio: {
          powder: 6,
          water: 40
        }
      },
      { waterVolume: 40, powderWeight: 6 }
    ),
    buildFormulaPowderComponent(
      {
        id: 'energy-a',
        name: '无蛋白能量粉',
        category: 'energy_supplement',
        proteinRole: 'none',
        nutritionPer100g: {
          protein: 0,
          calories: 300,
          carbs: 75
        },
        mixRatio: {
          powder: 3,
          water: 20
        }
      },
      { waterVolume: 20, powderWeight: 3 }
    )
  ];

  const summary = buildNutritionSummary(components);

  assert.equal(summary.totalVolume, 150);
  assert.equal(summary.totalPowderWeight, 14);
  assert.equal(summary.naturalProtein, 1.16);
  assert.equal(summary.specialProtein, 0.72);
  assert.equal(summary.protein, 1.88);
  assert.equal(summary.zeroProteinCalories, 9);
  assert.equal(summary.calories, 98.2);
  assert.equal(summary.fat, 4);
  assert.equal(summary.carbs, 13.03);
});

test('normalizeFeedingRecordV2 keeps active records display-ready and hides archived records by default', () => {
  assert.equal(normalizeFeedingRecordV2({ status: 'archived' }), null);

  const normalized = normalizeFeedingRecordV2({
    _id: 'record-1',
    date: '2026-05-20',
    startTime: '08:30',
    formulaComponents: [
      {
        kind: 'breast_milk',
        volume: 60,
        nutritionSnapshot: {
          protein: 1.1,
          calories: 67
        }
      }
    ],
    nutritionSummary: {
      totalVolume: 60,
      calories: 40.2,
      protein: 0.66
    },
    status: 'active'
  });

  assert.equal(normalized.id, 'record-1');
  assert.equal(normalized.title, '08:30 喂奶');
  assert.equal(normalized.nutritionSummary.totalVolume, 60);
});

test('estimatePreparedFinalVolume sums breast volume and powder waterVolume', () => {
  const components = [
    { kind: 'breast_milk', volume: 0, nutritionSnapshot: {} },
    {
      kind: 'formula_powder',
      waterVolume: 130,
      powderWeight: 14.2,
      proteinRole: 'natural',
      nutritionSnapshot: { protein: 10, calories: 500, fat: 0, carbs: 0, fiber: 0 }
    },
    {
      kind: 'formula_powder',
      waterVolume: 0,
      powderWeight: 5.27,
      proteinRole: 'special',
      nutritionSnapshot: { protein: 0, calories: 400, fat: 0, carbs: 0, fiber: 0 }
    }
  ];
  assert.equal(estimatePreparedFinalVolume(components), 130);
});

test('scaleFormulaComponents scales water and powder by same ratio', () => {
  const scaled = scaleFormulaComponents(
    [{
      kind: 'formula_powder',
      waterVolume: 130,
      powderWeight: 14.2,
      proteinRole: 'natural',
      nutritionSnapshot: { protein: 10, calories: 500, fat: 0, carbs: 0, fiber: 0 }
    }],
    100 / 155
  );
  assert.equal(scaled[0].waterVolume, 83.87);
  assert.equal(scaled[0].powderWeight, 9.16);
});

test('buildPartialIntakeSavePayload uses bottle final volume as denominator', () => {
  const prepared = [{
    kind: 'formula_powder',
    powderName: '普奶',
    waterVolume: 130,
    powderWeight: 14.2,
    proteinRole: 'natural',
    nutritionSnapshot: { protein: 10.6, calories: 505, fat: 26, carbs: 55, fiber: 0 }
  }];
  const result = buildPartialIntakeSavePayload({
    preparedComponents: prepared,
    preparedFinalVolume: 155,
    leftoverVolume: 55
  });
  assert.equal(result.error, undefined);
  assert.equal(result.intakeRatio, 0.6452);
  assert.equal(result.consumedBottleVolume, 100);
  assert.equal(result.leftoverVolume, 55);
  assert.equal(result.preparedFinalVolume, 155);
  assert.equal(result.formulaComponents[0].powderWeight, 9.16);
  assert.equal(result.nutritionSummary.totalPowderWeight, 9.16);
});

test('buildPartialIntakeSavePayload omits partial fields when leftover is 0', () => {
  const prepared = [{
    kind: 'formula_powder',
    waterVolume: 130,
    powderWeight: 14.2,
    proteinRole: 'natural',
    nutritionSnapshot: { protein: 10, calories: 500, fat: 0, carbs: 0, fiber: 0 }
  }];
  const result = buildPartialIntakeSavePayload({
    preparedComponents: prepared,
    preparedFinalVolume: 155,
    leftoverVolume: 0
  });
  assert.equal(result.formulaComponents[0].powderWeight, 14.2);
  assert.equal(result.preparedComponents, undefined);
  assert.equal(result.leftoverVolume, undefined);
  assert.equal(result.intakeRatio, undefined);
  assert.equal(result.clearPartialIntakeFields, true);
});

test('buildPartialIntakeSavePayload rejects full bottle leftover', () => {
  const result = buildPartialIntakeSavePayload({
    preparedComponents: [{ kind: 'breast_milk', volume: 60, nutritionSnapshot: {} }],
    preparedFinalVolume: 60,
    leftoverVolume: 60
  });
  assert.equal(result.error, '还剩整瓶时请删除本顿或改剩余');
});

test('buildPartialIntakeSavePayload rejects leftover greater than final volume', () => {
  const result = buildPartialIntakeSavePayload({
    preparedComponents: [{ kind: 'breast_milk', volume: 60, nutritionSnapshot: {} }],
    preparedFinalVolume: 60,
    leftoverVolume: 61
  });
  assert.equal(result.error, '剩余不能大于冲后瓶内总量');
});

test('formatPartialIntakeLabel', () => {
  assert.equal(
    formatPartialIntakeLabel({ preparedFinalVolume: 155, leftoverVolume: 55, consumedBottleVolume: 100 }),
    '冲后 155 · 喝 100（剩 55）'
  );
  assert.equal(formatPartialIntakeLabel({ leftoverVolume: 0 }), '');
});
