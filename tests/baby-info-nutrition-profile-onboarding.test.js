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

test('baby info save binds default milk nutrition profile to the new babyUid', () => {
  const source = fs.readFileSync('miniprogram/pkg-misc/baby-info/index.js', 'utf8');

  assert.match(source, /MilkNutritionProfileModel/);
  assert.match(source, /ensureNutritionProfileSettings\(babyUid/);
});

test('skipping or cancelling nutrition setup still binds default breast milk to babyUid', () => {
  const babyInfoSource = fs.readFileSync('miniprogram/pkg-misc/baby-info/index.js', 'utf8');
  const powderSource = fs.readFileSync('miniprogram/pkg-milk/powder-management/index.js', 'utf8');
  const editorSource = fs.readFileSync('miniprogram/pkg-milk/milk-feeding-editor-v2/index.js', 'utf8');

  // 点「稍后设置」不会再走配奶页，所以必须在弹窗出现前就绑定档案。
  const bindAt = babyInfoSource.indexOf('ensureMilkNutritionProfile');
  const setupModalAt = babyInfoSource.indexOf('完善配奶设置');
  assert.ok(bindAt > 0, 'baby info save should bind the milk profile');
  assert.ok(setupModalAt > bindAt, 'profile bind must happen before the setup modal');
  assert.match(babyInfoSource, /cancelText:\s*'稍后设置'/);

  // 点「去设置」弹出母乳编辑后再取消，也不能只依赖保存母乳参数才落库。
  assert.match(powderSource, /editBreastMilk/);
  assert.match(powderSource, /ensureNutritionProfileSettings/);
  assert.match(powderSource, /hideAddModal/);
  assert.match(powderSource, /dismissedBreastMilkEditor|editingBreastMilk/);

  // 喂奶页再兜一层，避免跳过引导后选母乳仍算成 0。
  assert.match(editorSource, /ensureNutritionProfileSettings/);
});
