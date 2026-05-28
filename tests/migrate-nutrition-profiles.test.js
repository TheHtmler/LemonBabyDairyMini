const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionDir = path.join('cloudfunctions', 'migrateNutritionProfiles');
const indexPath = path.join(functionDir, 'index.js');

test('migrateNutritionProfiles cloud function writes legacy settings into milk_nutrition_profiles only', () => {
  assert.equal(fs.existsSync(indexPath), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'package.json')), true);
  assert.equal(fs.existsSync(path.join(functionDir, 'config.json')), true);

  const source = fs.readFileSync(indexPath, 'utf8');

  assert.match(source, /MILK_NUTRITION_PROFILES_COLLECTION\s*=\s*'milk_nutrition_profiles'/);
  assert.match(source, /collection\(MILK_NUTRITION_PROFILES_COLLECTION\)/);
  assert.doesNotMatch(source, /collection\('nutrition_profiles'\)/);
  assert.match(source, /collection\('baby_info'\)/);
  assert.match(source, /collection\('nutrition_settings'\)/);
  assert.match(source, /event\.babyUid/);
  assert.match(source, /where\(\{\s*babyUid\s*\}\)/);
  assert.match(source, /schemaVersion:\s*1/);
  assert.match(source, /breastMilk/);
  assert.match(source, /formulaPowders/);
  assert.match(source, /status:\s*'active'/);
  assert.match(source, /createdAt:\s*timestamp/);
  assert.match(source, /updatedAt:\s*timestamp/);
  assert.match(source, /deletedAt:\s*null/);
  assert.match(source, /legacy_regular_formula/);
  assert.match(source, /legacy_special_formula/);
  assert.match(source, /name:\s*'普奶'/);
  assert.match(source, /name:\s*'特奶'/);
  assert.doesNotMatch(source, /默认普通配方粉/);
  assert.doesNotMatch(source, /默认特殊配方粉/);
  assert.doesNotMatch(source, /collection\('feeding_records'\)/);
});
