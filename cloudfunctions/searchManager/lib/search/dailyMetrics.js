'use strict';
const { businessDate: toDateKey } = require('./period');
function roundNumber(value, precision = 2) { const n = Number(value); return Number.isFinite(n) ? Math.round(n * Math.pow(10, precision)) / Math.pow(10, precision) : 0; }

function buildDailyNutritionMetricFromSummary(summary = {}, dateKey = '', effectiveWeight = 0) {
  const macro = summary.macroSummary || {};
  const milk = summary.milk || {};
  const food = summary.food || {};
  const counts = summary.recordCounts || {};
  const hasIntake = Number(counts.milk || 0) + Number(counts.food || 0) > 0;
  const dayWeight = Number(summary.basicInfo?.weight) || 0;
  const weight = dayWeight > 0 ? dayWeight : Number(effectiveWeight) || 0;

  if (!hasIntake && weight <= 0) {
    return null;
  }

  const naturalProtein = Number(macro.naturalProtein)
    || Number(milk.naturalProtein) + Number(food.naturalProtein)
    || 0;
  const specialProtein = Number(macro.specialProtein)
    || Number(milk.specialProtein) + Number(food.specialProtein)
    || 0;
  const protein = Number(macro.protein) || naturalProtein + specialProtein;
  const calories = Number(macro.calories)
    || Number(milk.calories) + Number(food.calories) + Number(summary.treatment?.calories || 0)
    || 0;

  const toCoefficient = (value, precision = 2) => {
    if (weight <= 0) return null;
    if (Number(value) > 0) return roundNumber(Number(value) / weight, precision);
    return hasIntake ? 0 : null;
  };

  return {
    date: dateKey || toDateKey(summary.date),
    weight,
    calories,
    carbs: Number(macro.carbs) || Number(milk.carbs) + Number(food.carbs) || 0,
    fat: Number(macro.fat) || Number(milk.fat) + Number(food.fat) || 0,
    naturalProteinCoefficient: toCoefficient(naturalProtein, 2),
    specialProteinCoefficient: toCoefficient(specialProtein, 2),
    totalProteinCoefficient: toCoefficient(protein, 2),
    calorieCoefficient: toCoefficient(calories, 1)
  };
}
module.exports = { buildDailyNutritionMetricFromSummary };
