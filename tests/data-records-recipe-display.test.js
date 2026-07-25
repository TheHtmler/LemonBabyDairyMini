const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const pageJsPath = path.join(ROOT, 'miniprogram/pages/data-records-v2/index.js');
const pageWxmlPath = path.join(ROOT, 'miniprogram/pages/data-records-v2/index.wxml');
const foodRecordItemJsPath = path.join(ROOT, 'miniprogram/components/food-record-item/food-record-item.js');
const foodRecordItemWxmlPath = path.join(ROOT, 'miniprogram/components/food-record-item/food-record-item.wxml');

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
    sourceLabel: '食谱',
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
    sourceLabel: '食谱',
    recipeExpanded: false,
    recipeIngredientRows: []
  });
});

test('history template shows recipe ingredient toggle without redundant source text', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
  assert.doesNotMatch(wxml, /来自食谱|recipeSourceText/);
  assert.match(wxml, /查看原料/);
  assert.match(wxml, /header-action/);
  assert.match(wxml, /onRecipeHeaderAction/);
  assert.match(wxml, /recipe-ingredient-row/);
  assert.match(wxml, /\{\{ingredient\.quantityText\}\}/);
});

test('meal group card shows digest-style macros and premium protein under the grid', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
  const pageSource = fs.readFileSync(pageJsPath, 'utf8');
  assert.match(wxml, /meal-group-digest-grid/);
  assert.match(wxml, /meal-group-digest-num/);
  assert.match(wxml, /热量 kcal/);
  assert.match(wxml, /meal-group-digest-premium/);
  assert.match(wxml, /含优质蛋白 \{\{item\.summary\.premiumProteinText\}\}g/);
  assert.match(wxml, /wx:if="\{\{item\.summary\.showPremiumProtein\}\}"/);
  assert.doesNotMatch(wxml, /meal-group-summary-grid/);
  assert.match(pageSource, /group\.summary\.premiumProtein \+=/);
  assert.match(pageSource, /showPremiumProtein:\s*premiumProtein > 0/);
});

test('food record item shows recipe tag after name and header action on the right', () => {
  const componentSource = fs.readFileSync(foodRecordItemJsPath, 'utf8');
  const componentWxml = fs.readFileSync(foodRecordItemWxmlPath, 'utf8');
  assert.match(componentSource, /sourceTag:\s*'食谱'/);
  assert.match(componentSource, /sourceType === 'recipe'/);
  assert.match(componentSource, /headeraction/);
  assert.match(componentSource, /variant:\s*\{/);
  assert.match(componentWxml, /food-name-wrap/);
  assert.match(componentWxml, /food-source-tag/);
  assert.match(componentWxml, /food-quantity/);
  assert.match(componentWxml, /food-header-action/);
  assert.match(componentWxml, /variant === 'meal'/);
  assert.match(
    componentWxml,
    /food-name[\s\S]*food-source-tag[\s\S]*food-quantity[\s\S]*food-header-action/
  );
  assert.doesNotMatch(componentWxml, /food-quantity-row/);
});

test('meal group expand uses animated panel and meal item variant', () => {
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8');
  const wxss = fs.readFileSync(path.join(ROOT, 'miniprogram/pages/data-records-v2/index.wxss'), 'utf8');
  assert.match(wxml, /meal-group-items \{\{item\.expanded \? 'is-open' : ''\}\}/);
  assert.match(wxml, /meal-group-toggle \{\{item\.expanded \? 'is-open' : ''\}\}/);
  assert.match(wxml, /variant="meal"/);
  assert.match(wxml, /meal-group-item/);
  assert.match(wxss, /\.meal-group-items\.is-open/);
  assert.match(wxss, /max-height:\s*0/);
  assert.match(wxss, /transition:/);
});

test('food record item shows premium protein metric only when value is positive', () => {
  const componentSource = fs.readFileSync(foodRecordItemJsPath, 'utf8');
  assert.match(componentSource, /resolveFoodIntakePremiumProteinSplit/);
  assert.match(componentSource, /含优质蛋白/);
  assert.match(componentSource, /premiumProtein > 0/);
  assert.match(componentSource, /碳水 \$\{nutrition\.carbs \|\| 0\}g/);
  assert.doesNotMatch(componentSource, /膳纤/);
});
