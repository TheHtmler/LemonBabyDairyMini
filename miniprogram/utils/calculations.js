// Constants for protein calculations
const NATURAL_MILK_PROTEIN_CONCENTRATION = 1.1; // g/100ml
const SPECIAL_MILK_PROTEIN_CONCENTRATION = 13.1; // g/100g
const SPECIAL_MILK_MIX_RATIO = 13.5; // g/90ml
const NATURAL_PROTEIN_COEFFICIENT = 1.2; // g/kg

/**
 * Calculate daily natural protein intake based on weight
 * @param {number} weightKg - Baby's weight in kg
 * @returns {number} Daily natural protein intake in grams
 */
const calculateDailyNaturalProtein = (weightKg) => {
  return NATURAL_PROTEIN_COEFFICIENT * weightKg;
};

/**
 * Calculate required natural milk volume for the day
 * @param {number} dailyNaturalProtein - Daily natural protein requirement in grams
 * @returns {number} Required natural milk volume in ml
 */
const calculateRequiredNaturalMilkVolume = (dailyNaturalProtein) => {
  return (dailyNaturalProtein / NATURAL_MILK_PROTEIN_CONCENTRATION) * 100;
};

/**
 * Calculate per-feeding natural milk volume
 * @param {number} dailyNaturalMilkVolume - Daily natural milk volume in ml
 * @param {number} feedingsPerDay - Number of feedings per day (default 8)
 * @returns {number} Natural milk volume per feeding in ml
 */
const calculatePerFeedingNaturalMilk = (dailyNaturalMilkVolume, feedingsPerDay = 8) => {
  return dailyNaturalMilkVolume / feedingsPerDay;
};

/**
 * Calculate special milk volume needed per feeding
 * @param {number} totalFeedingVolume - Total volume per feeding in ml
 * @param {number} naturalMilkVolume - Natural milk volume per feeding in ml
 * @returns {number} Special milk volume needed in ml
 */
const calculateSpecialMilkVolume = (totalFeedingVolume, naturalMilkVolume) => {
  return totalFeedingVolume - naturalMilkVolume;
};

/**
 * Calculate total protein intake for a feeding
 * @param {number} naturalMilkVolume - Natural milk volume in ml
 * @param {number} specialMilkVolume - Special milk volume in ml
 * @returns {number} Total protein intake in grams
 */
const calculateTotalProteinIntake = (naturalMilkVolume, specialMilkVolume) => {
  const naturalMilkProtein = (naturalMilkVolume * NATURAL_MILK_PROTEIN_CONCENTRATION) / 100;
  const specialMilkProtein = (specialMilkVolume * SPECIAL_MILK_PROTEIN_CONCENTRATION) / 90;
  return naturalMilkProtein + specialMilkProtein;
};

module.exports = {
  calculateDailyNaturalProtein,
  calculateRequiredNaturalMilkVolume,
  calculatePerFeedingNaturalMilk,
  calculateSpecialMilkVolume,
  calculateTotalProteinIntake
}; 