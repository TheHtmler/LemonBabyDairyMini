const test = require('node:test');
const assert = require('node:assert/strict');

const { calculator, utils } = require('../miniprogram/utils/feedingUtils');

test('getSpecialMilkPowder prefers specialMilkPowder and rounds to 2 decimals', () => {
  assert.equal(
    calculator.getSpecialMilkPowder(
      {
        specialMilkPowder: 1.335,
        specialPowderWeight: 9.9,
        specialMilkVolume: 60
      },
      {
        special_milk_ratio: {
          powder: 13.5,
          water: 90
        }
      }
    ),
    1.34
  );
});

test('getSpecialMilkPowder falls back to specialPowderWeight, then volume ratio', () => {
  assert.equal(
    calculator.getSpecialMilkPowder(
      {
        specialPowderWeight: '2.26'
      },
      {
        special_milk_ratio: {
          powder: 13.5,
          water: 90
        }
      }
    ),
    2.26
  );

  assert.equal(
    calculator.getSpecialMilkPowder(
      {
        specialMilkVolume: 50
      },
      {
        special_milk_ratio: {
          powder: 13.5,
          water: 90
        }
      }
    ),
    7.5
  );
});

test('calculatePowderFromWater and calculateWaterFromPowder convert with the configured ratio', () => {
  assert.equal(
    calculator.calculatePowderFromWater(40, {
      powder: 5,
      water: 30
    }),
    6.67
  );

  assert.equal(
    calculator.calculateWaterFromPowder(5, {
      powder: 5,
      water: 30
    }),
    30
  );
});

test('getFormulaMilkPowder prefers explicit formulaPowderWeight over ratio-derived powder', () => {
  assert.equal(
    calculator.getFormulaMilkPowder(
      {
        naturalMilkType: 'formula',
        naturalMilkVolume: 40,
        formulaPowderWeight: 5
      },
      {
        formula_milk_ratio: {
          powder: 5,
          water: 30
        }
      }
    ),
    5
  );
});

test('getTotalVolume prefers natural and special milk fields over stored totalVolume', () => {
  assert.equal(
    calculator.getTotalVolume({
      naturalMilkVolume: '30',
      specialMilkVolume: '20',
      totalVolume: '999'
    }),
    50
  );
});

test('getSpecialMilkVolume falls back to totalVolume minus naturalMilkVolume for legacy records', () => {
  assert.equal(
    calculator.getSpecialMilkVolume({
      naturalMilkVolume: '45',
      totalVolume: '60'
    }),
    15
  );
});

test('validateFeedingData accepts special-only feeding and uses derived total volume', () => {
  assert.deepEqual(
    utils.validateFeedingData({
      naturalMilkVolume: '',
      specialMilkVolume: '30',
      totalVolume: ''
    }),
    {
      naturalMilk: 0,
      total: 30
    }
  );

  assert.deepEqual(
    utils.validateFeedingData({
      naturalMilkVolume: '30',
      specialMilkVolume: '20',
      totalVolume: '999'
    }),
    {
      naturalMilk: 30,
      total: 50
    }
  );
});

test('calculateFeedingMilkNutrition summarizes legacy breast and special milk feeding', () => {
  const summary = calculator.calculateFeedingMilkNutrition(
    {
      naturalMilkType: 'breast',
      naturalMilkVolume: 40,
      specialMilkVolume: 50,
      specialMilkPowder: 5
    },
    {
      natural_milk_protein: 1.1,
      natural_milk_calories: 67,
      special_milk_protein: 10,
      special_milk_calories: 500,
      special_milk_ratio: {
        powder: 10,
        water: 100
      }
    }
  );

  assert.equal(summary.totalVolume, 90);
  assert.equal(summary.totalPowderWeight, 5);
  assert.equal(summary.naturalProtein, 0.44);
  assert.equal(summary.specialProtein, 0.5);
  assert.equal(summary.protein, 0.94);
  assert.equal(summary.calories, 51.8);
});

test('calculateFeedingMilkNutrition summarizes legacy formula and special milk feeding', () => {
  const summary = calculator.calculateFeedingMilkNutrition(
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

  assert.equal(summary.totalVolume, 100);
  assert.equal(summary.totalPowderWeight, 15);
  assert.equal(summary.naturalProtein, 0.9);
  assert.equal(summary.specialProtein, 0.72);
  assert.equal(summary.protein, 1.62);
  assert.equal(summary.calories, 69);
});

test('calculateFeedingMilkNutrition summarizes new formulaComponents including zero-protein energy powder', () => {
  const summary = calculator.calculateFeedingMilkNutrition({
    formulaComponents: [
      {
        kind: 'breast_milk',
        volume: 40
      },
      {
        kind: 'formula_powder',
        powderName: '普奶A',
        proteinRole: 'natural',
        waterVolume: 30,
        powderWeight: 5,
        nutritionSnapshot: {
          protein: 10,
          calories: 500
        }
      },
      {
        kind: 'formula_powder',
        powderName: '特奶',
        proteinRole: 'special',
        waterVolume: 50,
        powderWeight: 5,
        nutritionSnapshot: {
          protein: 12,
          calories: 400
        }
      },
      {
        kind: 'formula_powder',
        powderName: '无蛋白能量粉',
        proteinRole: 'none',
        waterVolume: 20,
        powderWeight: 3,
        nutritionSnapshot: {
          protein: 0,
          calories: 300
        }
      }
    ]
  }, {
    natural_milk_protein: 1.1,
    natural_milk_calories: 67
  });

  assert.equal(summary.totalVolume, 140);
  assert.equal(summary.totalPowderWeight, 13);
  assert.equal(summary.naturalProtein, 0.94);
  assert.equal(summary.specialProtein, 0.6);
  assert.equal(summary.protein, 1.54);
  assert.equal(summary.zeroProteinCalories, 9);
  assert.equal(summary.calories, 80.8);
});
