'use strict';

const FIELDS = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'sodium'];
const UNITS = { calories: 'kcal', protein: 'g', fat: 'g', carbs: 'g', fiber: 'g', sodium: 'mg' };
const MODES = ['food_label', 'powder_label', 'food_object', 'auto'];
const PREPARATIONS = ['raw', 'boiled', 'stir_fried', 'other', 'unknown', 'dry_powder', 'prepared_formula'];
const REQUIRED = ['calories', 'protein', 'fat', 'carbs'];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function text(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function number(value) {
  if (value === null || value === undefined || value === '' ||
      (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function identity(value = {}) {
  return {
    name: text(value.name),
    aliases: Array.isArray(value.aliases) ? value.aliases.map(x => text(x)).filter(Boolean).slice(0, 12) : [],
    preparation: PREPARATIONS.includes(value.preparation) ? value.preparation : 'unknown',
    brand: text(value.brand), series: text(value.series), stage: text(value.stage),
    barcode: text(value.barcode, 32)
  };
}

function defaultDefinition(field) {
  return ['carbs', 'fiber', 'calories'].includes(field) ? 'unknown' : field;
}

function validateFinalPatch(mode, patch = {}) {
  const nutrition = mode === 'powder_label' ? patch.nutritionPer100g || {} : patch;
  const missingFields = REQUIRED.filter(field => number(nutrition[field]) === null);
  if (!text(patch.name)) missingFields.push('name');
  if (mode === 'powder_label') {
    if (!(number(patch.mixRatio && patch.mixRatio.powder) > 0)) missingFields.push('mixRatio.powder');
    if (!(number(patch.mixRatio && patch.mixRatio.water) > 0)) missingFields.push('mixRatio.water');
  } else {
    if (!text(patch.unit)) missingFields.push('unit');
    if (!(number(patch.baseQuantity) > 0)) missingFields.push('baseQuantity');
  }
  return { valid: !missingFields.length, missingFields, errors: missingFields.map(x => '请补充有效的' + x) };
}

module.exports = { FIELDS, UNITS, MODES, PREPARATIONS, REQUIRED, fail, text, number, identity,
  defaultDefinition, validateFinalPatch };
