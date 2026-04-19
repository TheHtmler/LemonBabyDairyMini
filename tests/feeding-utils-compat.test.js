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
