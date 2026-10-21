'use strict';

const { identity } = require('./contracts');
const { searchText } = require('./reference');
const GENERIC_NAMES = ['食物', '蔬菜', '青菜', '水果', '肉', '奶粉', '配方粉', '婴儿配方奶粉'];

function candidateIdentity(item) {
  const saved = (item.recognitionMeta || {}).confirmedIdentity || {};
  return identity({ ...item, ...saved, name: item.name || saved.name });
}
function identityKey(value) {
  const normalized = identity(value);
  return JSON.stringify(['name', 'preparation', 'brand', 'series', 'stage', 'barcode'].map(key => searchText(normalized[key])));
}
function strongIdentityKey(value, targetType) {
  const normalized = identity(value);
  if (/^\d{8,14}$/.test(normalized.barcode)) return 'barcode:' + normalized.barcode;
  if (['brand', 'series', 'stage'].every(key => normalized[key])) return JSON.stringify(['product', ...['brand', 'series', 'stage'].map(key => searchText(normalized[key])), targetType === 'powder' ? 'powder' : normalized.preparation]);
  if (targetType === 'food' && !['brand', 'series', 'stage'].some(key => normalized[key]) && !GENERIC_NAMES.includes(searchText(normalized.name)) && ['raw', 'boiled', 'stir_fried'].includes(normalized.preparation)) return JSON.stringify(['food', searchText(normalized.name), normalized.preparation]);
  return '';
}
function duplicateLevel(wantedInput, candidateInput) {
  const wanted = identity(wantedInput), candidate = identity(candidateInput);
  const validBarcode = value => /^\d{8,14}$/.test(value);
  if (validBarcode(wanted.barcode) && validBarcode(candidate.barcode)) return wanted.barcode === candidate.barcode ? 'exact' : 'different';
  const productKeys = ['brand', 'series', 'stage'];
  if (productKeys.some(key => wanted[key] && candidate[key] && searchText(wanted[key]) !== searchText(candidate[key]))) return 'different';
  const powderState = value => ['dry_powder', 'prepared_formula'].includes(value);
  if (!powderState(wanted.preparation) && !powderState(candidate.preparation) &&
      !['unknown', 'other'].includes(wanted.preparation) && !['unknown', 'other'].includes(candidate.preparation) && wanted.preparation !== candidate.preparation) return 'different';
  const name = searchText(wanted.name), otherName = searchText(candidate.name);
  const sameName = name && name === otherName;
  const completeProduct = productKeys.every(key => wanted[key] && candidate[key] && searchText(wanted[key]) === searchText(candidate[key]));
  if (completeProduct) return wanted.preparation === candidate.preparation || powderState(wanted.preparation) && powderState(candidate.preparation) ? 'exact' : 'possible';
  const branded = productKeys.some(key => wanted[key] || candidate[key]) || powderState(wanted.preparation) || powderState(candidate.preparation);
  if (sameName && !branded && !GENERIC_NAMES.includes(name) && ['raw', 'boiled', 'stir_fried'].includes(wanted.preparation) && wanted.preparation === candidate.preparation) return 'exact';
  // 模型别名只召回疑似项，不作为同一身份的证明。
  const names = [candidate.name, ...candidate.aliases].map(searchText);
  if (sameName || names.includes(name) || wanted.aliases.map(searchText).includes(otherName) || name.length >= 2 && otherName.length >= 2 && (name.includes(otherName) || otherName.includes(name))) return 'possible';
  return 'different';
}
function findDuplicates(items, wanted, targetType) {
  const exact = [], possible = [];
  for (const item of items) {
    if (item.deletedAt || item.status === 'archived' || item.status === 'deleted' || item.isSystem || item.sourceType === 'system' || item.ownerType === 'system') continue;
    const normalized = candidateIdentity(item);
    const level = duplicateLevel(wanted, normalized);
    if (level === 'different') continue;
    const id = targetType === 'powder' ? item.id : item._id;
    if (!id) continue;
    const candidate = { targetType, itemId: id, name: item.name || normalized.name, identity: normalized,
      revision: String(item.version || '') + ':' + String(item.updatedAt || ''), identityKey: identityKey(normalized) };
    (level === 'exact' ? exact : possible).push(candidate);
  }
  return { exact, possible };
}
module.exports = { candidateIdentity, identityKey, strongIdentityKey, duplicateLevel, findDuplicates };
