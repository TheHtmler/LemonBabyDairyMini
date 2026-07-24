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
  assert.match(source, /usageCount/);
  assert.match(source, /async create/);
  assert.match(source, /async update/);
  assert.match(source, /async softDelete|status:\s*'deleted'/);
  assert.match(source, /listActiveByBaby/);
  assert.match(source, /touchUsage/);
  assert.match(source, /模板阶段不存配方用量|quantity:\s*0/);
  assert.doesNotMatch(source, /成品总重必须大于 0|原料份量必须大于 0/);
  // 列表只按 babyUid 查，status 本地过滤（避免新集合缺复合索引导致整页为空）
  const listStart = source.indexOf('async listActiveByBaby');
  const listEnd = source.indexOf('async touchUsage', listStart);
  const listBody = source.slice(listStart, listEnd);
  assert.doesNotMatch(listBody, /\.orderBy\(/);
  assert.match(listBody, /where\(\{\s*babyUid/);
  assert.doesNotMatch(listBody, /where\(\{[\s\S]*status:\s*'active'/);
  assert.match(source, /recipe_catalog_cache_/);
  assert.match(source, /不使用 \.\.\.doc|setData 失败/);
  assert.match(source, /只写白名单字段|schemaVersion:\s*normalized\.schemaVersion/);
});

test('recipe model guards every existing-document write by babyUid', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'miniprogram/models/recipe.js'),
    'utf8'
  );

  assert.match(source, /async update\(id,\s*patch\s*=\s*\{\},\s*babyUid\)/);
  assert.match(source, /async softDelete\(id,\s*babyUid\)/);
  assert.match(source, /async touchUsage\(id,\s*babyUid\)/);
  assert.match(source, /assertRecipeOwnership/);
  assert.match(source, /doc\.babyUid\s*!==\s*expectedBabyUid/);
});
