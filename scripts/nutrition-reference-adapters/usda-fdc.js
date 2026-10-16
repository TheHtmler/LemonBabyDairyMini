'use strict';

const { FIELDS, UNITS, identity } = require('../../packages/nutrition-recognition-core/contracts');
const IDS = { protein: [1003], fat: [1004], carbs: [1005], fiber: [1079],
  sodium: [1093], calories: [1008, 2047, 2048] };

function preparation(description) {
  if (/\braw\b/i.test(description)) return 'raw';
  if (/\bboiled\b/i.test(description)) return 'boiled';
  if (/\bstir[- ]fried\b/i.test(description)) return 'stir_fried';
  return 'unknown';
}

function adaptUsdaFdc(row, overrides = {}) {
  const description = row.description || '';
  const nutrients = {};
  FIELDS.forEach(field => {
    const entries = row.foodNutrients || [];
    let selected;
    for (const id of IDS[field]) {
      selected = entries.find(x => Number((x.nutrient || {}).id || x.nutrientId) === id);
      if (selected) break;
    }
    const nutrientId = selected && Number((selected.nutrient || {}).id || selected.nutrientId);
    nutrients[field] = {
      value: selected ? selected.amount ?? selected.value ?? null : null,
      unit: selected ? (selected.nutrient || {}).unitName || selected.unitName || UNITS[field] : UNITS[field],
      definition: field === 'carbs' ? 'by_difference' : field === 'fiber' ? 'total_dietary_fiber' :
        field === 'calories' ? 'usda_energy_' + nutrientId : field
    };
  });
  // 品牌数据存在100g/100ml口径，未核实基准时不自动发布。
  const branded = row.dataType === 'Branded';
  const basisUnit = branded ? row.verifiedNutrientBasis || overrides.nutrientBasis || null : 'g';
  return {
    recordId: String(row.fdcId || ''),
    identity: identity({ name: description, aliases: [], preparation: preparation(description),
      brand: row.brandOwner || row.brandName || '', barcode: row.gtinUpc || '', ...overrides }),
    basis: { quantity: 100, unit: basisUnit, material: 'food' }, nutrients,
    source: { recordId: String(row.fdcId || ''), dataType: row.dataType || 'unknown', verified: true }
  };
}

module.exports = { adaptUsdaFdc };
