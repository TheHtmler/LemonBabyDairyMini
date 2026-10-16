'use strict';
const { identity } = require('../../packages/nutrition-recognition-core/contracts');

// 厂家或第三方资料必须提供明确的计量口径与逐字段单位，不推测缺失项。
function adaptVerifiedCatalog(row, overrides = {}) {
  return {
    recordId: row.recordId,
    identity: identity({ ...(row.identity || {}), ...overrides }),
    basis: row.basis || {},
    nutrients: row.nutrients || {},
    source: { recordId: row.recordId, verified: row.source && row.source.verified === true,
      dataType: row.source && row.source.dataType || 'verified_catalog' }
  };
}
module.exports = { adaptVerifiedCatalog };
