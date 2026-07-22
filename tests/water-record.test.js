const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('waterRecord model marks summary dirty and stores volumeMl', () => {
  const modelPath = path.join(__dirname, '..', 'miniprogram', 'models', 'waterRecord.js');
  const source = fs.readFileSync(modelPath, 'utf8');
  assert.match(source, /water_records/);
  assert.match(source, /volumeMl/);
  assert.match(source, /notes/);
  assert.match(source, /markDirty/);
  assert.match(source, /findByDate/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async delete/);
});

test('daily summary utils include water section', () => {
  const utilsPath = path.join(__dirname, '..', 'miniprogram', 'utils', 'dailySummaryV2Utils.js');
  const source = fs.readFileSync(utilsPath, 'utf8');
  assert.match(source, /buildWaterSummary/);
  assert.match(source, /waterRecords/);
  assert.match(source, /recordCounts:[\s\S]*water:/);
});
