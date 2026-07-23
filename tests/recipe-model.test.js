const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('recipe model targets recipe_catalog with soft delete and usage fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/models/recipe.js'),
    'utf8'
  );
  assert.match(source, /recipe_catalog/);
  assert.match(source, /steps/);
  assert.match(source, /coverImageFileId/);
  assert.match(source, /prepTimeSec/);
  assert.match(source, /yieldWeightG/);
  assert.match(source, /nutritionPer100g/);
  assert.match(source, /usageCount/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async softDelete|status:\s*'deleted'/);
  assert.match(source, /listActiveByBaby/);
  assert.match(source, /touchUsage/);
});
