const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('baby info setup guides new creators to nutrition profile settings v2', () => {
  const source = fs.readFileSync('miniprogram/pkg-misc/baby-info/index.js', 'utf8');
  const homeSource = fs.readFileSync('miniprogram/pages/daily-feeding/index.js', 'utf8');

  assert.match(source, /建议完善天然蛋白浓度与奶粉档案/);
  // 保存后“去设置”不再直接 navigateTo（会让返回退回宝宝信息页），
  // 而是打上标记并切到首页，由首页压入配奶设置页，保证返回回到首页。
  assert.match(source, /pendingNutritionSetup\s*=\s*true/);
  assert.match(source, /wx\.switchTab\(\{\s*url:\s*'\/pages\/daily-feeding\/index'/);
  assert.doesNotMatch(source, /url:\s*`\/pkg-milk\/nutrition-profile-settings\/index\?fromSetup=true`/);

  // 首页消费标记后压入奶粉管理页并直接打开母乳编辑（editBreastMilk=1）。
  assert.match(homeSource, /pendingNutritionSetup/);
  assert.match(homeSource, /url:\s*'\/pkg-milk\/powder-management\/index\?editBreastMilk=1'/);
  assert.doesNotMatch(homeSource, /url:\s*`\/pages\/nutrition-settings\/index\?fromSetup=true`/);
});
