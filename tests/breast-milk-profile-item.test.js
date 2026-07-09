const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  VIRTUAL_BREAST_MILK_ID,
  buildVirtualBreastMilkPowder,
  isVirtualBreastMilkPowder,
  stripVirtualBreastMilkPowders
} = require('../miniprogram/utils/breastMilkProfileItem');
const {
  POWDER_CATEGORIES,
  POWDER_CATEGORY_ORDER,
  POWDER_CATEGORY_META
} = require('../miniprogram/utils/formulaPowderUtils');

test('powder categories include breast milk first in sidebar order', () => {
  assert.equal(POWDER_CATEGORIES.BREAST_MILK, 'breast_milk');
  assert.equal(POWDER_CATEGORY_ORDER[0], POWDER_CATEGORIES.BREAST_MILK);
  assert.equal(POWDER_CATEGORY_META.breast_milk.label, '母乳');
});

test('buildVirtualBreastMilkPowder uses nutrition profile settings per 100ml', () => {
  const powder = buildVirtualBreastMilkPowder({
    natural_milk_protein: 1.2,
    natural_milk_calories: 68,
    natural_milk_fat: 4.1,
    natural_milk_carbs: 7,
    natural_milk_fiber: 0
  });

  assert.equal(powder._id, VIRTUAL_BREAST_MILK_ID);
  assert.equal(powder.name, '母乳');
  assert.equal(powder.category, POWDER_CATEGORIES.BREAST_MILK);
  assert.equal(powder.nutritionBasisUnit, 'ml');
  assert.equal(powder.libraryScope, 'mine');
  assert.equal(powder.isSystem, false);
  assert.equal(powder.isFixedPowder, true);
  assert.equal(powder.nutritionPer100g.protein, 1.2);
  assert.equal(powder.nutritionPer100g.calories, 68);
  assert.equal(isVirtualBreastMilkPowder(powder), true);
});

test('stripVirtualBreastMilkPowders removes only virtual breast milk entries', () => {
  const virtualPowder = buildVirtualBreastMilkPowder();
  const powders = [
    virtualPowder,
    { _id: 'powder-1', name: '纽迪希亚', category: POWDER_CATEGORIES.SPECIAL_FORMULA }
  ];

  const result = stripVirtualBreastMilkPowders(powders);
  assert.equal(result.length, 1);
  assert.equal(result[0]._id, 'powder-1');
});

test('buildBreastMilkPowderDraft prepares modal form values from virtual powder', () => {
  const { buildBreastMilkPowderDraft } = require('../miniprogram/utils/breastMilkProfileItem');
  const draft = buildBreastMilkPowderDraft(buildVirtualBreastMilkPowder({
    natural_milk_protein: 1.2,
    natural_milk_calories: 68
  }));

  assert.equal(draft.name, '母乳');
  assert.equal(draft.category, POWDER_CATEGORIES.BREAST_MILK);
  assert.equal(draft.nutritionPer100g.protein, '1.2');
  assert.equal(draft.nutritionPer100g.calories, '68');
});

test('powder management exposes breast milk as a fixed item in my library UI', () => {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/powder-management/index.wxml'),
    'utf8'
  );
  const source = fs.readFileSync(
    require.resolve('../miniprogram/pkg-milk/powder-management/index.js'),
    'utf8'
  );

  assert.match(source, /buildVirtualBreastMilkPowder/);
  assert.match(source, /const alwaysShowBreastMilk = isMineScope/);
  assert.match(source, /POWDER_CATEGORIES\.BREAST_MILK/);
  assert.match(source, /editingBreastMilk/);
  assert.match(source, /saveBreastMilkSettings/);
  assert.match(source, /buildBreastMilkPowderDraft/);
  assert.match(wxml, /editingBreastMilk/);
  assert.match(wxml, /编辑母乳/);
  assert.match(wxml, /每 100ml/);
  assert.doesNotMatch(source, /view=mother/);
  assert.match(wxml, /系统预设/);
  assert.match(wxml, /item\.isVirtualBreastMilk/);
  assert.match(wxml, /nutritionBasisUnit/);
});
