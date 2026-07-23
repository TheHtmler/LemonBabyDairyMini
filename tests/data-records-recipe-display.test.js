const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const pageJsPath = path.join(ROOT, 'miniprogram/pages/data-records-v2/index.js');
const pageWxmlPath = path.join(ROOT, 'miniprogram/pages/data-records-v2/index.wxml');

function loadRecipeDisplayHelpers() {
  const source = fs.readFileSync(pageJsPath, 'utf8');
  const match = source.match(
    /function isRecipeIntake[\s\S]*?(?=\nfunction groupFoodIntakesByMeal)/
  );
  assert.ok(match, 'data-records-v2 should define recipe display helpers');

  const context = {
    roundNumber(value, precision = 2) {
      const multiplier = Math.pow(10, precision);
      return Math.round((Number(value) || 0) * multiplier) / multiplier;
    }
  };
  vm.runInNewContext(
    `${match[0]}\nthis.helpers = { isRecipeIntake, buildRecipeIntakeDisplay };`,
    context
  );
  return context.helpers;
}

test('recipe display recognizes provenance and scales ingredient snapshots by eaten weight', () => {
  const { isRecipeIntake, buildRecipeIntakeDisplay } = loadRecipeDisplayHelpers();
  const intake = {
    _id: 'intake-1',
    sourceType: 'manual_food',
    nameSnapshot: '番茄炒蛋',
    quantity: 60,
    recipeSource: {
      recipeId: 'recipe-1',
      recipeName: '番茄炒蛋',
      yieldWeightG: 200,
      ingredientsSnapshot: [
        {
          foodName: '番茄',
          quantity: 100,
          unit: 'g',
          nutrition: {
            calories: 40,
            protein: 2,
            naturalProtein: 2,
            specialProtein: 0,
            fat: 0.4,
            carbs: 8,
            fiber: 2,
            sodium: 10
          }
        }
      ]
    }
  };

  assert.equal(isRecipeIntake(intake), true);
  assert.deepEqual(JSON.parse(JSON.stringify(buildRecipeIntakeDisplay(intake))), {
    isRecipe: true,
    recipeName: '番茄炒蛋',
    recipeSourceText: '来自食谱：番茄炒蛋',
    recipeExpanded: false,
    recipeIngredientRows: [
      {
        foodName: '番茄',
        quantity: 30,
        unit: 'g',
        quantityText: '30g',
        nutrition: {
          calories: 12,
          protein: 0.6,
          naturalProtein: 0.6,
          specialProtein: 0,
          fat: 0.12,
          carbs: 2.4,
          fiber: 0.6,
          sodium: 3
        }
      }
    ]
  });
});

test('recipe display also recognizes explicit recipe sourceType without a snapshot', () => {
  const { buildRecipeIntakeDisplay } = loadRecipeDisplayHelpers();
  assert.deepEqual(JSON.parse(JSON.stringify(buildRecipeIntakeDisplay({
    sourceType: 'recipe',
    nameSnapshot: '南瓜泥',
    quantity: 20
  }))), {
    isRecipe: true,
    recipeName: '南瓜泥',
    recipeSourceText: '来自食谱：南瓜泥',
    recipeExpanded: false,
    recipeIngredientRows: []
  });
});

test('history template renders recipe source and read-only ingredient rows', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
  assert.match(wxml, /recipe-source-text/);
  assert.match(wxml, /\{\{foodItem\.recipeSourceText\}\}/);
  assert.match(wxml, /toggleRecipeIngredients/);
  assert.match(wxml, /recipe-ingredient-row/);
  assert.match(wxml, /\{\{ingredient\.quantityText\}\}/);
});
