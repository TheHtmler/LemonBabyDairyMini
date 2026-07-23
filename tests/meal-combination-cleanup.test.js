const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('meal combination model and utils files are removed', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'miniprogram/models/mealCombination.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'miniprogram/utils/mealCombinationUtils.js')), false);
});

test('miniprogram js no longer references mealCombination APIs', () => {
  const miniRoot = path.join(ROOT, 'miniprogram');
  const stack = [miniRoot];
  const hits = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!name.endsWith('.js')) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (/mealCombinationSource|normalizeMealCombinationSource|meal_combinations|mealCombinationUtils|recipeGroups/.test(source)) {
        hits.push(path.relative(ROOT, full));
      }
    }
  }
  assert.deepEqual(hits, []);
});
