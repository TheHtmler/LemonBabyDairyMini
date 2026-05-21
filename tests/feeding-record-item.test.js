const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadFeedingRecordItem() {
  const componentPath = require.resolve('../miniprogram/components/feeding-record-item/feeding-record-item.js');
  delete require.cache[componentPath];

  let componentConfig = null;
  const previousComponent = global.Component;
  global.Component = (config) => {
    componentConfig = config;
  };

  require(componentPath);
  global.Component = previousComponent;

  return componentConfig;
}

function createComponentInstance(component) {
  return {
    data: {},
    setData(update) {
      Object.assign(this.data, update);
    },
    triggerEvent() {},
    ...component.methods
  };
}

test('feeding-record-item composes a single milk summary line with powder details', () => {
  const component = loadFeedingRecordItem();
  const instance = createComponentInstance(component);

  instance.updateDisplay({
    formattedStartTime: '09:30',
    naturalMilkType: 'formula',
    naturalMilkVolume: 40,
    formulaPowderWeight: 5,
    specialMilkVolume: 90,
    specialMilkPowder: 13.5,
    nutritionDisplay: {
      calories: 180,
      carbs: 18,
      fat: 9
    }
  });

  assert.equal(instance.data.milkSummaryText, '普奶 40ml（粉 5g） · 特奶 90ml（粉 13.5g）');
});

test('feeding-record-item hides zero-value milk entries in the summary line', () => {
  const component = loadFeedingRecordItem();
  const instance = createComponentInstance(component);

  instance.updateDisplay({
    formattedStartTime: '11:00',
    naturalMilkType: 'breast',
    naturalMilkVolume: 60,
    formulaPowderWeight: 6,
    specialMilkVolume: 0,
    specialMilkPowder: 0,
    nutritionDisplay: {
      calories: 42,
      carbs: 0,
      fat: 2
    }
  });

  assert.equal(instance.data.milkSummaryText, '母乳 60ml');
});

test('feeding-record-item accepts a prebuilt v2 milk summary line', () => {
  const component = loadFeedingRecordItem();
  const instance = createComponentInstance(component);

  instance.updateDisplay({
    formattedStartTime: '08:30',
    milkSummaryText: '母乳 60ml · 特 纽康特 90ml（粉 13.5g） · 能 能量粉 粉 4g',
    nutritionDisplay: {
      calories: 160,
      carbs: 18,
      fat: 6,
      naturalProtein: 0.66,
      specialProtein: 2.54
    }
  });

  assert.equal(instance.data.milkSummaryText, '母乳 60ml · 特 纽康特 90ml（粉 13.5g） · 能 能量粉 粉 4g');
  assert.deepEqual(instance.data.metricItems, [
    { text: '热量 160 kcal' },
    { text: '碳水 18 g' },
    { text: '脂肪 6 g' },
    { text: '天然蛋白 0.66 g' },
    { text: '特殊蛋白 2.54 g' }
  ]);
});

test('feeding-record-item renders v2 milk components as wrapping chips with category badges', () => {
  const component = loadFeedingRecordItem();
  const instance = createComponentInstance(component);

  instance.updateDisplay({
    formattedStartTime: '08:30',
    milkSummaryText: '母乳 60ml · 特 纽康特 90ml（粉 13.5g） · 能 能量粉 粉 4g',
    milkSummaryItems: [
      {
        badge: '母',
        badgeClass: 'breast',
        name: '母乳',
        amountText: '60ml'
      },
      {
        badge: '特',
        badgeClass: 'special',
        name: '纽康特',
        amountText: '90ml · 粉 13.5g'
      },
      {
        badge: '能',
        badgeClass: 'energy',
        name: '能量粉',
        amountText: '粉 4g'
      }
    ],
    nutritionDisplay: {
      calories: 160,
      carbs: 18,
      fat: 6
    }
  });

  assert.equal(instance.data.milkSummaryItems.length, 3);
  assert.deepEqual(instance.data.milkSummaryItems.map((item) => item.badge), ['母', '特', '能']);
  assert.deepEqual(instance.data.milkSummaryItems.map((item) => item.badgeClass), ['breast', 'special', 'energy']);
  assert.equal(instance.data.milkSummaryItems[2].name, '能量粉');
  assert.equal(instance.data.milkSummaryItems[2].amountText, '粉 4g');
});

test('feeding-record-item wraps structured milk chips instead of truncating v2 summary', () => {
  const wxml = fs.readFileSync('miniprogram/components/feeding-record-item/feeding-record-item.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/components/feeding-record-item/feeding-record-item.wxss', 'utf8');

  assert.match(wxml, /wx:if="\{\{showHeader\}\}"/);
  assert.match(wxml, /class="milk-summary-chip-list"/);
  assert.match(wxml, /wx:for="\{\{milkSummaryItems\}\}"/);
  assert.match(wxml, /class="milk-summary-badge \{\{item\.badgeClass\}\}"/);
  assert.match(wxml, /style="\{\{item\.badgeStyle\}\}"/);
  assert.match(wxml, /class="milk-summary-name"/);
  assert.match(wxml, /class="milk-summary-amount"/);
  assert.match(wxss, /\.milk-summary-row\s*\{[^}]*min-width:\s*0/);
  assert.match(wxss, /\.milk-summary-chip-list\s*\{[^}]*display:\s*flex/);
  assert.match(wxss, /\.milk-summary-chip-list\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(wxss, /\.milk-summary-chip\s*\{[^}]*flex:\s*0 1 calc\(\(100% - 10rpx\) \/ 2\)/);
  assert.match(wxss, /\.milk-summary-chip\s*\{[^}]*max-width:\s*100%/);
  assert.match(wxss, /\.milk-summary-chip\s*\{[^}]*align-items:\s*flex-start/);
  assert.match(wxss, /\.milk-summary-chip-copy\s*\{[^}]*flex-direction:\s*column/);
  assert.match(wxss, /\.milk-summary-chip-copy\s*\{[^}]*align-items:\s*flex-start/);
  assert.match(wxss, /\.milk-summary-badge\s*\{[^}]*margin-top:\s*1rpx/);
  assert.match(wxss, /\.milk-summary-name\s*\{[^}]*max-width:\s*100%/);
  assert.doesNotMatch(wxss, /\.milk-summary-badge\.energy\s*\{/);
  assert.match(wxss, /\.milk-summary\s*\{[^}]*font-size:\s*26rpx/);
  assert.match(wxss, /\.milk-summary\s*\{[^}]*white-space:\s*normal/);
});

test('feeding-record-card places time and actions in a shared top row', () => {
  const wxml = fs.readFileSync('miniprogram/components/feeding-record-card/feeding-record-card.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/components/feeding-record-card/feeding-record-card.wxss', 'utf8');

  assert.match(wxml, /class="record-header"/);
  assert.match(wxml, /class="record-header-main"/);
  assert.match(wxml, /showHeader="\{\{false\}\}"/);
  assert.match(wxss, /\.record-item\s*\{[^}]*flex-direction:\s*column/);
  assert.match(wxss, /\.record-header\s*\{[^}]*justify-content:\s*space-between/);
  assert.match(wxss, /\.record-header-main\s*\{[^}]*min-width:\s*0/);
  assert.match(wxss, /\.action-buttons\s*\{[^}]*flex-direction:\s*row/);
  assert.match(wxss, /\.action-buttons\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(wxss, /\.record-content\s*\{[^}]*flex:\s*1/);
  assert.match(wxss, /\.record-content\s*\{[^}]*min-width:\s*0/);
});
