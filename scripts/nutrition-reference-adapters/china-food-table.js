'use strict';

const { FIELDS, UNITS, identity } = require('../../packages/nutrition-recognition-core/contracts');

function adaptChinaFoodTable(row, overrides = {}) {
  const legacy = row.origin && row.origin.source === 'china_food_composition_table' && !row.nutrients;
  const nutrients = {};
  FIELDS.forEach(field => {
    const source = row.nutrients && row.nutrients[field];
    if (source && typeof source === 'object') nutrients[field] = source;
    else {
      const value = (row.nutritionPerBasis || {})[field];
      // 旧转换器已丢失空值信息，无法证明历史0是真实含量。
      nutrients[field] = { value: value === undefined ? null : value, unit: UNITS[field],
        state: legacy && value === 0 ? 'unverified' : value == null ? 'missing' : 'present' };
    }
  });
  const recordId = row.foodCode || row.sourceFoodCode || (row.origin || {}).foodCode || row.recordId;
  return {
    recordId, identity: identity({ ...row, ...(row.identity || {}), ...overrides }),
    basis: row.basis || { ...(row.nutritionBasis || {}), material: 'food' }, nutrients,
    source: { recordId, dataType: 'china_food_composition_table', verified: true }
  };
}

module.exports = { adaptChinaFoodTable };
