const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('baby info setup guides new creators to nutrition profile settings v2', () => {
  const source = fs.readFileSync('miniprogram/pkg-misc/baby-info/index.js', 'utf8');

  assert.match(source, /建议完善天然蛋白浓度与奶粉档案/);
  assert.match(source, /url:\s*`\/pkg-milk\/nutrition-profile-settings\/index\?fromSetup=true`/);
  assert.doesNotMatch(source, /url:\s*`\/pages\/nutrition-settings\/index\?fromSetup=true`/);
});
