const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getFatEnergyRangeByAgeMonths,
  getDefaultMacroRatioRanges,
  calculateEnergyRatios,
  calculatePremiumProteinRatio,
  evaluateRatioRange,
  buildMacroRatioSummary
} = require('../miniprogram/utils/dietAdjustMacroRanges');

test('fat energy range follows age bands', () => {
  assert.deepEqual(getFatEnergyRangeByAgeMonths(3), { min: 45, max: 50, label: '0-6月龄' });
  assert.deepEqual(getFatEnergyRangeByAgeMonths(18), { min: 30, max: 35, label: '1-2岁' });
  assert.deepEqual(getFatEnergyRangeByAgeMonths(80), { min: 25, max: 30, label: '≥6岁' });
});

test('default ranges include premium 30-50', () => {
  const ranges = getDefaultMacroRatioRanges(8);
  assert.equal(ranges.proteinEnergy.min, 10);
  assert.equal(ranges.proteinEnergy.max, 15);
  assert.equal(ranges.carbsEnergy.min, 55);
  assert.equal(ranges.premiumProteinRatio.min, 30);
  assert.equal(ranges.premiumProteinRatio.max, 50);
  assert.equal(ranges.fatEnergy.min, 35);
});

test('energy and premium ratios evaluate ranges', () => {
  const energy = calculateEnergyRatios({ protein: 10, carbs: 50, fat: 20 });
  assert.ok(energy.protein > 0);
  assert.equal(calculatePremiumProteinRatio(4, 10), 40);
  assert.equal(evaluateRatioRange(40, { min: 30, max: 50 }), 'in');
  assert.equal(evaluateRatioRange(20, { min: 30, max: 50 }), 'low');

  const summary = buildMacroRatioSummary(
    { protein: 10, calories: 400, fat: 10, carbs: 40, premiumProtein: 4 },
    getDefaultMacroRatioRanges(18)
  );
  assert.equal(summary.rows.length, 4);
  assert.ok(summary.rows.every((row) => row.rangeText));
});
