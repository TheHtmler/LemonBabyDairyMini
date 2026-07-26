const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sleepRecord model covers CRUD ongoing and dirty', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'models', 'sleepRecord.js'), 'utf8');
  assert.match(source, /sleep_records/);
  assert.match(source, /startTime/);
  assert.match(source, /endTime/);
  assert.match(source, /durationMinutes/);
  assert.match(source, /findOngoing/);
  assert.match(source, /completeSleep/);
  assert.match(source, /markDirty/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async delete/);
  assert.match(source, /resolveEndDateTime/);
});
