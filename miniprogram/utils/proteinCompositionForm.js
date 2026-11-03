/** 每次创建独立的草稿，切换类型或清空最后一行时不复用旧对象。 */
function createEmptyProteinComponent() {
  return { name: '', amount: { value: '', unit: '%', relation: 'eq' }, proteinPer100g: '',
    source: { type: 'manual', foodId: null } };
}

function createEmptyProteinComposition() {
  return { basis: { quantity: 100, unit: 'g' }, premiumComponents: [createEmptyProteinComponent()] };
}

function isEmptyProteinComponent(row = {}) {
  const blank = value => value == null || String(value).trim() === '';
  return blank(row.name) && blank(row.amount?.value) && blank(row.proteinPer100g);
}

module.exports = { createEmptyProteinComponent, createEmptyProteinComposition, isEmptyProteinComponent };
