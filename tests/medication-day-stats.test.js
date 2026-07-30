const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMedicationDayStats } = require('../miniprogram/utils/medicationDayStats');

test('empty list returns empty stats', () => {
  assert.deepEqual(buildMedicationDayStats([]), []);
  assert.deepEqual(buildMedicationDayStats(null), []);
});

test('sums same medication same unit and counts doses', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: '左卡尼丁', dosage: 1.5, unit: 'ml' },
    { medicationId: 'm1', medicationName: '左卡尼丁', dosage: 1.5, unit: 'ml' }
  ]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].key, 'm1');
  assert.equal(stats[0].medicationName, '左卡尼丁');
  assert.equal(stats[0].totalDosage, 3);
  assert.equal(stats[0].dosageText, '3');
  assert.equal(stats[0].unit, 'ml');
  assert.equal(stats[0].count, 2);
});

test('groups by medicationId not display name', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'a', medicationName: '同名药', dosage: 1, unit: 'ml' },
    { medicationId: 'b', medicationName: '同名药', dosage: 2, unit: 'ml' }
  ]);
  assert.equal(stats.length, 2);
});

test('falls back to medicationName when id missing', () => {
  const stats = buildMedicationDayStats([
    { medicationName: '精氨酸', dosage: 1.2, unit: 'ml' },
    { medicationName: '精氨酸', dosage: 1.2, unit: 'ml' }
  ]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].key, '精氨酸');
  assert.equal(stats[0].totalDosage, 2.4);
  assert.equal(stats[0].count, 2);
});

test('mixed units in same group skip dosage total', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: '某药', dosage: 1, unit: 'ml' },
    { medicationId: 'm1', medicationName: '某药', dosage: 1, unit: 'mg' }
  ]);
  assert.equal(stats[0].count, 2);
  assert.equal(stats[0].totalDosage, null);
  assert.equal(stats[0].dosageText, '');
  assert.equal(stats[0].unit, '');
});

test('blank unit mixed with concrete unit skips dosage total', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: '某药', dosage: 1, unit: 'ml' },
    { medicationId: 'm1', medicationName: '某药', dosage: 2, unit: '' }
  ]);
  assert.equal(stats[0].count, 2);
  assert.equal(stats[0].totalDosage, null);
  assert.equal(stats[0].dosageText, '');
  assert.equal(stats[0].unit, '');
});

test('all blank units still sum dosages', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: '某药', dosage: 1, unit: '' },
    { medicationId: 'm1', medicationName: '某药', dosage: 2, unit: null }
  ]);
  assert.equal(stats[0].totalDosage, 3);
  assert.equal(stats[0].count, 2);
});

test('invalid dosage treated as 0', () => {
  const stats = buildMedicationDayStats([
    { medicationId: 'm1', medicationName: 'B12', dosage: 'x', unit: 'ml' },
    { medicationId: 'm1', medicationName: 'B12', dosage: 1, unit: 'ml' }
  ]);
  assert.equal(stats[0].totalDosage, 1);
  assert.equal(stats[0].count, 2);
});

test('sorts by medicationName', () => {
  const stats = buildMedicationDayStats([
    { medicationId: '2', medicationName: '左卡尼丁', dosage: 1, unit: 'ml' },
    { medicationId: '1', medicationName: '精氨酸', dosage: 1, unit: 'ml' }
  ]);
  assert.deepEqual(stats.map((s) => s.medicationName), ['左卡尼丁', '精氨酸'].sort((a, b) => a.localeCompare(b)));
});
