const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('recipe model targets recipe_catalog with soft delete and usage fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/pkg-records/models/recipe.js'),
    'utf8'
  );
  assert.match(source, /recipe_catalog/);
  assert.match(source, /steps/);
  assert.match(source, /coverImageFileId/);
  assert.match(source, /prepTimeSec/);
  assert.match(source, /usageCount/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async softDelete|status:\s*'deleted'/);
  assert.match(source, /listActiveByBaby/);
  assert.match(source, /touchUsage/);
  assert.match(source, /可选默认份量|quantity > 0/);
  assert.match(source, /buildIngredientNutrition/);
  assert.match(source, /summarizeRecipeNutrition/);
  assert.match(source, /proteinQuality:\s*ingredient\.proteinQuality/);
  assert.doesNotMatch(source, /成品总重必须大于 0|原料份量必须大于 0/);
  assert.doesNotMatch(source, /quantity:\s*0,\s*\n\s*unit:/);
  // 列表只按 babyUid 查，status 本地过滤（避免新集合缺复合索引导致整页为空）
  const listStart = source.indexOf('async listActiveByBaby');
  const listEnd = source.indexOf('async touchUsage', listStart);
  const listBody = source.slice(listStart, listEnd);
  assert.doesNotMatch(listBody, /\.orderBy\(/);
  assert.match(listBody, /where\(\{\s*babyUid/);
  assert.doesNotMatch(listBody, /where\(\{[\s\S]*status:\s*'active'/);
  assert.match(listBody, /云查询成功（含空列表）以云端为准/);
  assert.match(listBody, /仅云查询失败时用本地缓存兜底/);
  assert.doesNotMatch(listBody, /mergeRecipeLists\(remote,\s*cached\)/);
  assert.match(source, /recipe_catalog_cache_/);
  assert.match(source, /不使用 \.\.\.doc|setData 失败/);
  assert.match(source, /只写白名单字段|schemaVersion:\s*normalized\.schemaVersion/);
});

test('recipe model guards every existing-document write by babyUid', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/pkg-records/models/recipe.js'),
    'utf8'
  );

  assert.match(source, /async update\(id,\s*patch\s*=\s*\{\},\s*babyUid\)/);
  assert.match(source, /async softDelete\(id,\s*babyUid\)/);
  assert.match(source, /async touchUsage\(id,\s*babyUid\)/);
  assert.match(source, /assertRecipeOwnership/);
  assert.match(source, /doc\.babyUid\s*!==\s*expectedBabyUid/);
});
