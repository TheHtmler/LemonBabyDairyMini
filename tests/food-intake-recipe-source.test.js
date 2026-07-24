const test = require('node:test');
const assert = require('node:assert/strict');

function loadFoodIntakeModel() {
  const modulePath = '../miniprogram/models/foodIntakeRecord';
  delete require.cache[require.resolve(modulePath)];
  const previousWx = global.wx;
  global.wx = {
    cloud: {
      database() {
        return {
          collection() {
            return {};
          }
        };
      }
    }
  };

  try {
    return {
      model: require(modulePath),
      restore() {
        global.wx = previousWx;
        delete require.cache[require.resolve(modulePath)];
      }
    };
  } catch (error) {
    global.wx = previousWx;
    throw error;
  }
}

test('normalizeFoodIntakeRecord mounts normalized recipe provenance', () => {
  const { model, restore } = loadFoodIntakeModel();
  try {
    const normalized = model.normalizeFoodIntakeRecord({
      sourceType: 'recipe',
      foodName: '番茄炒蛋',
      foodSnapshot: {
        name: '番茄炒蛋',
        sourceType: 'system'
      },
      recipeSource: {
        recipeId: ' recipe-1 ',
        recipeName: ' 番茄炒蛋 ',
        yieldWeightG: '200',
        ingredientsSnapshot: [
          { foodName: '番茄', quantity: 100, unit: 'g' }
        ]
      }
    });

    assert.equal(normalized.sourceType, 'recipe');
    assert.deepEqual(normalized.recipeSource, {
      recipeId: 'recipe-1',
      recipeName: '番茄炒蛋',
      yieldWeightG: 200,
      batchWeightG: 200,
      intakeMode: 'grams',
      intakePercent: 0,
      ingredientsSnapshot: [
        { foodName: '番茄', quantity: 100, unit: 'g' }
      ]
    });
    assert.equal(Object.hasOwn(normalized.foodSnapshot, 'sourceType'), false);
  } finally {
    restore();
  }
});

test('normalizeRecipeSource rejects empty provenance and normalizes missing snapshots', () => {
  const { model, restore } = loadFoodIntakeModel();
  try {
    assert.equal(model.normalizeRecipeSource({}), null);
    assert.deepEqual(model.normalizeRecipeSource({
      recipeId: 'recipe-2',
      recipeName: '南瓜泥',
      yieldWeightG: 'bad'
    }), {
      recipeId: 'recipe-2',
      recipeName: '南瓜泥',
      yieldWeightG: 0,
      batchWeightG: 0,
      intakeMode: 'grams',
      intakePercent: 0,
      ingredientsSnapshot: []
    });
  } finally {
    restore();
  }
});
