'use strict';
const { number } = require('./contracts');
const ROLES = { regular_formula: 'natural', special_formula: 'special', energy_supplement: 'none' };
const FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber'];

function normalizeLegacyProfileSeed(settings = {}) {
  const nutritionPer100ml = {};
  const defaults = { calories: 67, protein: 1.1, fat: 4, carbs: 6.8, fiber: 0 };
  FIELDS.forEach(field => { nutritionPer100ml[field] = number(settings['natural_milk_' + field]) ?? defaults[field]; });
  let powders = Array.isArray(settings.formulaPowders) ? settings.formulaPowders.filter(Boolean) : [];
  if (!powders.length) {
    powders = ['formula_milk', 'special_milk'].map((prefix, index) => {
      const nutritionPer100g = {};
      FIELDS.forEach(field => { nutritionPer100g[field] = number(settings[prefix + '_' + field]) ?? 0; });
      const ratio = settings[prefix + '_ratio'] || {};
      const mixRatio = { powder: number(ratio.powder) ?? 0, water: number(ratio.water) ?? 0 };
      if (![...Object.values(nutritionPer100g), ...Object.values(mixRatio)].some(x => x > 0)) return null;
      return { id: index ? 'legacy_special_formula' : 'legacy_regular_formula',
        name: index ? '默认特殊配方粉' : '默认普通配方粉', category: index ? 'special_formula' : 'regular_formula',
        nutritionPer100g, mixRatio, source: 'legacy' };
    }).filter(Boolean);
  }
  const formulaPowders = powders.map((powder, index) => {
    const category = ROLES[powder.category] ? powder.category : 'regular_formula';
    const nutritionPer100g = {};
    FIELDS.forEach(field => { nutritionPer100g[field] = number((powder.nutritionPer100g || {})[field]) ?? 0; });
    return { ...powder, id: powder.id || 'formula_powder_' + (index + 1), name: powder.name || '未命名配方粉',
      category, proteinRole: ['natural', 'special', 'none'].includes(powder.proteinRole) ? powder.proteinRole : ROLES[category], nutritionPer100g,
      mixRatio: { powder: number((powder.mixRatio || {}).powder) ?? 0, water: number((powder.mixRatio || {}).water) ?? 0 },
      status: powder.status === 'archived' ? 'archived' : 'active', source: powder.source || 'user',
      sourceSystemPowderId: powder.sourceSystemPowderId || '',
      createdAt: powder.createdAt || null, updatedAt: powder.updatedAt || null, deletedAt: powder.deletedAt || null };
  });
  return { breastMilk: { nutritionPer100ml }, formulaPowders };
}

function sortProfiles(profiles = []) {
  const time = value => new Date(value || 0).getTime() || 0;
  return [...profiles].sort((a, b) => time(b.updatedAt) - time(a.updatedAt) || time(b.createdAt) - time(a.createdAt) ||
    (b.formulaPowders || []).filter(x => x.status !== 'archived').length - (a.formulaPowders || []).filter(x => x.status !== 'archived').length);
}
module.exports = { normalizeLegacyProfileSeed, sortProfiles };
