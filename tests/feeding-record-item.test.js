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

test('feeding-record-item keeps the milk summary on a single line with ellipsis', () => {
  const wxml = fs.readFileSync('miniprogram/components/feeding-record-item/feeding-record-item.wxml', 'utf8');
  const wxss = fs.readFileSync('miniprogram/components/feeding-record-item/feeding-record-item.wxss', 'utf8');

  assert.match(wxml, /wx:if="\{\{showHeader\}\}"/);
  assert.match(wxml, /class="milk-summary-row"/);
  assert.match(wxss, /\.milk-summary-row\s*\{[^}]*min-width:\s*0/);
  assert.match(wxss, /\.milk-summary\s*\{[^}]*font-size:\s*26rpx/);
  assert.match(wxss, /\.milk-summary\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(wxss, /\.milk-summary\s*\{[^}]*overflow:\s*hidden/);
  assert.match(wxss, /\.milk-summary\s*\{[^}]*text-overflow:\s*ellipsis/);
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
