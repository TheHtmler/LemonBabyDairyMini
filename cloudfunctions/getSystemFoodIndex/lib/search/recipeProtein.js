'use strict';
function roundNumber(num, precision = 2) { if (isNaN(num)) return 0; const multiplier = Math.pow(10, precision); return Math.round(num * multiplier) / multiplier; }

function summarizePremiumProteinFromIngredients(ingredients = []) {
  let premiumProtein = 0;
  let regularProtein = 0;
  (ingredients || []).forEach((item = {}) => {
    const natural = Number(item.nutrition?.naturalProtein) || 0;
    if (!(natural > 0)) return;
    const quality = item.proteinQuality
      || item.foodSnapshot?.proteinQuality
      || item.food?.proteinQuality
      || '';
    if (quality === 'premium') {
      premiumProtein += natural;
    } else {
      regularProtein += natural;
    }
  });
  premiumProtein = roundNumber(premiumProtein, 2);
  regularProtein = roundNumber(regularProtein, 2);
  const naturalProtein = roundNumber(premiumProtein + regularProtein, 2);
  const premiumRatio = naturalProtein > 0
    ? Math.round((premiumProtein / naturalProtein) * 100)
    : 0;
  return {
    premiumProtein,
    regularProtein,
    naturalProtein,
    premiumRatio
  };
}

function scalePremiumProteinSummary(summary = {}, factor) {
  const scale = Number(factor);
  const safeFactor = Number.isFinite(scale) ? scale : 0;
  const premiumProtein = roundNumber((Number(summary.premiumProtein) || 0) * safeFactor, 2);
  const regularProtein = roundNumber((Number(summary.regularProtein) || 0) * safeFactor, 2);
  const naturalProtein = roundNumber(premiumProtein + regularProtein, 2);
  const premiumRatio = naturalProtein > 0
    ? Math.round((premiumProtein / naturalProtein) * 100)
    : 0;
  return {
    premiumProtein,
    regularProtein,
    naturalProtein,
    premiumRatio
  };
}

/** 日汇总口径：优质 = 奶类天然蛋白（全算优质）+ 食物 premium 天然蛋白 */
function resolveDayPremiumProteinBase(summary = {}) {
  const milkNatural = Number(summary.milk?.naturalProtein) || 0;
  const foodNatural = Number(summary.food?.naturalProtein) || 0;
  const foodPremium = Number(summary.food?.premiumProtein) || 0;
  return {
    naturalProtein: roundNumber(milkNatural + foodNatural, 2),
    premiumProtein: roundNumber(milkNatural + foodPremium, 2)
  };
}

function isRecipeIntakeRecord(record = {}) {
  const recipeSource = record.recipeSource;
  const hasRecipeId = !!(
    recipeSource
    && typeof recipeSource === 'object'
    && String(recipeSource.recipeId || '').trim()
  );
  const hasIngredients = !!(
    recipeSource
    && typeof recipeSource === 'object'
    && Array.isArray(recipeSource.ingredientsSnapshot)
    && recipeSource.ingredientsSnapshot.length > 0
  );
  return record.sourceType === 'recipe' || hasRecipeId || hasIngredients;
}

/** 优质蛋白占天然蛋白的百分比（整数） */
function resolvePremiumProteinRatio(premiumProtein, naturalProtein) {
  const natural = Number(naturalProtein) || 0;
  const premium = Number(premiumProtein) || 0;
  if (!(natural > 0)) return 0;
  return Math.round((premium / natural) * 100);
}

/**
 * 单条食物摄入的优质/普通天然蛋白拆分。
 * 食谱：按原料快照的优质占比，分摊到本条已摄入的 naturalProtein（避免整道菜被当成单一 quality）。
 * 普通食物：premium → 全算优质，否则算普通。
 */
function resolveFoodIntakePremiumProteinSplit(record = {}, naturalProteinInput) {
  const naturalProtein = Math.max(
    0,
    Number(
      naturalProteinInput !== undefined && naturalProteinInput !== null && naturalProteinInput !== ''
        ? naturalProteinInput
        : (
          record.naturalProtein !== undefined
          && record.naturalProtein !== null
          && record.naturalProtein !== ''
            ? record.naturalProtein
            : record.nutrition?.naturalProtein
        )
    ) || 0
  );

  if (!(naturalProtein > 0)) {
    return { premiumProtein: 0, regularProtein: 0, premiumRatio: 0 };
  }

  if (isRecipeIntakeRecord(record)) {
    const recipeSource = record.recipeSource || {};
    const ingredients = Array.isArray(recipeSource.ingredientsSnapshot)
      ? recipeSource.ingredientsSnapshot
      : (Array.isArray(record.ingredientsSnapshot) ? record.ingredientsSnapshot : []);
    if (ingredients.length) {
      const batch = summarizePremiumProteinFromIngredients(ingredients);
      const batchNatural = Number(batch.naturalProtein) || 0;
      if (batchNatural > 0) {
        const premiumProtein = roundNumber(
          naturalProtein * (Number(batch.premiumProtein) || 0) / batchNatural,
          2
        );
        const regularProtein = roundNumber(Math.max(0, naturalProtein - premiumProtein), 2);
        return {
          premiumProtein,
          regularProtein,
          premiumRatio: resolvePremiumProteinRatio(premiumProtein, naturalProtein)
        };
      }
    }
  }

  const quality = record.proteinQuality || record.foodSnapshot?.proteinQuality || '';
  if (quality === 'premium') {
    return {
      premiumProtein: roundNumber(naturalProtein, 2),
      regularProtein: 0,
      premiumRatio: 100
    };
  }
  return {
    premiumProtein: 0,
    regularProtein: roundNumber(naturalProtein, 2),
    premiumRatio: 0
  };
}
module.exports = { summarizePremiumProteinFromIngredients, scalePremiumProteinSummary, resolveDayPremiumProteinBase, isRecipeIntakeRecord, resolvePremiumProteinRatio, resolveFoodIntakePremiumProteinSplit };
