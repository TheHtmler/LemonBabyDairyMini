'use strict';
const { text } = require('./lib/core/contracts');
async function findReferences(db, identity) {
  if (identity.barcode) {
    const byBarcode = await db.collection('nutrition_reference').where({ status: 'active',
      'source.verified': true, 'identity.barcode': identity.barcode }).limit(60).get();
    if ((byBarcode.data || []).length) return byBarcode.data;
  }
  const terms = [identity.name].concat(identity.aliases || []).map(x => text(x).toLowerCase().replace(/\s/g, '')).filter(Boolean);
  const result = await db.collection('nutrition_reference').where({
    status: 'active', 'source.verified': true, searchTerms: db.command.in(terms)
  }).limit(60).get();
  if (result.data && result.data.length) return result.data;
  const escaped = text(identity.name, 80).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  if (!escaped) return [];
  const approximate = await db.collection('nutrition_reference').where({
    status: 'active', 'source.verified': true,
    'identity.name': db.RegExp({ regexp: escaped, options: 'i' })
  }).limit(30).get();
  return approximate.data || [];
}
module.exports = { findReferences };
