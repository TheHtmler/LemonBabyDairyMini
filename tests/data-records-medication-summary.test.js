const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const pageJs = path.join('miniprogram', 'pages', 'data-records-v2', 'index.js');

test('data-records page wires medicationDayStats into processMedicationData', () => {
  const source = fs.readFileSync(pageJs, 'utf8');
  assert.match(source, /medicationDayStats/);
  assert.match(source, /buildMedicationDayStats/);
  assert.match(source, /medicationStats/);
  assert.match(source, /processMedicationData/);
});
